import type { KhqrCode, Order, Payment, Prisma, PrismaClient } from '@prisma/client';
import { formatUsd } from '@cambo/shared';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import { BakongError, type BakongCheck } from '../../integrations/bakong/client';
import { createKhqr } from '../../integrations/bakong/khqr';
import { appMetrics } from '../../lib/app-metrics';
import { kickEvents } from '../events/outbox';
import {
  alertAdmin,
  announcePaymentConfirmed,
  announcePaymentExpired,
  announcePaymentReminder,
  announceSnapshot,
} from '../events/snapshot';
import { publishOrderUpdate } from '../orders/status';
import { cancelOrder } from '../orders/orders';
import { BakongHealth } from './bakong-health';

/** Customer polling asks Bakong at most this often per payment. */
const CHECK_EVERY_MS = 5_000;
/** The background sweep re-checks an open payment at most this often. */
const SWEEP_RECHECK_MS = 15_000;
/** After the payment window closes, wait this long for in-flight payments before cancelling. */
const GRACE_MS = 2 * 60_000;
/** Minimum time left in the window for a new QR to be worth issuing. */
const MIN_QR_LIFETIME_MS = 30_000;

type Db = PrismaClient | Prisma.TransactionClient;
type CheckOutcome = 'paid' | 'unpaid' | 'mismatch' | 'throttled' | 'skipped' | 'error';

/**
 * Generate a QR for the payment. It never outlives the payment window, so once an
 * order can be cancelled for non-payment no valid QR for it exists.
 */
export async function issueKhqr(
  deps: AppDeps,
  db: Db,
  payment: Payment & { order: Order },
): Promise<KhqrCode> {
  const { bakong } = deps.config;
  const now = Date.now();
  const windowEnd = payment.expiresAt?.getTime() ?? now + bakong.holdMinutes * 60_000;
  const expiresAt = new Date(Math.min(now + bakong.qrTtlMinutes * 60_000, windowEnd));
  if (expiresAt.getTime() - now < MIN_QR_LIFETIME_MS) {
    throw new AppError(409, 'PAYMENT_WINDOW_CLOSED', 'The time to pay for this order has run out');
  }
  const { qr, md5 } = createKhqr({
    accountId: bakong.accountId,
    merchantName: bakong.merchantName,
    merchantCity: bakong.merchantCity,
    amountCents: payment.amountCents,
    billNumber: payment.order.number,
    expiresAt,
  });
  return db.khqrCode.create({ data: { paymentId: payment.id, md5, qrString: qr, expiresAt } });
}

/** What the customer's payment page needs. The QR is only included while it can still be paid. */
export function paymentView(p: Payment & { khqrCodes: KhqrCode[] }) {
  const now = Date.now();
  const latest = [...p.khqrCodes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const open = p.status === 'PENDING';
  return {
    method: p.method,
    status: p.status,
    amountCents: p.amountCents,
    currency: p.currency,
    payBefore: p.expiresAt,
    paidAt: p.paidAt,
    canRenew:
      open &&
      p.method === 'KHQR' &&
      !!p.expiresAt &&
      p.expiresAt.getTime() - now > MIN_QR_LIFETIME_MS,
    khqr:
      open && latest && latest.expiresAt.getTime() > now
        ? { qr: latest.qrString, expiresAt: latest.expiresAt }
        : null,
  };
}

// Per-app memory for alerts we don't want to repeat every few seconds.
const alertState = new WeakMap<
  object,
  { tokenAlertAt: number; mismatches: Set<string>; health: BakongHealth }
>();
const alerts = (deps: AppDeps) => {
  let s = alertState.get(deps.config);
  if (!s) alertState.set(deps.config, (s = { tokenAlertAt: 0, mismatches: new Set(), health: new BakongHealth() }));
  return s;
};

/** Tell the shop owner (through the notification service). Never throws: an alert must not break a payment check. */
async function tellOwner(deps: AppDeps, text: string, dedupeKey?: string) {
  try {
    await alertAdmin(deps.prisma, text, dedupeKey);
    kickEvents(deps);
  } catch (err) {
    deps.logger.warn({ err }, 'could not queue an owner alert');
  }
}

function onBakongError(deps: AppDeps, err: unknown) {
  if (err instanceof BakongError && err.kind === 'UNAUTHORIZED') {
    const state = alerts(deps);
    if (Date.now() - state.tokenAlertAt > 60 * 60_000) {
      state.tokenAlertAt = Date.now();
      void tellOwner(
        deps,
        '⚠️ Bakong token was rejected, so KHQR payments cannot be confirmed. Renew the token at api-bakong.nbc.gov.kh and update BAKONG_TOKEN.',
      );
    }
  } else if (alerts(deps).health.failed(Date.now()) === 'down') {
    void tellOwner(
      deps,
      '⚠️ Bakong has not been answering for 5 minutes, so KHQR payments cannot be confirmed. Customers may have paid: their orders keep waiting and are confirmed when it works again. Check your bank app before sending anything.',
    );
  }
  deps.logger.warn({ err }, 'Bakong check failed');
}

function onBakongAnswer(deps: AppDeps) {
  if (alerts(deps).health.ok() === 'recovered')
    void tellOwner(deps, '✅ Bakong is answering again. Waiting KHQR payments are being checked now.');
}

/**
 * Ask Bakong whether any QR of this payment was paid. Throttled unless `force`.
 * Safe to call concurrently: claiming the check and marking paid are both atomic.
 */
export async function checkKhqrPayment(
  deps: AppDeps,
  paymentId: string,
  opts: { force?: boolean } = {},
): Promise<CheckOutcome> {
  const { prisma } = deps;
  const now = new Date();
  const claim = await prisma.payment.updateMany({
    where: {
      id: paymentId,
      method: 'KHQR',
      status: 'PENDING',
      ...(opts.force
        ? {}
        : {
            OR: [
              { lastCheckedAt: null },
              { lastCheckedAt: { lt: new Date(now.getTime() - CHECK_EVERY_MS) } },
            ],
          }),
    },
    data: { lastCheckedAt: now },
  });
  if (claim.count === 0) {
    const p = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, method: true },
    });
    return p?.status === 'PENDING' && p.method === 'KHQR' ? 'throttled' : 'skipped';
  }
  const codes = await prisma.khqrCode.findMany({
    where: { paymentId },
    orderBy: { createdAt: 'desc' },
  });
  for (const code of codes) {
    let result: BakongCheck;
    try {
      result = await deps.bakong.checkByMd5(code.md5);
    } catch (err) {
      onBakongError(deps, err);
      return 'error';
    }
    onBakongAnswer(deps);
    if (result.found) return markPaid(deps, paymentId, code.md5, result);
  }
  return 'unpaid';
}

