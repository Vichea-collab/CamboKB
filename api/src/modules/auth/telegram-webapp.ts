import { createHmac, timingSafeEqual } from 'node:crypto';

/** initData older than this is refused. */
export const WEBAPP_MAX_AGE_SEC = 5 * 60;
/** Clocks differ a little; anything further ahead than this is not a real signature. */
export const WEBAPP_MAX_FUTURE_SEC = 30;

export type WebAppIdentity = { telegramUserId: number; hash: string; authDate: number };

/**
 * Check the signature Telegram puts on a Mini App's `initData` and return who it names, or null.
 * `key` is hex(HMAC_SHA256("WebAppData", bot token)); with it we can check signatures but not control the bot.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyWebAppInitData(
  initData: string,
  keyHex: string,
  now: number = Date.now(),
): WebAppIdentity | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  // A field sent twice is ambiguous; refuse rather than guess which one was signed.
  const names = [...params.keys()];
  if (new Set(names).size !== names.length) return null;
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const expected = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return null;
  const ageSec = now / 1000 - authDate;
  if (ageSec > WEBAPP_MAX_AGE_SEC || ageSec < -WEBAPP_MAX_FUTURE_SEC) return null;

  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  const id = (user as { id?: unknown } | null)?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  return { telegramUserId: id, hash: hash.toLowerCase(), authDate };
}
