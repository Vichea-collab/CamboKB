import type { OrderStatus } from '@prisma/client';
import { formatUsd } from '@cambo/shared';
import type { AppDeps } from '../../http/app';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const REGION = { PHNOM_PENH: 'Phnom Penh', PROVINCE: 'Province' } as const;
const SERVICE = { GRAB: 'Grab', VET: 'VET Express', JNT: 'J&T Express' } as const;
const PAYMENT = { COD: 'Cash on Delivery', KHQR: 'KHQR' } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send the admin chat a summary of a new order. Retries, then logs; never throws. */
export async function notifyNewOrder(deps: AppDeps, orderId: string, backoffMs: number[] = [1000, 3000]): Promise<void> {
  const { prisma, telegram, config, logger } = deps;
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

    for (let attempt = 0; ; attempt++) {
      try {
        await telegram.sendMessage(chatId, text, { parseMode: 'HTML' });
        return;
      } catch (err) {
        if (attempt >= backoffMs.length) throw err;
        await sleep(backoffMs[attempt]!);
      }
    }
  } catch (err) {
    logger.error({ err, orderId }, 'new-order Telegram alert failed');
  }
}

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  PENDING: '✅ We received your order {n}. Total {total}. We will confirm it shortly.',
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
export async function notifyCustomer(deps: AppDeps, orderId: string, status: OrderStatus, backoffMs: number[] = [1000]): Promise<void> {
  const { prisma, telegram, config, logger } = deps;
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    const chatId = order?.user.telegramChatId;
    if (!order || !chatId || order.user.disabledAt) return;
    const text = [
      STATUS_MESSAGE[status].replace('{n}', order.number).replace('{total}', formatUsd(order.totalCents)),
      '',
      `${config.webOrigin[0] ?? ''}/account/orders/${order.number}`,
    ].join('\n');
    for (let attempt = 0; ; attempt++) {
      try {
        await telegram.sendMessage(Number(chatId), text);
        return;
      } catch (err) {
        if (attempt >= backoffMs.length) throw err;
        await sleep(backoffMs[attempt]!);
      }
    }
  } catch (err) {
    logger.warn({ err, orderId, status }, 'customer Telegram message failed');
  }
}
