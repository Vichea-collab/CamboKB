import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('lists missing required keys', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('parses a comma-separated web origin list', () => {
    const c = loadConfig({ DATABASE_URL: 'postgresql://x@localhost/db', WEB_ORIGIN: 'https://a.test,https://b.test' });
    expect(c.webOrigin).toEqual(['https://a.test', 'https://b.test']);
    expect(c.port).toBe(4000);
    expect(c.telegram.mode).toBe('off');
  });

  it('requires a bot token when telegram is enabled', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgresql://x@localhost/db', WEB_ORIGIN: 'https://a.test', TELEGRAM_MODE: 'polling' }),
    ).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('sends Secure cookies in production unless told otherwise (plain-http local containers)', () => {
    const base = { DATABASE_URL: 'postgresql://x@localhost/db', WEB_ORIGIN: 'https://a.test' };
    expect(loadConfig({ ...base, NODE_ENV: 'production', FILE_SERVICE_SECRET: 'x'.repeat(40), REPORT_SERVICE_SECRET: 'y'.repeat(40) }).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).cookieSecure).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false', FILE_SERVICE_SECRET: 'x'.repeat(40), REPORT_SERVICE_SECRET: 'y'.repeat(40) }).cookieSecure).toBe(false);
  });
});
