import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = { NOTIFICATION_DATABASE_URL: 'postgresql://x@localhost/db' };

describe('notification config', () => {
  it('starts with Telegram off and every optional value empty (the way Docker Compose passes them)', () => {
    const c = loadConfig({
      ...base,
      TELEGRAM_MODE: 'off',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_ADMIN_CHAT_ID: '',
      TELEGRAM_WEBHOOK_URL: '',
      TELEGRAM_WEBHOOK_SECRET: '',
    });
    expect(c.telegram).toMatchObject({ mode: 'off', adminChatId: undefined, botToken: undefined });
    expect(c.port).toBe(4300);
  });

  it('asks for what each Telegram mode needs', () => {
    expect(() => loadConfig({ ...base, TELEGRAM_MODE: 'polling' })).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() =>
      loadConfig({ ...base, TELEGRAM_MODE: 'webhook', TELEGRAM_BOT_TOKEN: 't' }),
    ).toThrow(
      /TELEGRAM_WEBHOOK_SECRET[\s\S]*TELEGRAM_WEBHOOK_URL|TELEGRAM_WEBHOOK_URL[\s\S]*TELEGRAM_WEBHOOK_SECRET/,
    );
    expect(
      loadConfig({
        ...base,
        TELEGRAM_MODE: 'webhook',
        TELEGRAM_BOT_TOKEN: 't',
        TELEGRAM_WEBHOOK_SECRET: 's',
        TELEGRAM_WEBHOOK_URL: 'https://x.test/telegram/webhook',
      }).telegram.mode,
    ).toBe('webhook');
  });

  it('accepts a user id or a group id for the owner chat, and nothing else', () => {
    expect(
      loadConfig({ ...base, TELEGRAM_ADMIN_CHAT_ID: '-1001234567890' }).telegram.adminChatId,
    ).toBe('-1001234567890');
    expect(() => loadConfig({ ...base, TELEGRAM_ADMIN_CHAT_ID: '@myself' })).toThrow(
      /TELEGRAM_ADMIN_CHAT_ID/,
    );
  });

  it('refuses placeholder secrets in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      /NOTIFICATION_SERVICE_SECRET/,
    );
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        NOTIFICATION_SERVICE_SECRET: 'n'.repeat(40),
        API_INTERNAL_SECRET: 'i'.repeat(40),
      }).secret,
    ).toBe('n'.repeat(40));
  });

  it('uses the first web origin for links', () => {
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://a.test/,https://b.test' }).webOrigin).toBe(
      'https://a.test',
    );
  });
});
