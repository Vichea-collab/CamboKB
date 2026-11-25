import type { Metrics } from '@cambo/service-kit';
import type pg from 'pg';
import type { Logger } from './logger';
import { TelegramError, type TelegramClient } from './telegram';
import { Topics, type TopicKey } from './topics';

/**
 * Telegram messages go through a table, not straight to the Bot API:
 *  - they are saved in the same transaction as the event that caused them, so nothing is lost on a restart
 *    or while Telegram is down;
 *  - they are sent right away (a "kick" after saving);
 *  - a worker retries the ones that failed, with backoff, honouring Telegram's rate limit;
 *  - a message can't be queued twice for the same notification (dedupe_key);
 *  - a message can replace one sent earlier (`edits`), so an order alert never shows an old status.
 */

export type OutboxMessage = {
  chatId: number | string | bigint;
  text: string;
  parseMode?: 'HTML';
  replyMarkup?: unknown;
  /** Forum topic to post in (owner group only). */
  topic?: TopicKey;
  /** e.g. `order:<id>:customer:CONFIRMED`. A second message with the same key is ignored. */
  dedupeKey?: string;
  /** Replace the message that has this dedupe key instead of sending a new one. */
  edits?: string;
  /** When the change behind an edit happened (ISO): the newest change wins, in whatever order they arrive. */
  editAt?: string;
  requestId?: string;
  sourceEventId?: string;
};

type Row = {
  id: string;
  chat_id: string;
  text: string;
  parse_mode: string | null;
  reply_markup: unknown;
  topic: TopicKey | null;
  edits: string | null;
};

/** Telegram has nothing left to change: the text is already this, or the message is gone or too old. */
const NOTHING_TO_EDIT = /message is not modified|message to edit not found|message can't be edited/i;

const MAX_ATTEMPTS = 8;
const LOCK_SECONDS = 60;
const BATCH = 25;
const TEXT_LIMIT = 4000; // Telegram allows 4096.
const KEEP_SENT_DAYS = 14;
const KEEP_FAILED_DAYS = 30;
const KEEP_EVENTS_DAYS = 14;

/** 5s, 15s, 45s, 2m, 6m, 15m, 15m ... */
export const retryDelaySeconds = (attempts: number) =>
  Math.min(5 * 3 ** Math.max(0, attempts - 1), 15 * 60);

type Queryable = Pick<pg.Pool, 'query'>;
export type OutboxHealth = {
  pending: number;
  failed: number;
  oldestPendingAgeSec: number | null;
  lastError: string | null;
};

export class Outbox {
  private readonly sentCounter;
  private running = false;
  private again = false;
  private static inflight = new Set<Promise<void>>();
  private readonly topics: Topics;

  constructor(
    private readonly pool: pg.Pool,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    metrics: Metrics,
  ) {
    this.topics = new Topics(pool, telegram, logger);
    this.sentCounter = metrics.counter('telegram_messages_total', 'Telegram messages by outcome', [
      'result',
    ] as const);
    const count = async (status: string) =>
      Number(
        (
          await pool
            .query('SELECT count(*)::int AS n FROM messages WHERE status = $1', [status])
            .catch(() => ({ rows: [{ n: 0 }] }))
        ).rows[0].n,
      );
    metrics.gauge(
      'notification_outbox_pending',
      'Telegram messages waiting to be sent',
      [],
      async (g) => g.set(await count('PENDING')),
    );
    metrics.gauge('notification_outbox_failed', 'Telegram messages given up on', [], async (g) =>
      g.set(await count('FAILED')),
    );
    metrics.gauge(
      'notification_outbox_oldest_pending_age_seconds',
      'Age of the oldest message still waiting',
      [],
      async (g) => {
        const r = await pool
          .query(
            "SELECT extract(epoch FROM now() - min(created_at))::float AS age FROM messages WHERE status = 'PENDING'",
          )
          .catch(() => ({ rows: [{ age: null }] }));
        g.set(r.rows[0].age ?? 0);
      },
    );
  }

  /** Resolves when no send is in progress (tests use it so one test's sends can't leak into the next). */
  static async idle(): Promise<void> {
    while (Outbox.inflight.size) await Promise.allSettled([...Outbox.inflight]);
  }