async function markPaid(
  deps: AppDeps,
  paymentId: string,
  md5: string,
  tx: Extract<BakongCheck, { found: true }>,
): Promise<CheckOutcome> {
  const { prisma, config, logger } = deps;
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { order: true },
  });
  const amountOk =
    Math.round(tx.amount * 100) === payment.amountCents && tx.currency.toUpperCase() === 'USD';
  const accountOk =
    !tx.toAccountId || tx.toAccountId.toLowerCase() === config.bakong.accountId.toLowerCase();
  if (!amountOk || !accountOk) {
    logger.error(
      {
        paymentId,
        md5,
        tx: { amount: tx.amount, currency: tx.currency, toAccountId: tx.toAccountId },
      },
      'KHQR transaction does not match the order',
    );
    const key = `${paymentId}:${tx.hash}:${tx.amount}:${tx.toAccountId}`;
    if (!alerts(deps).mismatches.has(key)) {
      alerts(deps).mismatches.add(key);
      appMetrics(deps).khqrPayments.inc({ result: 'mismatch' });
      void tellOwner(
        deps,
        `⚠️ A KHQR payment for order ${payment.order.number} didn't match: received ${tx.amount} ${tx.currency} to ${tx.toAccountId || 'unknown account'}, expected ${formatUsd(payment.amountCents)} to ${config.bakong.accountId}. The order was not confirmed. Check it in your bank app.`,
      );
    }
    return 'mismatch';
  }

  const outcome = await prisma.$transaction(async (db) => {
    const claimed = await db.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: {
        status: 'PAID',
        paidAt: tx.paidAt,
        providerRef: md5,
        // Kept for your records and refunds: Bakong's transaction hash and who paid.
        rawPayload: {
          ...tx.raw,
          hash: tx.hash,
          fromAccountId: tx.fromAccountId,
          toAccountId: tx.toAccountId,
          amount: tx.amount,
          currency: tx.currency,
        } as Prisma.InputJsonValue,
      },
    });
    if (claimed.count === 0) return 'already' as const;
    await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${payment.orderId}::uuid FOR UPDATE`;
    const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    if (order.status === 'PENDING') {
      await db.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
      await db.orderStatusEvent.create({
        data: {
          orderId: order.id,
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          note: 'Paid with KHQR',
          actorUserId: null,
        },
      });
      await announcePaymentConfirmed(db, order.id);
      return 'confirmed' as const;
    }
    // The money arrived but the order is already past (or out of) the pending step: the report still needs the new payment status.
    await announceSnapshot(db, order.id);
    if (order.status === 'CANCELLED') {
      await alertAdmin(
        db,
        `⚠️ Order ${payment.order.number} was paid (${formatUsd(payment.amountCents)} via KHQR) but it is cancelled: please refund the customer, or restore the order by hand.`,
        `order:${order.id}:paid-after-cancel`,
      );
      return 'paid-after-cancel' as const;
    }
    return 'paid' as const;
  });

  if (outcome !== 'already') {
    kickEvents(deps);
    appMetrics(deps).khqrPayments.inc({ result: 'paid' });
    void publishOrderUpdate(deps, payment.orderId, 'payment');
  }
  if (outcome === 'confirmed') void publishOrderUpdate(deps, payment.orderId);
  return 'paid';
}

/** Close an unpaid payment and cancel its order (stock and promo use go back). */
async function expirePayment(deps: AppDeps, paymentId: string): Promise<boolean> {
  const { prisma, config } = deps;
  const cancelledOrderId = await prisma.$transaction(async (db) => {
    const claimed = await db.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    if (claimed.count === 0) return null;
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${p.orderId}::uuid FOR UPDATE`;
    const order = await db.order.findUniqueOrThrow({
      where: { id: p.orderId },
      include: { items: true },
    });
    if (order.status !== 'PENDING') return null;
    await cancelOrder(db, order, null, `Not paid within ${config.bakong.holdMinutes} minutes`);
    await announcePaymentExpired(db, order.id, config.bakong.holdMinutes);
    return order.id;
  });
  if (cancelledOrderId) {
    // The unpaid order's stock went back.
    await deps.cache.invalidate('catalog');
    kickEvents(deps);
    appMetrics(deps).khqrPayments.inc({ result: 'expired' });
    void publishOrderUpdate(deps, cancelledOrderId);
    void publishOrderUpdate(deps, cancelledOrderId, 'payment');
  }
  return Boolean(cancelledOrderId);
}

