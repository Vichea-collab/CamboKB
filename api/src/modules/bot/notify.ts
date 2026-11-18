import type { OrderStatus } from '@prisma/client';
import { formatUsd } from '@cambo/shared';
import type { AppDeps } from '../../http/app';
import { enqueueTelegram } from './outbox';
import { orderKeyboard } from './order-actions';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const REGION = { PHNOM_PENH: 'Phnom Penh', PROVINCE: 'Province' } as const;
const SERVICE = { GRAB: 'Grab', VET: 'VET Express', JNT: 'J&T Express' } as const;
const PAYMENT = { COD: 'Cash on Delivery', KHQR: 'KHQR' } as const;

/** Queue a summary of a new order for the admin chat, with buttons to work the order. Never throws. */
export async function notifyNewOrder(deps: AppDeps, orderId: string): Promise<void> {
  const { prisma, config, logger } = deps;
  try {
    const chatId = config.telegram.adminChatId;
    if (!chatId) return;
    const settings = await prisma.storeSetting.findUnique({ where: { id: 1 } });
    if (settings && !settings.telegramNotify) return;
    const o = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payment: true, promoCode: true } });
    if (!o) return;

    const lines = [
      `🛒 <b>New order ${o.number}</b>`,
      `👤 ${escapeHtml(o.contactName)} · ${escapeHtml(o.contactPhone)}`,
      `🚚 ${REGION[o.region]} · ${SERVICE[o.deliveryService]}${o.distanceKm !== null ? ` · ${o.distanceKm} km` : ''}`,
      `📍 ${escapeHtml(o.addressLine)}`,
      ...(o.lat !== null && o.lng !== null ? [`🗺 https://maps.google.com/?q=${o.lat},${o.lng}`] : []),
      ...(o.note ? [`📝 ${escapeHtml(o.note)}`] : []),
      '',
      ...o.items.map((i) => `${i.quantity} × ${escapeHtml(i.name)} — ${formatUsd(i.lineTotalCents)}`),
      '',
      `Subtotal: ${formatUsd(o.subtotalCents)}`,
      `Delivery: ${formatUsd(o.deliveryFeeCents)}`,
      ...(o.discountCents ? [`Discount${o.promoCode ? ` (${escapeHtml(o.promoCode.code)})` : ''}: -${formatUsd(o.discountCents)}`] : []),
      `<b>Total: ${formatUsd(o.totalCents)}</b>`,
      `💳 ${o.payment ? PAYMENT[o.payment.method] : '—'}`,
      '',
      `${config.webOrigin[0] ?? ''}/admin/orders/${o.id}`,
    ];
    const text = lines.join('\n');

    await enqueueTelegram(deps, { chatId, text, parseMode: 'HTML', replyMarkup: orderKeyboard(o), dedupeKey: `order:${o.id}:admin:new` });
  } catch (err) {
    logger.error({ err, orderId }, 'new-order Telegram alert failed');
  }
}

export type CustomerEvent = OrderStatus | 'PAID' | 'PAYMENT_EXPIRED';

const STATUS_MESSAGE: Record<CustomerEvent, string> = {
  PENDING: '✅ We received your order {n}. Total {total}. We will confirm it shortly.',
  PAID: '💳 Payment received for order {n} ({total}). Your order is confirmed.',
  PAYMENT_EXPIRED: "⏰ Order {n} was cancelled because it wasn't paid within {hold} minutes. You can order again any time.",
  CONFIRMED: '👍 Your order {n} is confirmed.',
  PACKED: '📦 Your order {n} is packed and ready.',
  SHIPPING: '🚚 Your order {n} is on the way.',
  DELIVERED: '🎉 Your order {n} was delivered. Thank you for shopping with us!',
  CANCELLED: '❌ Your order {n} was cancelled. Message us if this is a surprise.',
};

/**
 * Tell the customer about their order on Telegram, in the chat they signed up from.
 * Needs no extra setup: customers have already started the bot. Never throws; the order
 * and the admin's status change always succeed even when Telegram is down. Internal
 * admin notes are never included.
 */
export async function notifyCustomer(deps: AppDeps, orderId: string, status: CustomerEvent): Promise<void> {
  const { prisma, config, logger } = deps;
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true, payment: true } });
    const chatId = order?.user.telegramChatId;
    if (!order || !chatId || order.user.disabledAt) return;
    const text = [
      (status === 'PENDING' && order.payment?.method === 'KHQR' && order.payment.status === 'PENDING'
        ? '🧾 We received your order {n}. Pay {total} with KHQR within {hold} minutes to confirm it.'
        : STATUS_MESSAGE[status]
      )
        .replace('{n}', order.number)
        .replace('{total}', formatUsd(order.totalCents))
        .replace('{hold}', String(config.bakong.holdMinutes)),
      '',
      `${config.webOrigin[0] ?? ''}/account/orders/${order.number}`,
    ].join('\n');
    await enqueueTelegram(deps, { chatId, text, dedupeKey: `order:${orderId}:customer:${status}` });
  } catch (err) {
    logger.warn({ err, orderId, status }, 'customer Telegram message failed');
  }
}

/** A message to the admin chat (if set up and alerts are on). Never throws. */
export async function notifyAdmin(deps: AppDeps, text: string, opts: { replyMarkup?: unknown; dedupeKey?: string } = {}): Promise<void> {
  const { prisma, config, logger } = deps;
  try {
    const chatId = config.telegram.adminChatId;
    if (!chatId) return;
    const settings = await prisma.storeSetting.findUnique({ where: { id: 1 } });
    if (settings && !settings.telegramNotify) return;
    await enqueueTelegram(deps, { chatId, text, ...opts });
  } catch (err) {
    logger.warn({ err }, 'admin Telegram message failed');
  }
}
