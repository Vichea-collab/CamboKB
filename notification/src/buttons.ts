import type { OrderStatus } from '@cambo/shared';

/** Buttons under an order alert, so the shop can work an order from Telegram. */

export const LABEL: Record<OrderStatus, string> = {
  PENDING: '🆕 Pending',
  CONFIRMED: '✅ Confirmed',
  PACKED: '📦 Packed',
  SHIPPING: '🚚 On the way',
  DELIVERED: '🎉 Delivered',
  CANCELLED: '❌ Cancelled',
};
export const plainLabel = (s: OrderStatus) => LABEL[s].replace(/^\S+\s/, '');

/** The one step forward from each status, and the short code that goes in the button. */
const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; text: string; code: string }>> = {
  PENDING: { status: 'CONFIRMED', text: '✅ Confirm order', code: 'c' },
  CONFIRMED: { status: 'PACKED', text: '📦 Mark packed', code: 'p' },
  PACKED: { status: 'SHIPPING', text: '🚚 Out for delivery', code: 's' },
  SHIPPING: { status: 'DELIVERED', text: '🎉 Mark delivered', code: 'd' },
};
export const CODE_TO_STATUS: Record<string, OrderStatus> = {
  c: 'CONFIRMED',
  p: 'PACKED',
  s: 'SHIPPING',
  d: 'DELIVERED',
};
/** The status the order had when the keyboard was drawn, kept in the button so "cancel?" and "keep" need no lookup. */
const STATUS_LETTER: Record<OrderStatus, string> = {
  PENDING: 'p',
  CONFIRMED: 'c',
  PACKED: 'k',
  SHIPPING: 's',
  DELIVERED: 'd',
  CANCELLED: 'x',
};
export const LETTER_TO_STATUS: Record<string, OrderStatus> = Object.fromEntries(
  Object.entries(STATUS_LETTER).map(([s, l]) => [l, s as OrderStatus]),
);
const CANCELLABLE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PACKED'];

/** callback_data is limited to 64 bytes: "o:" + uuid + ":x:" + letter is 42. */
const data = (orderId: string, code: string, status?: OrderStatus) =>
  `o:${orderId}:${code}${status ? `:${STATUS_LETTER[status]}` : ''}`;
export const BUTTON_PATTERN = /^o:([0-9a-f-]{36}):([cpsdxXk])(?::([pckdsx]))?$/;

type Button = { text: string; callback_data: string };

export function orderKeyboard(
  o: { id: string; status: OrderStatus; awaitingPayment?: boolean },
  askCancel = false,
) {
  // An unpaid KHQR order confirms itself when the money arrives, or cancels itself when the time is up.
  const rows: Button[][] = [
    [
      {
        text: o.awaitingPayment ? '⏳ Waiting for KHQR payment' : LABEL[o.status],
        callback_data: 'noop',
      },
    ],
  ];
  if (o.awaitingPayment) return { inline_keyboard: rows };
  if (askCancel && CANCELLABLE.includes(o.status)) {
    rows.push([
      { text: '⚠️ Yes, cancel it', callback_data: data(o.id, 'X') },
      { text: '↩️ Keep order', callback_data: data(o.id, 'k', o.status) },
    ]);
    return { inline_keyboard: rows };
  }
  const action: Button[] = [];
  const next = NEXT[o.status];
  if (next) action.push({ text: next.text, callback_data: data(o.id, next.code) });
  if (CANCELLABLE.includes(o.status))
    action.push({ text: '❌ Cancel', callback_data: data(o.id, 'x', o.status) });
  if (action.length) rows.push(action);
  return { inline_keyboard: rows };
}
