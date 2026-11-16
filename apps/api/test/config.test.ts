import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

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
});
