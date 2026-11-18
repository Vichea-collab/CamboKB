import type { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import type { TgCallbackQuery } from '../../integrations/telegram/client';
import { changeOrderStatus } from '../orders/status';

/** Buttons under an order alert, so the shop can work an order from Telegram. */

const LABEL: Record<OrderStatus, string> = {
  PENDING: '🆕 Pending',
  CONFIRMED: '✅ Confirmed',
  PACKED: '📦 Packed',
  SHIPPING: '🚚 On the way',
  DELIVERED: '🎉 Delivered',
  CANCELLED: '❌ Cancelled',
};

/** The one step forward from each status, and the short code that goes in the button. */
const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; text: string; code: string }>> = {
  PENDING: { status: 'CONFIRMED', text: '✅ Confirm order', code: 'c' },
  CONFIRMED: { status: 'PACKED', text: '📦 Mark packed', code: 'p' },
  PACKED: { status: 'SHIPPING', text: '🚚 Out for delivery', code: 's' },
  SHIPPING: { status: 'DELIVERED', text: '🎉 Mark delivered', code: 'd' },
};
const CODE_TO_STATUS: Record<string, OrderStatus> = { c: 'CONFIRMED', p: 'PACKED', s: 'SHIPPING', d: 'DELIVERED' };
const CANCELLABLE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PACKED'];

type KeyboardOrder = { id: string; status: OrderStatus; payment?: { method: PaymentMethod; status: PaymentStatus } | null };

/** callback_data is limited to 64 bytes: "o:" + uuid + ":" + code is 40. */
const data = (orderId: string, code: string) => `o:${orderId}:${code}`;

export function orderKeyboard(o: KeyboardOrder, askCancel = false) {
  // An unpaid KHQR order confirms itself when the money arrives, or cancels itself when the time is up.
  const awaitingPayment = o.status === 'PENDING' && o.payment?.method === 'KHQR' && o.payment.status === 'PENDING';
  const rows: { text: string; callback_data: string }[][] = [[{ text: awaitingPayment ? '⏳ Waiting for KHQR payment' : LABEL[o.status], callback_data: 'noop' }]];
  if (awaitingPayment) return { inline_keyboard: rows };
  if (askCancel && CANCELLABLE.includes(o.status)) {
    rows.push([
      { text: '⚠️ Yes, cancel it', callback_data: data(o.id, 'X') },
      { text: '↩️ Keep order', callback_data: data(o.id, 'k') },
    ]);
    return { inline_keyboard: rows };
  }
  const action: { text: string; callback_data: string }[] = [];
  const next = NEXT[o.status];
  if (next) action.push({ text: next.text, callback_data: data(o.id, next.code) });
  if (CANCELLABLE.includes(o.status)) action.push({ text: '❌ Cancel', callback_data: data(o.id, 'x') });
  if (action.length) rows.push(action);
  return { inline_keyboard: rows };
}

/** Only the shop owner's chat may press these: the admin chat, and in a group only linked admins. */
async function isAllowed(deps: AppDeps, cq: TgCallbackQuery): Promise<{ ok: boolean; actorUserId: string | null }> {
  const adminChat = deps.config.telegram.adminChatId;
  if (!adminChat || !cq.message || String(cq.message.chat.id) !== adminChat) return { ok: false, actorUserId: null };
  const admin = await deps.prisma.user.findFirst({ where: { telegramUserId: BigInt(cq.from.id), role: 'ADMIN', disabledAt: null }, select: { id: true } });
  // In a private chat with the bot the chat id is the person's own id.
  const ok = Boolean(admin) || String(cq.from.id) === adminChat;
  return { ok, actorUserId: admin?.id ?? null };
}

/** A tap on an inline button. Always answers the tap, so the button never hangs. */
export async function handleCallbackQuery(deps: AppDeps, cq: TgCallbackQuery): Promise<void> {
  const { telegram, prisma, logger } = deps;
  const answer = (text?: string, alert = false) => telegram.answerCallbackQuery(cq.id, text, alert).catch((err) => logger.warn({ err }, 'answerCallbackQuery failed'));
  const m = /^o:([0-9a-f-]{36}):([cpsdxXk])$/.exec(cq.data ?? '');
  if (!m) return void (await answer());

  const { ok, actorUserId } = await isAllowed(deps, cq);
  if (!ok) {
    logger.warn({ fromId: cq.from.id, chatId: cq.message?.chat.id }, 'Telegram order button pressed by someone not allowed');
    return void (await answer('Only the shop admin can do this.', true));
  }

  const orderId = m[1]!;
  const code = m[2]!;
  const show = async (askCancel = false) => {
    const o = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (o && cq.message) {
      await telegram.editReplyMarkup(cq.message.chat.id, cq.message.message_id, orderKeyboard(o, askCancel)).catch((err) => logger.debug({ err }, 'could not update buttons'));
    }
    return o;
  };

  try {
    if (code === 'x') {
      await show(true);
      return void (await answer('Cancel this order?'));
    }
    if (code === 'k') {
      await show();
      return void (await answer());
    }
    const target: OrderStatus = code === 'X' ? 'CANCELLED' : CODE_TO_STATUS[code]!;
    const { number } = await changeOrderStatus(deps, orderId, target, actorUserId, 'via Telegram');
    await show();
    await answer(`${number} → ${LABEL[target].replace(/^\S+\s/, '')}`);
  } catch (err) {
    if (err instanceof AppError && (err.status === 409 || err.status === 404)) {
      // Someone already moved this order (the website, or another tap). Show where it really is.
      const o = await show();
      return void (await answer(o ? `Order ${o.number} is already ${LABEL[o.status].replace(/^\S+\s/, '')}.` : 'Order not found.', true));
    }
    logger.error({ err, orderId, code }, 'Telegram order button failed');
    await answer('Something went wrong. Try again from the website.', true);
  }
}
