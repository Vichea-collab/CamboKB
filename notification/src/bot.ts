import { currentRequestId } from '@cambo/service-kit';
import { telegramUpdateSchema, type OrderStatus } from '@cambo/shared';
import { ApiError, type ApiClient } from './api-client';
import {
  BUTTON_PATTERN,
  CODE_TO_STATUS,
  LETTER_TO_STATUS,
  orderKeyboard,
  plainLabel,
} from './buttons';
import type { NotificationConfig } from './config';
import type { Logger } from './logger';
import type { Outbox } from './outbox';
import type { TelegramClient, TgCallbackQuery, TgUpdate } from './telegram';

export type BotDeps = {
  config: NotificationConfig;
  telegram: TelegramClient;
  api: ApiClient;
  outbox: Outbox;
  logger: Logger;
};

/**
 * One update from Telegram. Order buttons are handled here (they only need the api's order rules);
 * every chat message is forwarded to the api, which owns accounts and orders and answers with what to say.
 */
export async function handleUpdate(deps: BotDeps, update: TgUpdate): Promise<void> {
  if (update.callback_query) return handleButton(deps, update.callback_query);
  const parsed = telegramUpdateSchema.safeParse(update);
  if (!parsed.success || !parsed.data.message) return;
  const chatId = parsed.data.message.chat.id;
  try {
    const actions = await deps.api.forwardUpdate(parsed.data);
    for (const a of actions) {
      await deps.outbox.enqueue({
        chatId: a.chatId,
        text: a.text,
        parseMode: a.parseMode,
        replyMarkup: a.replyMarkup,
        requestId: currentRequestId(),
      });
    }
  } catch (err) {
    deps.logger.error(
      { err, chatId },
      'could not get an answer from the api for a Telegram message',
    );
    if (parsed.data.message.chat.type === 'private')
      await deps.outbox.enqueue({
        chatId,
        text: 'Sorry, something went wrong on our side. Please try again in a moment.',
      });
  }
}

/** A tap on an inline button. Always answers the tap, so the button never hangs. */
async function handleButton(deps: BotDeps, cq: TgCallbackQuery): Promise<void> {
  const { telegram, api, logger, config } = deps;
  const answer = (text?: string, alert = false) =>
    telegram
      .answerCallbackQuery(cq.id, text, alert)
      .catch((err) => logger.warn({ err }, 'answerCallbackQuery failed'));
  const m = BUTTON_PATTERN.exec(cq.data ?? '');
  if (!m) return void (await answer());

  // Only the owner's chat may press these.
  const adminChat = config.telegram.adminChatId;
  if (!adminChat || !cq.message || String(cq.message.chat.id) !== adminChat) {
    logger.warn(
      { fromId: cq.from.id, chatId: cq.message?.chat.id },
      'Telegram order button pressed outside the admin chat',
    );
    return void (await answer('Only the shop admin can do this.', true));
  }
  // In the owner's private chat the chat id is the person's own id. In a group the api must also see a linked admin account.
  const requireLinkedAdmin = String(cq.from.id) !== adminChat;

  const orderId = m[1]!;
  const code = m[2]!;
  const known = m[3] ? LETTER_TO_STATUS[m[3]] : undefined;
  const show = (status: OrderStatus, askCancel = false) =>
    cq.message
      ? telegram
          .editReplyMarkup(
            cq.message.chat.id,
            cq.message.message_id,
            orderKeyboard({ id: orderId, status }, askCancel),
          )
          .catch((err) => logger.debug({ err }, 'could not update buttons'))
      : Promise.resolve();

  try {
    if (code === 'x') {
      if (known) await show(known, true);
      return void (await answer('Cancel this order?'));
    }
    if (code === 'k') {
      if (known) await show(known);
      return void (await answer());
    }
    const target: OrderStatus = code === 'X' ? 'CANCELLED' : CODE_TO_STATUS[code]!;
    const done = await api.changeOrderStatus(orderId, {
      status: target,
      telegramUserId: cq.from.id,
      requireLinkedAdmin,
    });
    await show(done.status);
    await answer(`${done.number} → ${plainLabel(done.status)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403)
      return void (await answer('Only the shop admin can do this.', true));
    if (err instanceof ApiError && err.status === 409 && err.details?.status) {
      // Someone already moved this order (the website, or another tap). Show where it really is.
      await show(err.details.status);
      return void (await answer(
        `Order ${err.details.number ?? ''} is already ${plainLabel(err.details.status)}.`.replace(
          '  ',
          ' ',
        ),
        true,
      ));
    }
    if (err instanceof ApiError && err.status === 404)
      return void (await answer('Order not found.', true));
    logger.error({ err, orderId, code }, 'Telegram order button failed');
    await answer(
      err instanceof ApiError && err.status === 0
        ? 'The shop is not reachable right now. Try again in a moment.'
        : 'Something went wrong. Try again from the website.',
      true,
    );
  }
}
