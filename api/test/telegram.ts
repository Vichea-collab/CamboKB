import { createHmac } from 'node:crypto';

export const BOT_TOKEN = '123456:test-bot-token';
/** What the api is given instead of the bot token. */
export const KEY_HEX = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest('hex');

/** initData the way Telegram builds it: fields, plus hash = HMAC(key, sorted "k=v" lines). */
export function signInitData(
  fields: Record<string, string>,
  keyHex = KEY_HEX,
): string {
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const hash = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
