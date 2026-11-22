import { Prisma, type TelegramAuthRequest } from '@prisma/client';
import type { AppDeps } from '../../http/app';
import { sha256 } from '../auth/sessions';
import { issueLoginLink, telegramDisplayName } from '../auth/telegram-verification';
import { announceCustomerSignedUp } from '../events/snapshot';
import { kickEvents } from '../events/outbox';
import {
  BOT_COMMANDS,
  formatUsd,
  normalizePhone,
  PHNOM_PENH_OFFSET_MS,
  type BotAction,
} from '@cambo/shared';
import type { TgMessage, TgUpdate } from '../../integrations/telegram/types';

export const BOT_TEXT = {
  askContact: 'Tap the button below to share your phone number with Cambo Supply.',
  shareButton: '📱 Share my phone number',
  expired: 'This link has expired. Please start again on the website.',
  ownNumber: 'Please share your own phone number using the button.',
  alreadyRegistered:
    'This number already has an account. On the website, tap Continue with Telegram to log in.',
  welcomeNew:
    'Welcome to Cambo Supply! 👋\n\nTo create your account, tap the button below to share your phone number. Then we send you a link that logs you in.',
  cannotVerify:
    "We couldn't verify this account. Please check the number and try again on the website.",
  phoneInUse: 'This number is already used by another account.',
  verified: '✅ Verified! Go back to the website to continue.',
  verifiedOpenLink: '✅ Verified! Tap the button to open Cambo Supply. You will be logged in.',
  loginDone: '✅ Done! Go back to the website: you are logged in.',
  loginAskConfirm: 'Tap ✅ Log me in on the message above to continue.',
  loginDeclined: 'Okay, nobody was logged in. If this was not you, you can ignore it.',
  loginExpired: 'This login request has expired. Please start again on the website.',
  loginNotYours: 'This login request is for a different Telegram account.',
  loginAskPhone:
    'Share your phone number with the button below to link this Telegram to Cambo Supply and log in.',
  phoneLinkedElsewhere:
    'That phone number belongs to an account linked to a different Telegram account. Please contact the shop.',
  logInButton: '✅ Log me in',
  notMeButton: '🚫 Not me',
  noPending: 'Please open the sign-up link from the Cambo Supply website first.',
  unknownMessage:
    'I only understand commands. Try /shop to open the store, /orders for your latest orders, or /help.',
  invalidPhone: "That phone number doesn't look valid.",
  askLocation:
    "Tap the button below to share where we should deliver. You can also send any other spot from the 📎 menu → Location. (Telegram on a computer can't send a location: use your phone, or tap “Use my location” on the checkout page.)",
  locationUnsupported:
    "Your Telegram app can't send a location (Telegram on a computer can't). Open Telegram on your phone, or go back to checkout and tap “Use my location” or drag the pin on the map.",
  shareLocationButton: '📍 Share my location',
  locationSaved: '✅ Got your location! Go back to checkout: your delivery fee is updated.',
  backToCheckout: 'Tap the button to go back to checkout. Your location is already there.',
  backToCheckoutButton: '🛒 Back to checkout',
  locationNotYours:
    'This link is for a different Cambo Supply account. Open checkout on the website and try again.',
  noLocationRequest:
    'Open checkout on the Cambo Supply website and tap “Share location in Telegram” first.',
} as const;

const removeKeyboard = { remove_keyboard: true };

type SendOptions = { replyMarkup?: unknown; parseMode?: 'HTML' };
/** What to say back. The api never talks to Telegram: it returns these and the notification service sends them. */
type Say = (chatId: number, text: string, opts?: SendOptions) => void;

/**
 * A chat message the notification service forwarded. Returns the messages to send in answer.
 * (Order buttons and the owner's alerts are handled by the notification service itself.)
 */
