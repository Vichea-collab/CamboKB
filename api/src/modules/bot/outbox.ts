import type { TelegramOutbox } from '@prisma/client';
import { TelegramError } from '../../integrations/telegram/client';
import type { AppDeps } from '../../http/app';

/**
 * Telegram messages go through a table, not straight to the Bot API:
 *  - they are saved in the same moment the thing happens, so a restart or a Telegram
 *    outage never loses one;
 *  - they are sent right away (a "kick" after saving), so there is no polling delay;
 *  - a worker retries the ones that failed, with backoff, honouring Telegram's rate limit;
 *  - a message can't be queued twice for the same event (dedupeKey).
 */

export type OutboxMessage = {
  chatId: number | string | bigint;
  text: string;
  parseMode?: 'HTML';
  replyMarkup?: unknown;
  /** e.g. `order:<id>:customer:CONFIRMED`. A second message with the same key is ignored. */
  dedupeKey?: string;
};

const MAX_ATTEMPTS = 8;
const LOCK_MS = 60_000;
const BATCH = 25;
const TEXT_LIMIT = 4000; // Telegram allows 4096.
const KEEP_SENT_DAYS = 14;
const KEEP_FAILED_DAYS = 30;

/** 5s, 15s, 45s, 2m, 6m, 15m, 15m ... */
export const retryDelayMs = (attempts: number) => Math.min(5_000 * 3 ** Math.max(0, attempts - 1), 15 * 60_000);

/** Save a message for sending and try to send it now. Never throws. */
export async function enqueueTelegram(deps: AppDeps, msg: OutboxMessage): Promise<void> {
  try {
    await deps.prisma.telegramOutbox.create({
      data: {
        chatId: BigInt(msg.chatId),
        text: msg.text.length > TEXT_LIMIT ? `${msg.text.slice(0, TEXT_LIMIT - 1)}…` : msg.text,
        parseMode: msg.parseMode ?? null,
        replyMarkup: (msg.replyMarkup as object | undefined) ?? undefined,
        dedupeKey: msg.dedupeKey ?? null,
      },
    });
  } catch (err) {
    // P2002: this event was already queued. Not an error.
    if ((err as { code?: string }).code !== 'P2002') deps.logger.error({ err, dedupeKey: msg.dedupeKey }, 'could not queue Telegram message');
    return;
  }
  kickOutbox(deps);
}

const running = new WeakSet<object>();
const rerun = new WeakSet<object>();
const inflight = new Set<Promise<void>>();

/** Resolves when no send is in progress (used by tests so one test's sends can't leak into the next). */
export async function outboxIdle(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

/** Send what is due, now. Safe to call from anywhere; overlapping calls are folded into one. */
export function kickOutbox(deps: AppDeps): void {
  if (running.has(deps)) {
    rerun.add(deps);
    return;
  }
  running.add(deps);
  const task = (async () => {
    try {
      do {
        rerun.delete(deps);
        await drainOutbox(deps);
      } while (rerun.has(deps));
    } catch (err) {
      deps.logger.error({ err }, 'Telegram outbox drain failed');
    } finally {
      running.delete(deps);
    }
  })();
  inflight.add(task);
  void task.finally(() => inflight.delete(task));
}

/** Claim and send due messages, oldest first. Returns how many were sent. */
export async function drainOutbox(deps: AppDeps): Promise<number> {
  const { prisma, telegram, logger } = deps;
  const now = new Date();
  const due = await prisma.telegramOutbox.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });
  let sent = 0;
  for (const row of due) {
    // Claim it. If another worker got there first the attempts count has moved and we skip.
    const claimed = await prisma.telegramOutbox.updateMany({
      where: { id: row.id, status: 'PENDING', attempts: row.attempts, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
      data: { lockedUntil: new Date(Date.now() + LOCK_MS), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    const attempts = row.attempts + 1;
    try {
      await telegram.sendMessage(Number(row.chatId), row.text, { parseMode: row.parseMode === 'HTML' ? 'HTML' : undefined, replyMarkup: row.replyMarkup ?? undefined });
      await prisma.telegramOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), lockedUntil: null, lastError: null } });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof TelegramError && err.code === 429) {
        // Telegram is rate limiting the whole bot: wait as long as it says, and stop for now.
        const wait = ((err.retryAfterSec ?? 5) + 1) * 1000;
        await prisma.telegramOutbox.update({ where: { id: row.id }, data: { attempts: row.attempts, lockedUntil: null, nextAttemptAt: new Date(Date.now() + wait), lastError: message } });
        logger.warn({ waitMs: wait }, 'Telegram rate limit: pausing sends');
        break;
      }
      const giveUp = (err instanceof TelegramError && err.permanent) || attempts >= MAX_ATTEMPTS;
      await prisma.telegramOutbox.update({
        where: { id: row.id },
        data: giveUp
          ? { status: 'FAILED', lockedUntil: null, lastError: message }
          : { lockedUntil: null, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)), lastError: message },
      });
      (giveUp ? logger.error : logger.warn).call(logger, { err: message, outboxId: row.id, attempts, chatId: String(row.chatId) }, giveUp ? 'Telegram message gave up' : 'Telegram message failed, will retry');
    }
  }
  return sent;
}

/** Delete old sent/failed rows so the table stays small. */
export async function purgeOutbox(deps: AppDeps): Promise<number> {
  const day = 86_400_000;
  const [sent, failed] = await Promise.all([
    deps.prisma.telegramOutbox.deleteMany({ where: { status: 'SENT', createdAt: { lt: new Date(Date.now() - KEEP_SENT_DAYS * day) } } }),
    deps.prisma.telegramOutbox.deleteMany({ where: { status: 'FAILED', createdAt: { lt: new Date(Date.now() - KEEP_FAILED_DAYS * day) } } }),
  ]);
  return sent.count + failed.count;
}

/** Retry loop for messages that failed or were interrupted. Returns a stop function. */
export function startOutboxWorker(deps: AppDeps, intervalMs = 3000): () => void {
  let lastPurge = 0;
  const tick = () => {
    kickOutbox(deps);
    if (Date.now() - lastPurge > 3_600_000) {
      lastPurge = Date.now();
      void purgeOutbox(deps).catch((err) => deps.logger.warn({ err }, 'outbox purge failed'));
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}

export type OutboxHealth = { pending: number; failed: number; oldestPendingAgeSec: number | null; lastError: string | null };

export async function outboxHealth(deps: AppDeps): Promise<OutboxHealth> {
  const { prisma } = deps;
  const [pending, failed, oldest, lastFailed] = await Promise.all([
    prisma.telegramOutbox.count({ where: { status: 'PENDING' } }),
    prisma.telegramOutbox.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } } }),
    prisma.telegramOutbox.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.telegramOutbox.findFirst({ where: { lastError: { not: null } }, orderBy: { createdAt: 'desc' }, select: { lastError: true } }),
  ]);
  return { pending, failed, oldestPendingAgeSec: oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000) : null, lastError: lastFailed?.lastError ?? null };
}

export type { TelegramOutbox };
