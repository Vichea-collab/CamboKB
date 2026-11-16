import { formatUsd } from '@cambo/shared';
import type { AppDeps } from '../app';

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