/**
 * One background pass: confirm paid KHQR orders the customer stopped watching, and
 * cancel those whose window closed (after one last check with Bakong). An order is
 * never cancelled while Bakong can't be reached: it might have been paid.
 */
export async function sweepKhqrPayments(
  deps: AppDeps,
): Promise<{ paid: number; expired: number; reminded: number }> {
  const now = Date.now();
  const open = await deps.prisma.payment.findMany({
    where: { method: 'KHQR', status: 'PENDING' },
    select: { id: true, expiresAt: true, lastCheckedAt: true },
  });
  let paid = 0;
  let expired = 0;
  for (const p of open) {
    const windowClosed = !!p.expiresAt && p.expiresAt.getTime() < now - GRACE_MS;
    if (!windowClosed && p.lastCheckedAt && now - p.lastCheckedAt.getTime() < SWEEP_RECHECK_MS)
      continue;
    const outcome = await checkKhqrPayment(deps, p.id, { force: true });
    if (outcome === 'paid') paid++;
    else if (windowClosed && outcome === 'unpaid' && (await expirePayment(deps, p.id))) expired++;
  }
  return { paid, expired, reminded: await remindClosingPayments(deps) };
}

/** Tell the customer when this little time is left to pay. */
const REMINDER_BEFORE_MS = 3 * 60_000;

/**
 * Once per payment, when about 3 minutes are left, message the customer so a forgotten order
 * isn't cancelled by surprise. Skipped when the whole window is too short for it to be useful.
 */
async function remindClosingPayments(deps: AppDeps): Promise<number> {
  const { prisma, config } = deps;
  if (config.bakong.holdMinutes * 60_000 <= 2 * REMINDER_BEFORE_MS) return 0;
  const now = Date.now();
  const due = await prisma.payment.findMany({
    where: {
      method: 'KHQR',
      status: 'PENDING',
      reminderSentAt: null,
      expiresAt: { gt: new Date(now), lte: new Date(now + REMINDER_BEFORE_MS) },
      order: { status: 'PENDING' },
    },
    select: { id: true, orderId: true, expiresAt: true },
  });
  let reminded = 0;
  for (const p of due) {
    const minutesLeft = Math.max(1, Math.ceil((p.expiresAt!.getTime() - now) / 60_000));
    const claimed = await prisma.$transaction(async (db) => {
      const c = await db.payment.updateMany({
        where: { id: p.id, status: 'PENDING', reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (c.count === 0) return false;
      await announcePaymentReminder(db, p.orderId, minutesLeft);
      return true;
    });
    if (claimed) reminded++;
  }
  if (reminded) kickEvents(deps);
  return reminded;
}

/** Run the sweep every `intervalMs`. Returns a stop function. */
export function startKhqrSweeper(deps: AppDeps, intervalMs = 20_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweepKhqrPayments(deps);
      if (r.paid || r.expired) deps.logger.info(r, 'KHQR sweep');
    } catch (err) {
      deps.logger.error({ err }, 'KHQR sweep failed');
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
