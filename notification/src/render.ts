import { formatPhone, formatUsd, type OrderSnapshot } from '@cambo/shared';

/** What the messages say. Pure functions of the event data: easy to read, easy to test. */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const REGION = { PHNOM_PENH: 'Phnom Penh', PROVINCE: 'Province' } as const;
const SERVICE = { GRAB: 'Grab', VET: 'VET Express', JNT: 'J&T Express' } as const;
const PAYMENT = { COD: 'Cash on Delivery', KHQR: 'KHQR' } as const;

const awaitingKhqr = (o: OrderSnapshot) =>
  o.status === 'PENDING' && o.payment?.method === 'KHQR' && o.payment.status === 'PENDING';

/** The shop owner's summary of a new order (HTML). */
export function newOrderAlert(o: OrderSnapshot, webOrigin: string): string {
  return [
    `🛒 <b>New order ${o.number}</b>`,
    `👤 ${escapeHtml(o.contactName)} · ${escapeHtml(o.contactPhone)}`,
    `🚚 ${REGION[o.region]} · ${SERVICE[o.deliveryService]}${o.distanceKm !== null ? ` · ${o.distanceKm} km` : ''}`,
    `📍 ${escapeHtml(o.addressLine)}`,
    ...(o.lat !== null && o.lng !== null
      ? [`🗺 <a href="https://maps.google.com/?q=${o.lat},${o.lng}">Open map pin</a>`]
      : o.deliveryService === 'GRAB'
        ? ['⚠️ No map pin: ask the customer where to deliver']
        : []),
    ...(o.note ? [`📝 ${escapeHtml(o.note)}`] : []),
    '',
    ...o.items.map((i) => `${i.quantity} × ${escapeHtml(i.name)} — ${formatUsd(i.lineTotalCents)}`),
    '',
    `Subtotal: ${formatUsd(o.subtotalCents)}`,
    `Delivery: ${formatUsd(o.deliveryFeeCents)}`,
    ...(o.discountCents
      ? [
          `Discount${o.promoCode ? ` (${escapeHtml(o.promoCode)})` : ''}: -${formatUsd(o.discountCents)}`,
        ]
      : []),
    `<b>Total: ${formatUsd(o.totalCents)}</b>`,
    `💳 ${o.payment ? PAYMENT[o.payment.method] : '—'}`,
    '',
    `${webOrigin}/admin/orders/${o.id}`,
  ].join('\n');
}

export const paymentReceivedAlert = (o: OrderSnapshot) =>
  `💰 Payment received: order ${o.number}, ${formatUsd(o.totalCents)} via KHQR. The order is confirmed.`;

/** Stock running low, or gone: the owner can open the product to restock. */
export function lowStockAlert(p: { productId: string; name: string; stock: number }, webOrigin: string): string {
  const head = p.stock === 0 ? `🚫 <b>Sold out</b>: ${escapeHtml(p.name)}` : `⚠️ <b>Low stock</b>: ${escapeHtml(p.name)} — only ${p.stock} left.`;
  return [head, `${webOrigin}/admin/products/${p.productId}`].join('\n');
}

export const newCustomerAlert = (c: { name: string; phone: string; telegramUsername: string | null }) =>
  `👋 <b>New customer</b>: ${escapeHtml(c.name)} · ${escapeHtml(formatPhone(c.phone))}${c.telegramUsername ? ` · @${escapeHtml(c.telegramUsername)}` : ''}`;

/** Telegram only opens a Mini App from an https address. On http (local development) the message carries a plain link. */
export const canOpenInTelegram = (webOrigin: string) => webOrigin.startsWith('https://');
export const orderUrl = (webOrigin: string, number: string) =>
  `${webOrigin}/account/orders/${encodeURIComponent(number)}`;

export const payUrl = (webOrigin: string, number: string) =>
  `${webOrigin}/orders/${encodeURIComponent(number)}/pay`;

export type CustomerKind = 'placed' | 'status' | 'paid' | 'expired' | 'tracking' | 'reminder';

const STATUS_MESSAGE: Record<string, string> = {
  CONFIRMED: '👍 Your order {n} is confirmed.',
  PACKED: '📦 Your order {n} is packed and ready.',
  SHIPPING: '🚚 Your order {n} is on the way.',
  DELIVERED: '🎉 Your order {n} was delivered. Thank you for shopping with us!',
  CANCELLED: '❌ Your order {n} was cancelled. Message us if this is a surprise.',
};

/** The customer's message for one thing that happened to their order. Internal admin notes are never included. */
export function customerMessage(
  kind: CustomerKind,
  o: OrderSnapshot,
  ctx: { webOrigin: string; holdMinutes?: number; minutesLeft?: number },
): string {
  let text: string;
  if (kind === 'placed') {
    text = awaitingKhqr(o)
      ? '🧾 We received your order {n}. Pay {total} with KHQR within {hold} minutes to confirm it.'
      : '✅ We received your order {n}. Total {total}. We will confirm it shortly.';
  } else if (kind === 'paid')
    text = '💳 Payment received for order {n} ({total}). Your order is confirmed.';
  else if (kind === 'expired')
    text =
      "⏰ Order {n} expired because it wasn't paid within {hold} minutes. You can order again any time.";
  else if (kind === 'reminder')
    text = '⏳ Order {n} is still waiting for payment. Pay {total} with KHQR within {mins}, or the order will be cancelled.';
  else if (kind === 'tracking')
    text = "📮 Tracking number for order {n}: {tracking} ({carrier}). Use it on the carrier's app or website to follow your parcel.";
  else text = STATUS_MESSAGE[o.status] ?? '📌 Your order {n} is now {status}.';
  const body = text
    .replace('{n}', o.number)
    .replace('{total}', formatUsd(o.totalCents))
    .replace('{hold}', String(ctx.holdMinutes ?? 10))
    .replace('{status}', o.status.toLowerCase())
    .replace('{mins}', `${ctx.minutesLeft ?? 1} ${ctx.minutesLeft === 1 || ctx.minutesLeft === undefined ? 'minute' : 'minutes'}`)
    .replace('{tracking}', o.trackingNumber ?? '')
    .replace('{carrier}', SERVICE[o.deliveryService]);
  // With the button (https) the link would only repeat it.
  return canOpenInTelegram(ctx.webOrigin)
    ? body
    : [body, '', kind === 'reminder' ? payUrl(ctx.webOrigin, o.number) : orderUrl(ctx.webOrigin, o.number)].join('\n');
}

/** The button under a customer's message: opens their order (or the shop, after an expired order) as a Mini App. */
export function customerKeyboard(kind: CustomerKind, o: OrderSnapshot, webOrigin: string) {
  if (!canOpenInTelegram(webOrigin)) return undefined;
  const button =
    kind === 'expired'
      ? { text: '🛒 Order again', web_app: { url: webOrigin } }
      : kind === 'reminder'
        ? { text: '💳 Pay now', web_app: { url: payUrl(webOrigin, o.number) } }
        : { text: '📦 View my order', web_app: { url: orderUrl(webOrigin, o.number) } };
  return { inline_keyboard: [[button]] };
}