export async function handleTelegramUpdate(deps: AppDeps, update: TgUpdate): Promise<BotAction[]> {
  const actions: BotAction[] = [];
  const say: Say = (chatId, text, opts = {}) => {
    actions.push({
      type: 'send',
      chatId,
      text,
      ...(opts.parseMode ? { parseMode: opts.parseMode } : {}),
      ...(opts.replyMarkup !== undefined ? { replyMarkup: opts.replyMarkup } : {}),
    });
  };
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot || msg.chat.type !== 'private') return actions;
  if (msg.text?.startsWith('/start')) await handleStart(deps, msg, say);
  else if (msg.contact) await handleContact(deps, msg, say);
  else if (msg.location) await handleLocation(deps, msg, say);
  // An app that can't send locations posts the button's label as an ordinary message instead.
  else if (msg.text === BOT_TEXT.shareLocationButton)
    say(msg.chat.id, BOT_TEXT.locationUnsupported, { replyMarkup: removeKeyboard });
  else {
    const command = /^\/(\w+)(?:@\w+)?/.exec(msg.text ?? '')?.[1]?.toLowerCase();
    if (command === 'orders') await handleOrders(deps, msg, say);
    else if (command === 'shop') handleShop(deps, msg, say);
    else if (command === 'help') handleHelp(msg, say);
    else await handleOther(deps, msg, say);
  }
  return actions;
}

/**
 * Anything that isn't a command. A customer who already has an account is pointed at the commands;
 * someone without one is pointed at sign-up.
 */
