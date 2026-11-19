import type { AppDeps } from '../../http/app';
import { sha256 } from '../auth/sessions';
import { issueSignupLink, telegramDisplayName } from '../auth/telegram-verification';
import { BOT_COMMANDS, formatUsd, normalizePhone, type BotAction } from '@cambo/shared';
import type { TgMessage, TgUpdate } from '../../integrations/telegram/types';

export const BOT_TEXT = {
  askContact: 'Tap the button below to share your phone number with Cambo Supply.',
  shareButton: '📱 Share my phone number',
  expired: 'This link has expired. Please start again on the website.',
  ownNumber: 'Please share your own phone number using the button.',
  alreadyRegistered:
    'This number already has an account. Log in on the website or use Forgot password.',
  welcomeNew:
    'Welcome to Cambo Supply! 👋\n\nTo create your account, tap the button below to share your phone number. Then we send you a link to choose a password.',
  cannotVerify:
    "We couldn't verify this account. Please check the number and try again on the website.",
  phoneInUse: 'This number is already used by another account.',
  verified: '✅ Verified! Go back to the website to continue.',
  verifiedChoosePassword: '✅ Verified! One more step: choose your password.',
  noPending: 'Please open the sign-up link from the Cambo Supply website first.',
  invalidPhone: "That phone number doesn't look valid.",
  askLocation:
    'Tap the button below to share where we should deliver. You can also send any other spot from the 📎 menu → Location.',
  shareLocationButton: '📍 Share my location',
  locationSaved: '✅ Got your location! Go back to checkout: your delivery fee is updated.',
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
  else {
    const command = /^\/(\w+)(?:@\w+)?/.exec(msg.text ?? '')?.[1]?.toLowerCase();
    if (command === 'orders') await handleOrders(deps, msg, say);
    else if (command === 'shop') handleShop(deps, msg, say);
    else if (command === 'help') handleHelp(msg, say);
    else say(msg.chat.id, `${BOT_TEXT.noPending}\n${deps.config.webOrigin[0] ?? ''}`);
  }
  return actions;
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

  // No sign-up started on the website: this person started in the bot. Verify them and send a link
  // that only asks for a password (the name comes from their Telegram profile).
  if (!request) {
    if (owner || (await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } })))
      return void reply(BOT_TEXT.alreadyRegistered);
    const { url } = await issueSignupLink(deps, { from, chatId: msg.chat.id, phone });
    if (url.startsWith('https://')) {
      say(msg.chat.id, BOT_TEXT.verifiedChoosePassword, {
        replyMarkup: { inline_keyboard: [[{ text: '🔐 Choose my password', url }]] },
      });
    } else {
      say(msg.chat.id, `${BOT_TEXT.verifiedChoosePassword}\n${url}`, {
        replyMarkup: removeKeyboard,
      });
    }
    return;
  }

  if (request.purpose === 'SIGNUP') {
    if (owner || (await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } }))) {
      await prisma.telegramAuthRequest.update({
        where: { id: request.id },
        data: { status: 'EXPIRED' },
      });
      return void reply(BOT_TEXT.alreadyRegistered);
    }
  } else if (request.purpose === 'RESET') {
    const ok =
      owner && owner.phone === request.expectedPhone && owner.telegramUserId === BigInt(from.id);
    if (!ok) return void reply(BOT_TEXT.cannotVerify);
  } else {
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