  /** Save a message (use `db` to make it part of a transaction). Returns false when it was already queued. Does not send: call `kick()` after committing. */
  async save(msg: OutboxMessage, db: Queryable = this.pool): Promise<boolean> {
    const text = msg.text.length > TEXT_LIMIT ? `${msg.text.slice(0, TEXT_LIMIT - 1)}…` : msg.text;
    const r = await db.query(
      `INSERT INTO messages (chat_id, text, parse_mode, reply_markup, dedupe_key, request_id, source_event_id, topic, edits, edit_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        String(msg.chatId),
        text,
        msg.parseMode ?? null,
        msg.replyMarkup === undefined ? null : JSON.stringify(msg.replyMarkup),
        msg.dedupeKey ?? null,
        msg.requestId ?? null,
        msg.sourceEventId ?? null,
        msg.topic ?? null,
        msg.edits ?? null,
        msg.editAt ?? null,
      ],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Save and send right away. Never throws. */
  async enqueue(msg: OutboxMessage): Promise<void> {
    try {
      await this.save(msg);
    } catch (err) {
      this.logger.error({ err, dedupeKey: msg.dedupeKey }, 'could not queue Telegram message');
      return;
    }
    this.kick();
  }

  /** Send what is due, now. Safe to call from anywhere; overlapping calls are folded into one. */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    const task = (async () => {
      try {
        do {
          this.again = false;
          await this.drain();
        } while (this.again);
      } catch (err) {
        this.logger.error({ err }, 'Telegram outbox drain failed');
      } finally {
        this.running = false;
      }
    })();
    Outbox.inflight.add(task);
    void task.finally(() => Outbox.inflight.delete(task));
  }

  /** Claim and send due messages, oldest first. Returns how many were sent. */
  async drain(): Promise<number> {
    const { rows: due } = await this.pool.query(
      `SELECT id, chat_id, text, parse_mode, reply_markup, attempts, request_id, topic, edits FROM messages
       WHERE status = 'PENDING' AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
       ORDER BY created_at LIMIT $1`,
      [BATCH],
    );
    let sent = 0;
    for (const row of due) {
      // Claim it. If another worker got there first the attempts count has moved and we skip.
      const claim = await this.pool.query(
        `UPDATE messages SET locked_until = now() + make_interval(secs => $3), attempts = attempts + 1
         WHERE id = $1 AND status = 'PENDING' AND attempts = $2 AND (locked_until IS NULL OR locked_until < now())`,
        [row.id, row.attempts, LOCK_SECONDS],
      );
      if (claim.rowCount !== 1) continue;
      const attempts = row.attempts + 1;
      try {
        const messageId = row.edits ? await this.edit(row) : await this.deliver(row);
        await this.pool.query(
          "UPDATE messages SET status = 'SENT', sent_at = now(), locked_until = NULL, last_error = NULL, telegram_message_id = $2 WHERE id = $1",
          [row.id, messageId || null],
        );
        this.sentCounter.inc({ result: 'sent' });
        sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof TelegramError && err.code === 429) {
          // Telegram is rate limiting the whole bot: wait as long as it says, and stop for now.
          const wait = (err.retryAfterSec ?? 5) + 1;
          await this.pool.query(
            'UPDATE messages SET attempts = $2, locked_until = NULL, next_attempt_at = now() + make_interval(secs => $3), last_error = $4 WHERE id = $1',
            [row.id, row.attempts, wait, message],
          );
          this.sentCounter.inc({ result: 'rate_limited' });
          this.logger.warn({ waitSeconds: wait }, 'Telegram rate limit: pausing sends');
          break;
        }
        const giveUp = (err instanceof TelegramError && err.permanent) || attempts >= MAX_ATTEMPTS;
        if (giveUp)
          await this.pool.query(
            "UPDATE messages SET status = 'FAILED', locked_until = NULL, last_error = $2 WHERE id = $1",
            [row.id, message],
          );
        else
          await this.pool.query(
            'UPDATE messages SET locked_until = NULL, next_attempt_at = now() + make_interval(secs => $2), last_error = $3 WHERE id = $1',
            [row.id, retryDelaySeconds(attempts), message],
          );
        this.sentCounter.inc({ result: giveUp ? 'failed' : 'retry' });
        const fields = {
          err: message,
          messageId: row.id,
          attempts,
          chatId: String(row.chat_id),
          requestId: row.request_id ?? undefined,
        };
        if (giveUp) this.logger.error(fields, 'Telegram message gave up');
        else this.logger.warn(fields, 'Telegram message failed, will retry');
      }
    }
    return sent;
  }

  /** Send one row, into its forum topic when it has one. A topic deleted in Telegram is recreated once. */
  private async deliver(row: Row): Promise<number> {
    const send = (threadId?: number) =>
      this.telegram.sendMessage(Number(row.chat_id), row.text, {
        parseMode: row.parse_mode === 'HTML' ? 'HTML' : undefined,
        replyMarkup: row.reply_markup ?? undefined,
        threadId,
      });
    const threadId = row.topic ? await this.topics.resolve(row.chat_id, row.topic) : undefined;
    try {
      return await send(threadId);
    } catch (err) {
      const gone = threadId !== undefined && err instanceof TelegramError && /thread not found/i.test(err.message);
      if (!gone || !row.topic) throw err;
      await this.topics.forget(row.chat_id, row.topic);
      return send(await this.topics.resolve(row.chat_id, row.topic));
    }
  }

  /** Replace an earlier message. Done when there is nothing to replace; waits while that message is still on its way. */
  private async edit(row: Row): Promise<null> {
    const { rows } = await this.pool.query(
      `SELECT t.chat_id, t.status, t.telegram_message_id,
              EXISTS (SELECT 1 FROM messages n, messages me
                      WHERE me.id = $2 AND n.edits = me.edits AND n.edit_at > me.edit_at) AS superseded
       FROM messages t WHERE t.dedupe_key = $1`,
      [row.edits, row.id],
    );
    const target = rows[0];
    if (!target || target.superseded) return null;
    if (target.status === 'PENDING') throw new Error('the message to correct has not been sent yet');
    if (target.status !== 'SENT' || !target.telegram_message_id) return null;
    try {
      await this.telegram.editMessage(Number(target.chat_id), Number(target.telegram_message_id), row.text, {
        parseMode: row.parse_mode === 'HTML' ? 'HTML' : undefined,
        replyMarkup: row.reply_markup ?? undefined,
      });
    } catch (err) {
      if (!(err instanceof TelegramError && NOTHING_TO_EDIT.test(err.message))) throw err;
    }
    return null;
  }

  /** Delete old rows so the tables stay small. */
  async purge(): Promise<number> {
    const day = (n: number) => `now() - interval '${n} days'`;
    const [sent, failed, events] = await Promise.all([
      this.pool.query(
        `DELETE FROM messages WHERE status = 'SENT' AND created_at < ${day(KEEP_SENT_DAYS)}`,
      ),
      this.pool.query(
        `DELETE FROM messages WHERE status = 'FAILED' AND created_at < ${day(KEEP_FAILED_DAYS)}`,
      ),
      this.pool.query(`DELETE FROM received_events WHERE received_at < ${day(KEEP_EVENTS_DAYS)}`),
    ]);
    return (sent.rowCount ?? 0) + (failed.rowCount ?? 0) + (events.rowCount ?? 0);
  }

  /** Retry loop for messages that failed or were interrupted. Returns a stop function. */
  start(intervalMs = 3000): () => void {
    let lastPurge = 0;
    const tick = () => {
      this.kick();
      if (Date.now() - lastPurge > 3_600_000) {
        lastPurge = Date.now();
        void this.purge().catch((err) => this.logger.warn({ err }, 'outbox purge failed'));
      }
    };
    const timer = setInterval(tick, intervalMs);
    tick();
    return () => clearInterval(timer);
  }

  async health(): Promise<OutboxHealth> {
    const [pending, failed, oldest, last] = await Promise.all([
      this.pool.query("SELECT count(*)::int AS n FROM messages WHERE status = 'PENDING'"),
      this.pool.query(
        "SELECT count(*)::int AS n FROM messages WHERE status = 'FAILED' AND created_at > now() - interval '7 days'",
      ),
      this.pool.query(
        "SELECT extract(epoch FROM now() - min(created_at))::int AS age FROM messages WHERE status = 'PENDING'",
      ),
      this.pool.query(
        'SELECT last_error FROM messages WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      ),
    ]);
    return {
      pending: pending.rows[0].n,
      failed: failed.rows[0].n,
      oldestPendingAgeSec: oldest.rows[0].age ?? null,
      lastError: last.rows[0]?.last_error ?? null,
    };
  }
}
