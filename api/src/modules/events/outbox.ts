import { currentRequestId, runWithRequestId } from '@cambo/service-kit';
import {
  EVENT_TARGETS,
  type EventData,
  type EventEnvelope,
  type EventTarget,
  type EventType,
} from '@cambo/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AppDeps } from '../../http/app';
import { EventDeliveryError } from '../../integrations/services/events';

/**
 * How the api tells the other services what happened.
 *
 *  1. `publishEvent` writes a row in the SAME database transaction as the change, so a change and its
 *     event either both exist or neither does.
 *  2. After the commit, `kickEvents` delivers right away (no polling delay).
 *  3. A worker retries what failed, with backoff, and never lets one dead service hold up another.
 *
 * Delivery is at-least-once: receivers ignore repeats (see the contracts in @cambo/shared).
 */

type Db = PrismaClient | Prisma.TransactionClient;

const MAX_ATTEMPTS = 12; // 5s, 15s, 45s, 2m, 6m, then every 15 min: about 2.5 hours
const LOCK_MS = 60_000;
const BATCH = 25;
const KEEP_SENT_DAYS = 7;
const KEEP_FAILED_DAYS = 30;

export const retryDelayMs = (attempts: number) =>
  Math.min(5_000 * 3 ** Math.max(0, attempts - 1), 15 * 60_000);

/** Queue an event. Pass the transaction client to make it part of the change that caused it. */
export async function publishEvent<T extends EventType>(
  db: Db,
  type: T,
  data: EventData<T>,
  opts: { dedupeKey?: string } = {},
): Promise<void> {
  await db.serviceEvent.createMany({
    data: [
      {
        target: EVENT_TARGETS[type],
        type,
        payload: data as Prisma.InputJsonValue,
        requestId: currentRequestId() ?? null,
        dedupeKey: opts.dedupeKey ?? null,
        // Taken here, after the order row is locked, so a newer change always has a newer time.
        emittedAt: new Date(),
      },
    ],
    skipDuplicates: true, // the same event queued twice is ignored (inside a transaction, too)
  });
}

// ---------------------------------------------------------------------------
// metrics

type Counters = { delivered: { inc(l: { target: string; result: string }): void } };
const counters = new WeakMap<object, Counters>();

