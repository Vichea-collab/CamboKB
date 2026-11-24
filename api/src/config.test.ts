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
      TELEGRAM_WEBAPP_KEY: 'ab'.repeat(32),
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

  it('refuses to start in production without a 64-hex TELEGRAM_WEBAPP_KEY, but not in development', () => {
    const prod = {
      DATABASE_URL: 'postgresql://x@localhost/db',
      WEB_ORIGIN: 'https://a.test',
      NODE_ENV: 'production',
      FILE_SERVICE_SECRET: 'x'.repeat(40),
      REPORT_SERVICE_SECRET: 'y'.repeat(40),
      NOTIFICATION_SERVICE_SECRET: 'n'.repeat(40),
      API_INTERNAL_SECRET: 'i'.repeat(40),
    };
    expect(() => loadConfig(prod)).toThrow(/TELEGRAM_WEBAPP_KEY/);
    expect(() => loadConfig({ ...prod, TELEGRAM_WEBAPP_KEY: 'ab'.repeat(31) })).toThrow(/TELEGRAM_WEBAPP_KEY/);
    expect(() => loadConfig({ ...prod, TELEGRAM_WEBAPP_KEY: 'zz'.repeat(32) })).toThrow(/TELEGRAM_WEBAPP_KEY/);
    expect(loadConfig({ ...prod, TELEGRAM_WEBAPP_KEY: 'AB'.repeat(32) }).telegram.webAppKey).toBe('AB'.repeat(32));
    expect(loadConfig({ DATABASE_URL: 'postgresql://x@localhost/db' }).telegram.webAppKey).toBeUndefined();
  });

  it('gives admins a 1-day session unless ADMIN_SESSION_TTL_DAYS says otherwise', () => {
    const base = { DATABASE_URL: 'postgresql://x@localhost/db' };
    expect(loadConfig(base).adminSessionTtlDays).toBe(1);
    expect(loadConfig({ ...base, ADMIN_SESSION_TTL_DAYS: '2' }).adminSessionTtlDays).toBe(2);
    expect(() => loadConfig({ ...base, ADMIN_SESSION_TTL_DAYS: '0' })).toThrow(/ADMIN_SESSION_TTL_DAYS/);
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
        TELEGRAM_WEBAPP_KEY: 'ab'.repeat(32),
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
        TELEGRAM_WEBAPP_KEY: 'ab'.repeat(32),
      }).cookieSecure,
    ).toBe(false);
  });
});

describe('loadConfig: REDIS_URL', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db' };

  it('redisUrl is undefined when REDIS_URL is unset', () => {
    expect(loadConfig(base).redisUrl).toBeUndefined();
  });

  it('redisUrl is undefined when REDIS_URL is an empty string (Compose passes unset variables that way)', () => {
    expect(loadConfig({ ...base, REDIS_URL: '' }).redisUrl).toBeUndefined();
  });

  it('redisUrl is read when REDIS_URL=redis://redis:6379', () => {
    expect(loadConfig({ ...base, REDIS_URL: 'redis://redis:6379' }).redisUrl).toBe('redis://redis:6379');
  });

  it('accepts a password in the URL and the rediss:// scheme', () => {
    expect(loadConfig({ ...base, REDIS_URL: 'redis://:s3cret@redis:6379' }).redisUrl).toBe('redis://:s3cret@redis:6379');
    expect(loadConfig({ ...base, REDIS_URL: 'rediss://redis:6380' }).redisUrl).toBe('rediss://redis:6380');
  });

  it('throws for REDIS_URL=http://x', () => {
    expect(() => loadConfig({ ...base, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
  });
});
