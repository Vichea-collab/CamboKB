import type { AppDeps } from '../../http/app';
import { sha256 } from '../auth/sessions';
import { formatUsd, normalizePhone } from '@cambo/shared';
import type { TgMessage, TgUpdate } from '../../integrations/telegram/client';

export const BOT_TEXT = {
  askContact: 'Tap the button below to share your phone number with Cambo Supply.',
  shareButton: '📱 Share my phone number',
  expired: 'This link has expired. Please start again on the website.',
  ownNumber: 'Please share your own phone number using the button.',
  alreadyRegistered: 'This number already has an account. Log in on the website or use Forgot password.',
  cannotVerify: "We couldn't verify this account. Please check the number and try again on the website.",
  phoneInUse: 'This number is already used by another account.',
  verified: '✅ Verified! Go back to the website to continue.',
  noPending: 'Please open the sign-up link from the Cambo Supply website first.',
  invalidPhone: "That phone number doesn't look valid.",
} as const;

const removeKeyboard = { remove_keyboard: true };

export async function handleTelegramUpdate(deps: AppDeps, update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot || msg.chat.type !== 'private') return;
  if (msg.text?.startsWith('/start')) return handleStart(deps, msg);
  if (msg.contact) return handleContact(deps, msg);
  const command = /^\/(\w+)(?:@\w+)?/.exec(msg.text ?? '')?.[1]?.toLowerCase();
  if (command === 'orders') return handleOrders(deps, msg);
  if (command === 'shop') return handleShop(deps, msg);
  if (command === 'help') return handleHelp(deps, msg);
  await deps.telegram.sendMessage(msg.chat.id, `${BOT_TEXT.noPending}\n${deps.config.webOrigin[0] ?? ''}`);
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'Pending', CONFIRMED: 'Confirmed', PACKED: 'Packed', SHIPPING: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };

export const COMMANDS = [
  { command: 'shop', description: 'Open the store' },
  { command: 'orders', description: 'See my latest orders' },
  { command: 'help', description: 'What this bot can do' },
] as const;

const origin = (deps: AppDeps) => deps.config.webOrigin[0] ?? '';

async function handleHelp(deps: AppDeps, msg: TgMessage) {
  await deps.telegram.sendMessage(
    msg.chat.id,
    ['Cambo Supply bot', '', ...COMMANDS.map((c) => `/${c.command} — ${c.description}`), '', 'We message you here when your order is confirmed, on the way and delivered.'].join('\n'),
  );
}

async function handleShop(deps: AppDeps, msg: TgMessage) {
  const url = origin(deps);
  // Telegram only opens Mini Apps from https links.
  if (url.startsWith('https://')) {
    await deps.telegram.sendMessage(msg.chat.id, 'Tap below to open the store.', { replyMarkup: { inline_keyboard: [[{ text: '🛒 Open Cambo Supply', web_app: { url } }]] } });
  } else {
    await deps.telegram.sendMessage(msg.chat.id, `Shop at ${url}`);
  }
}

async function handleOrders(deps: AppDeps, msg: TgMessage) {
  const { prisma, telegram } = deps;
  const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(msg.from!.id) } });
  if (!user) {
    await telegram.sendMessage(msg.chat.id, `You don't have an account yet. Create one here: ${origin(deps)}/signup`);
    return;
  }
  const orders = await prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 });
  if (!orders.length) {
    await telegram.sendMessage(msg.chat.id, `You haven't ordered anything yet. Start here: ${origin(deps)}`);
    return;
  }
  const lines = orders.map((o) => `${o.number} · ${STATUS_LABEL[o.status] ?? o.status} · ${formatUsd(o.totalCents)}`);
  await telegram.sendMessage(msg.chat.id, ['Your latest orders:', '', ...lines, '', `Details: ${origin(deps)}/account/orders`].join('\n'));
}

async function handleStart(deps: AppDeps, msg: TgMessage) {
  const { prisma, telegram, config } = deps;
  const token = msg.text!.split(/\s+/)[1];
  if (!token) {
    await telegram.sendMessage(msg.chat.id, `Welcome to Cambo Supply! Shop at ${config.webOrigin[0] ?? ''}`);
    return;
  }
  const from = msg.from!;
  const request = await prisma.telegramAuthRequest.findUnique({ where: { tokenHash: sha256(token) } });
  const usable =
    request &&
    request.status === 'PENDING' &&
    request.expiresAt.getTime() > Date.now() &&
    (request.telegramUserId === null || request.telegramUserId === BigInt(from.id));
  if (!usable) {
    await telegram.sendMessage(msg.chat.id, BOT_TEXT.expired, { replyMarkup: removeKeyboard });
    return;
  }
  await prisma.telegramAuthRequest.update({
    where: { id: request.id },
    data: {
      telegramUserId: BigInt(from.id),
      telegramChatId: BigInt(msg.chat.id),
      telegramUsername: from.username ?? null,
      firstName: from.first_name?.slice(0, 60) ?? null,
    },
  });
  await telegram.sendMessage(msg.chat.id, BOT_TEXT.askContact, {
    replyMarkup: {
      keyboard: [[{ text: BOT_TEXT.shareButton, request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  });
}

async function handleContact(deps: AppDeps, msg: TgMessage) {
  const { prisma, telegram } = deps;
  const from = msg.from!;
  const reply = (text: string, keep = false) =>
    telegram.sendMessage(msg.chat.id, text, keep ? undefined : { replyMarkup: removeKeyboard });

  const request = await prisma.telegramAuthRequest.findFirst({
    where: { telegramUserId: BigInt(from.id), status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!request) return reply(BOT_TEXT.noPending);

  // Only the sender's own contact proves they own the number (forwarded contacts carry someone else's user_id).
  if (msg.contact!.user_id !== from.id) return reply(BOT_TEXT.ownNumber, true);

  const phone = normalizePhone(msg.contact!.phone_number);
  if (!phone) return reply(BOT_TEXT.invalidPhone);

  const owner = await prisma.user.findUnique({ where: { phone } });

  if (request.purpose === 'SIGNUP') {
    if (owner || (await prisma.user.findUnique({ where: { telegramUserId: BigInt(from.id) } }))) {
      await prisma.telegramAuthRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
      return reply(BOT_TEXT.alreadyRegistered);
    }
  } else if (request.purpose === 'RESET') {
    const ok = owner && owner.phone === request.expectedPhone && owner.telegramUserId === BigInt(from.id);
    if (!ok) return reply(BOT_TEXT.cannotVerify);
  } else {
    const user = request.userId ? await prisma.user.findUnique({ where: { id: request.userId } }) : null;
    if (!user || user.telegramUserId !== BigInt(from.id)) return reply(BOT_TEXT.cannotVerify);
    if (owner && owner.id !== user.id) return reply(BOT_TEXT.phoneInUse);
  }

  await prisma.telegramAuthRequest.update({
    where: { id: request.id },
    data: { status: 'VERIFIED', phone, verifiedAt: new Date() },
  });
  await reply(BOT_TEXT.verified);
}