async function handleOther(deps: AppDeps, msg: TgMessage, say: Say) {
  const user = await deps.prisma.user.findUnique({
    where: { telegramUserId: BigInt(msg.from!.id) },
    select: { id: true },
  });
  if (user) say(msg.chat.id, BOT_TEXT.unknownMessage);
  else say(msg.chat.id, `${BOT_TEXT.noPending}\n${deps.config.webOrigin[0] ?? ''}`);
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  SHIPPING: 'On the way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const COMMANDS = BOT_COMMANDS;

const origin = (deps: AppDeps) => deps.config.webOrigin[0] ?? '';

const shareKeyboard = {
  keyboard: [[{ text: BOT_TEXT.shareButton, request_contact: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
};

const locationKeyboard = {
  keyboard: [[{ text: BOT_TEXT.shareLocationButton, request_location: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
};

/**
 * What someone sees when they open the bot by hand. A new person is asked for their phone number
 * right here (sign-up starts in the bot); a returning customer is welcomed back.
 */
async function sendWelcome(deps: AppDeps, msg: TgMessage, say: Say) {
  const user = await deps.prisma.user.findUnique({
    where: { telegramUserId: BigInt(msg.from!.id) },
  });
  if (!user) {
    say(msg.chat.id, BOT_TEXT.welcomeNew, { replyMarkup: shareKeyboard });
    return;
  }
  const url = origin(deps);
  const secure = url.startsWith('https://');
  const text = [
    `Welcome back, ${user.name}! 👋`,
    '',
    ...COMMANDS.map((c) => `/${c.command} — ${c.description}`),
    ...(secure ? [] : ['', url]),
  ].join('\n');
  say(
    msg.chat.id,
    text,
    secure
      ? { replyMarkup: { inline_keyboard: [[{ text: '🛒 Open Cambo Supply', web_app: { url } }]] } }
      : undefined,
  );
}

function handleHelp(msg: TgMessage, say: Say) {
  say(
    msg.chat.id,
    [
      'Cambo Supply bot',
      '',
      ...COMMANDS.map((c) => `/${c.command} — ${c.description}`),
      '',
      'We message you here when your order is confirmed, on the way and delivered.',
    ].join('\n'),
  );
}

function handleShop(deps: AppDeps, msg: TgMessage, say: Say) {
  const url = origin(deps);
  // Telegram only opens Mini Apps from https links.
  if (url.startsWith('https://')) {
    say(msg.chat.id, 'Tap below to open the store.', {
      replyMarkup: { inline_keyboard: [[{ text: '🛒 Open Cambo Supply', web_app: { url } }]] },
    });
  } else {
    say(msg.chat.id, `Shop at ${url}`);
  }
}

async function handleOrders(deps: AppDeps, msg: TgMessage, say: Say) {
  const { prisma } = deps;
  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(msg.from!.id) } });
  if (!user) {
    say(msg.chat.id, `You don't have an account yet. Create one here: ${origin(deps)}/signup`);
    return;
  }
  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  if (!orders.length) {
    say(msg.chat.id, `You haven't ordered anything yet. Start here: ${origin(deps)}`);
    return;
  }
  const lines = orders.map(
    (o) => `${o.number} · ${STATUS_LABEL[o.status] ?? o.status} · ${formatUsd(o.totalCents)}`,
  );
  say(
    msg.chat.id,
    ['Your latest orders:', '', ...lines, '', `Details: ${origin(deps)}/account/orders`].join('\n'),
  );
}

async function handleStart(deps: AppDeps, msg: TgMessage, say: Say) {
  const { prisma } = deps;
  const token = msg.text!.split(/\s+/)[1];
  if (!token) {
    await sendWelcome(deps, msg, say);
    return;
  }
  const from = msg.from!;
  const request = await prisma.telegramAuthRequest.findUnique({
    where: { tokenHash: sha256(token) },
  });
  const usable =
    request &&
    request.status === 'PENDING' &&
    request.expiresAt.getTime() > Date.now() &&
    (request.telegramUserId === null || request.telegramUserId === BigInt(from.id));
  if (!usable) {
    say(msg.chat.id, BOT_TEXT.expired, { replyMarkup: removeKeyboard });
    return;
  }
  if (request.purpose === 'LOGIN') return void (await handleLoginStart(deps, msg, request, say));
  // Sharing a delivery location: only the Telegram account linked to the customer who asked may answer.
  if (request.purpose === 'SHARE_LOCATION') {
    const owner = request.userId
      ? await prisma.user.findUnique({ where: { id: request.userId } })
      : null;
    if (!owner || owner.telegramUserId !== BigInt(from.id)) {
      say(msg.chat.id, BOT_TEXT.locationNotYours, { replyMarkup: removeKeyboard });
      return;
    }
    await prisma.telegramAuthRequest.update({
      where: { id: request.id },
      data: { telegramUserId: BigInt(from.id), telegramChatId: BigInt(msg.chat.id) },
    });
    say(msg.chat.id, BOT_TEXT.askLocation, { replyMarkup: locationKeyboard });
    return;
  }
  await prisma.telegramAuthRequest.update({
    where: { id: request.id },
    data: {
      telegramUserId: BigInt(from.id),
      telegramChatId: BigInt(msg.chat.id),
      telegramUsername: from.username ?? null,
      firstName: telegramDisplayName(from),
    },
  });
  say(msg.chat.id, BOT_TEXT.askContact, { replyMarkup: shareKeyboard });
}

/** The customer tapped "Share my location": hand it to the checkout page that asked for it. */
async function handleLocation(deps: AppDeps, msg: TgMessage, say: Say) {
  const { prisma } = deps;
  const from = msg.from!;
  // Only a request this Telegram account opened (the /start link) can receive a location.
  const request = await prisma.telegramAuthRequest.findFirst({
    where: {
      telegramUserId: BigInt(from.id),
      purpose: 'SHARE_LOCATION',
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!request) {
    say(msg.chat.id, BOT_TEXT.noLocationRequest, { replyMarkup: removeKeyboard });
    return;
  }
  const { latitude, longitude } = msg.location!;
  await prisma.telegramAuthRequest.update({
    where: { id: request.id },
    data: { status: 'VERIFIED', lat: latitude, lng: longitude, verifiedAt: new Date() },
  });
  say(msg.chat.id, BOT_TEXT.locationSaved, { replyMarkup: removeKeyboard });
  // On https the customer can step straight back into the store as a Mini App (the page picks the location up).
  // Telegram can't carry two keyboards in one message, so the button comes in its own.
  const url = origin(deps);
  if (url.startsWith('https://')) {
    say(msg.chat.id, BOT_TEXT.backToCheckout, {
      replyMarkup: {
        inline_keyboard: [
          [{ text: BOT_TEXT.backToCheckoutButton, web_app: { url: `${url}/checkout` } }],
        ],
      },
    });
  }
}

async function handleContact(deps: AppDeps, msg: TgMessage, say: Say) {
  const { prisma } = deps;
  const from = msg.from!;
  const reply = (text: string, keep = false) =>
    say(msg.chat.id, text, keep ? undefined : { replyMarkup: removeKeyboard });

  const request = await prisma.telegramAuthRequest.findFirst({
    where: { telegramUserId: BigInt(from.id), status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  // Only the sender's own contact proves they own the number (forwarded contacts carry someone else's user_id).
  if (msg.contact!.user_id !== from.id) return void reply(BOT_TEXT.ownNumber, true);

  const phone = normalizePhone(msg.contact!.phone_number);
  if (!phone) return void reply(BOT_TEXT.invalidPhone);

  const owner = await prisma.user.findUnique({ where: { phone } });

  // No login started on the website: this person started in the bot. Their number is verified, so create the
  // account (the name comes from their Telegram profile) and send a link that logs them in straight away.
  if (!request) {
    if (owner || (await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } })))
      return void reply(BOT_TEXT.alreadyRegistered);
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phone,
            name: telegramDisplayName(from) ?? 'Customer',
            telegramUserId: BigInt(from.id),
            telegramChatId: BigInt(msg.chat.id),
            telegramUsername: from.username ?? null,
          },
        });
        await announceCustomerSignedUp(tx, user);
        return user;
      });
    } catch (err) {
      // Someone took this phone or Telegram account a moment ago.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        return void reply(BOT_TEXT.alreadyRegistered);
      throw err;
    }
    kickEvents(deps);
    const { url } = await issueLoginLink(deps, { from, chatId: msg.chat.id, phone, userId: created.id });
    if (url.startsWith('https://')) {
      say(msg.chat.id, BOT_TEXT.verifiedOpenLink, {
        replyMarkup: { inline_keyboard: [[{ text: '🛒 Open Cambo Supply', url }]] },
      });
    } else {
      say(msg.chat.id, `${BOT_TEXT.verifiedOpenLink}\n${url}`, {
        replyMarkup: removeKeyboard,
      });
    }
    return;
  }

  if (request.purpose === 'LOGIN') return void (await handleLoginContact(deps, msg, request, phone, say));

  // CHANGE_PHONE: the signed-in customer's own Telegram account must be the one sharing.
  {
    const user = request.userId
      ? await prisma.user.findUnique({ where: { id: request.userId } })
      : null;
    if (!user || user.telegramUserId !== BigInt(from.id)) return void reply(BOT_TEXT.cannotVerify);
    if (owner && owner.id !== user.id) return void reply(BOT_TEXT.phoneInUse);
  }

  await prisma.telegramAuthRequest.update({
    where: { id: request.id },
    data: { status: 'VERIFIED', phone, verifiedAt: new Date() },
  });
  reply(BOT_TEXT.verified);
}

