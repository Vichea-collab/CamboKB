import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('lists missing required keys', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('parses a comma-separated web origin list', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgresql://x@localhost/db',
      WEB_ORIGIN: 'https://a.test,https://b.test',
    });
    expect(c.webOrigin).toEqual(['https://a.test', 'https://b.test']);
    expect(c.port).toBe(4000);
    expect(c.services.notificationUrl).toBe('http://localhost:4300');
  });

  it('treats empty values as not set (Docker Compose passes unset variables that way)', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgresql://x@localhost/db',
      BAKONG_ACCOUNT_ID: '',
      BAKONG_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
    });
    expect(c.bakong.enabled).toBe(false);
    expect(c.telegram.botUsername).toBeUndefined();
  });

  it('needs real secrets for every service in production', () => {
    const base = {
      DATABASE_URL: 'postgresql://x@localhost/db',
      WEB_ORIGIN: 'https://a.test',
      NODE_ENV: 'production',
      FILE_SERVICE_SECRET: 'x'.repeat(40),
      REPORT_SERVICE_SECRET: 'y'.repeat(40),
    };
    expect(() => loadConfig(base)).toThrow(
      /NOTIFICATION_SERVICE_SECRET[\s\S]*API_INTERNAL_SECRET|API_INTERNAL_SECRET[\s\S]*NOTIFICATION_SERVICE_SECRET/,
    );
    expect(
      loadConfig({
        ...base,
        NOTIFICATION_SERVICE_SECRET: 'n'.repeat(40),
        API_INTERNAL_SECRET: 'i'.repeat(40),
      }).services.internalSecret,
    ).toBe('i'.repeat(40));
  });

  it('sends Secure cookies in production unless told otherwise (plain-http local containers)', () => {
    const base = { DATABASE_URL: 'postgresql://x@localhost/db', WEB_ORIGIN: 'https://a.test' };
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        FILE_SERVICE_SECRET: 'x'.repeat(40),
        REPORT_SERVICE_SECRET: 'y'.repeat(40),
        NOTIFICATION_SERVICE_SECRET: 'n'.repeat(40),
        API_INTERNAL_SECRET: 'i'.repeat(40),
      }).cookieSecure,
    ).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).cookieSecure).toBe(false);
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
        FILE_SERVICE_SECRET: 'x'.repeat(40),
        REPORT_SERVICE_SECRET: 'y'.repeat(40),
        NOTIFICATION_SERVICE_SECRET: 'n'.repeat(40),
        API_INTERNAL_SECRET: 'i'.repeat(40),
      }).cookieSecure,
    ).toBe(false);
  });
});