/** Register the outbox metrics on the service's registry. Call once when the app is created. */
export function registerEventMetrics(deps: AppDeps): void {
  const { metrics, prisma } = deps;
  const delivered = metrics.counter(
    'service_events_delivered_total',
    'Events delivered to other services',
    ['target', 'result'] as const,
  );
  counters.set(deps, { delivered });
  const perTarget = async (status: 'PENDING' | 'FAILED') =>
    prisma.serviceEvent
      .groupBy({ by: ['target'], where: { status }, _count: { _all: true } })
      .catch(() => []);
  metrics.gauge(
    'service_events_pending',
    'Events waiting to be delivered',
    ['target'] as const,
    async (g) => {
      g.reset();
      for (const t of ['report', 'notification']) g.set({ target: t }, 0);
      for (const r of await perTarget('PENDING')) g.set({ target: r.target }, r._count._all);
    },
  );
  metrics.gauge(
    'service_events_failed',
    'Events given up on (see lastError)',
    ['target'] as const,
    async (g) => {
      g.reset();
      for (const t of ['report', 'notification']) g.set({ target: t }, 0);
      for (const r of await perTarget('FAILED')) g.set({ target: r.target }, r._count._all);
    },
  );
  metrics.gauge(
    'service_events_oldest_pending_age_seconds',
    'Age of the oldest event still waiting',
    ['target'] as const,
    async (g) => {
      g.reset();
      for (const t of ['report', 'notification']) {
        const oldest = await prisma.serviceEvent
          .findFirst({
            where: { target: t, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          })
          .catch(() => null);
        g.set({ target: t }, oldest ? (Date.now() - oldest.createdAt.getTime()) / 1000 : 0);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// delivery

const running = new WeakSet<object>();
const rerun = new WeakSet<object>();
const inflight = new Set<Promise<void>>();

/** Resolves when no delivery is in progress (tests use it so one test's sends can't leak into the next). */
export async function eventsIdle(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

/** Deliver what is due, now. Safe to call from anywhere; overlapping calls are folded into one. */
export function kickEvents(deps: AppDeps): void {
  if (running.has(deps)) {
    rerun.add(deps);
    return;
  }
  running.add(deps);
  const task = (async () => {
    try {
      do {
        rerun.delete(deps);
        await drainEvents(deps);
      } while (rerun.has(deps));
    } catch (err) {
      deps.logger.error({ err }, 'event delivery pass failed');
    } finally {
      running.delete(deps);
    }
  })();
  inflight.add(task);
  void task.finally(() => inflight.delete(task));
}

/** Claim and deliver due events, oldest first. Returns how many were delivered. */
export async function drainEvents(deps: AppDeps): Promise<number> {
  const { prisma, events, logger } = deps;
  const delivered = counters.get(deps)?.delivered;
  const now = new Date();
  const due = await prisma.serviceEvent.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });
  const down = new Set<string>(); // a service that just failed is left alone for the rest of this pass
  let sent = 0;
  for (const row of due) {
    if (down.has(row.target)) continue;
    const claimed = await prisma.serviceEvent.updateMany({
      where: {
        id: row.id,
        status: 'PENDING',
        attempts: row.attempts,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
      },
      data: { lockedUntil: new Date(Date.now() + LOCK_MS), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    const attempts = row.attempts + 1;
    const envelope: EventEnvelope = {
      id: row.id,
      type: row.type,
      emittedAt: row.emittedAt.toISOString(),
      ...(row.requestId ? { requestId: row.requestId } : {}),
      ...(row.dedupeKey ? { dedupeKey: row.dedupeKey } : {}),
      data: row.payload,
    };
    try {
      await runWithRequestId(row.requestId ?? row.id, () =>
        events.send(row.target as EventTarget, envelope),
      );
      await prisma.serviceEvent.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), lockedUntil: null, lastError: null },
      });
      delivered?.inc({ target: row.target, result: 'sent' });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof EventDeliveryError ? err.retryable : true;
      const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
      if (retryable) down.add(row.target);
      await prisma.serviceEvent.update({
        where: { id: row.id },
        data: giveUp
          ? { status: 'FAILED', lockedUntil: null, lastError: message }
          : {
              lockedUntil: null,
              nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
              lastError: message,
            },
      });
      delivered?.inc({ target: row.target, result: giveUp ? 'failed' : 'retry' });
      const fields = {
        err: message,
        eventId: row.id,
        type: row.type,
        target: row.target,
        attempts,
        requestId: row.requestId ?? undefined,
      };
      if (giveUp) logger.error(fields, 'event delivery gave up');
      else logger.warn(fields, 'event delivery failed, will retry');
    }
  }
  return sent;
}

/** Delete old delivered/failed rows so the table stays small. */
export async function purgeEvents(deps: AppDeps): Promise<number> {
  const day = 86_400_000;
  const [sent, failed] = await Promise.all([
    deps.prisma.serviceEvent.deleteMany({
      where: { status: 'SENT', createdAt: { lt: new Date(Date.now() - KEEP_SENT_DAYS * day) } },
    }),
    deps.prisma.serviceEvent.deleteMany({
      where: { status: 'FAILED', createdAt: { lt: new Date(Date.now() - KEEP_FAILED_DAYS * day) } },
    }),
  ]);
  return sent.count + failed.count;
}

/** Retry loop for events that failed or were interrupted. Returns a stop function. */
export function startEventWorker(deps: AppDeps, intervalMs = 3000): () => void {
  let lastPurge = 0;
  const tick = () => {
    kickEvents(deps);
    if (Date.now() - lastPurge > 3_600_000) {
      lastPurge = Date.now();
      void purgeEvents(deps).catch((err) => deps.logger.warn({ err }, 'event purge failed'));
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}

export type EventsHealth = Record<
  string,
  { pending: number; failed: number; oldestPendingAgeSec: number | null; lastError: string | null }
>;

export async function eventsHealth(deps: AppDeps): Promise<EventsHealth> {
  const { prisma } = deps;
  const out: EventsHealth = {};
  for (const target of ['report', 'notification']) {
    const [pending, failed, oldest, lastFailed] = await Promise.all([
      prisma.serviceEvent.count({ where: { target, status: 'PENDING' } }),
      prisma.serviceEvent.count({
        where: {
          target,
          status: 'FAILED',
          createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) },
        },
      }),
      prisma.serviceEvent.findFirst({
        where: { target, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.serviceEvent.findFirst({
        where: { target, lastError: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { lastError: true },
      }),
    ]);
    out[target] = {
      pending,
      failed,
      oldestPendingAgeSec: oldest
        ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000)
        : null,
      lastError: lastFailed?.lastError ?? null,
    };
  }
  return out;
}

/** Put failed events back in the queue (after fixing what was wrong). Returns how many. */
export async function retryFailedEvents(prisma: PrismaClient): Promise<number> {
  const r = await prisma.serviceEvent.updateMany({
    where: { status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lockedUntil: null },
  });
  return r.count;
}