/** "Chrome on Android at 14:05 (Cambodia time), code 42": lets the person recognise a login they started. */
function loginContext(request: TelegramAuthRequest): string {
  const time = new Date(request.createdAt.getTime() + PHNOM_PENH_OFFSET_MS).toISOString().slice(11, 16);
  return `Started from ${request.browser ?? 'a browser'} at ${time} (Cambodia time). Code: ${request.matchCode ?? '--'}`;
}

/**
 * The login link was opened. A linked account is asked to confirm (this tap is what stops someone else's
 * link from logging them in without their knowledge); an unlinked Telegram account is asked for its phone number.
 */
async function handleLoginStart(
  deps: AppDeps,
  msg: TgMessage,
  request: TelegramAuthRequest,
  say: Say,
) {
  const { prisma } = deps;
  const from = msg.from!;
  const linked = await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } });
  if (linked?.disabledAt) {
    await prisma.telegramAuthRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
    return void say(msg.chat.id, BOT_TEXT.cannotVerify, { replyMarkup: removeKeyboard });
  }
  const bound = await prisma.telegramAuthRequest.update({
    where: { id: request.id },
    data: {
      telegramUserId: BigInt(from.id),
      telegramChatId: BigInt(msg.chat.id),
      telegramUsername: from.username ?? null,
      firstName: telegramDisplayName(from),
      userId: linked?.id ?? null,
    },
  });
  if (!linked) {
    return void say(msg.chat.id, `${loginContext(bound)}\n\n${BOT_TEXT.loginAskPhone}`, {
      replyMarkup: shareKeyboard,
    });
  }
  say(
    msg.chat.id,
    [
      `Log in to Cambo Supply as ${linked.name}?`,
      '',
      loginContext(bound),
      '',
      'Only tap if you are doing this right now.',
    ].join('\n'),
    {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: BOT_TEXT.logInButton, callback_data: `login:${request.id}:y` },
            { text: BOT_TEXT.notMeButton, callback_data: `login:${request.id}:n` },
          ],
        ],
      },
    },
  );
}

/**
 * The person shared their own phone number for a login. An account with that number and no Telegram link is
 * linked to this Telegram account; with no account at all, one is created (so the same button signs up).
 * A number that belongs to an account linked to another Telegram account is refused.
 */
async function handleLoginContact(
  deps: AppDeps,
  msg: TgMessage,
  request: TelegramAuthRequest,
  phone: string,
  say: Say,
) {
  const { prisma } = deps;
  const from = msg.from!;
  const chatId = msg.chat.id;
  const refuse = async (text: string) => {
    await prisma.telegramAuthRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
    say(chatId, text, { replyMarkup: removeKeyboard });
  };
  // Already identified (a linked account): the confirm button is the only way on, not sharing a number.
  if (request.userId) return void say(chatId, BOT_TEXT.loginAskConfirm, { replyMarkup: removeKeyboard });
  if (await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } }))
    return void (await refuse(BOT_TEXT.loginExpired));

  const owner = await prisma.user.findUnique({ where: { phone } });
  if (owner && (owner.telegramUserId !== null || owner.disabledAt)) {
    return void (await refuse(owner.disabledAt ? BOT_TEXT.cannotVerify : BOT_TEXT.phoneLinkedElsewhere));
  }
  const telegram = {
    telegramUserId: BigInt(from.id),
    telegramChatId: BigInt(chatId),
    telegramUsername: from.username ?? null,
  };
  try {
    await prisma.$transaction(async (tx) => {
      const user = owner
        ? await tx.user.update({ where: { id: owner.id }, data: telegram })
        : await tx.user.create({
            data: { phone, name: telegramDisplayName(from) ?? 'Customer', ...telegram },
          });
      if (!owner) await announceCustomerSignedUp(tx, user);
      // Only a request that is still waiting and still ours may be verified.
      const { count } = await tx.telegramAuthRequest.updateMany({
        where: { id: request.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'VERIFIED', phone, userId: user.id, verifiedAt: new Date() },
      });
      if (count !== 1) throw new LoginRequestGone();
    });
  } catch (err) {
    if (err instanceof LoginRequestGone) return void say(chatId, BOT_TEXT.loginExpired, { replyMarkup: removeKeyboard });
    // Someone linked this phone or Telegram account a moment ago.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return void (await refuse(BOT_TEXT.cannotVerify));
    throw err;
  }
  if (!owner) kickEvents(deps);
  say(chatId, BOT_TEXT.loginDone, { replyMarkup: removeKeyboard });
}

class LoginRequestGone extends Error {}
