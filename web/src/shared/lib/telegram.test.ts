import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTelegramApp, isTelegramMiniApp, loadTelegramScript } from './telegram';

const scripts = () => [...document.head.querySelectorAll('script[src*="telegram-web-app"]')] as HTMLScriptElement[];

describe('Telegram Mini App script', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scripts().forEach((s) => s.remove());
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('is not loaded for ordinary visitors, so it cannot slow the page down', async () => {
    window.location.hash = '';
    expect(isTelegramMiniApp()).toBe(false);
    await loadTelegramScript();
    expect(scripts()).toHaveLength(0);
  });

  it('is loaded, asynchronously, when the store is opened inside Telegram', async () => {
    window.location.hash = '#tgWebAppData=abc&tgWebAppVersion=8.0';
    expect(isTelegramMiniApp()).toBe(true);
    const done = loadTelegramScript();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.async).toBe(true);
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(done).resolves.toBeUndefined();
  });

  it('never keeps the store waiting: it gives up on a slow or blocked script', async () => {
    window.location.hash = '#tgWebAppData=abc';
    let settled = false;
    void loadTelegramScript(3000).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(2900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
  });
});

describe('Telegram Mini App set-up', () => {
  const fake = () => ({
    ready: vi.fn(),
    expand: vi.fn(),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    disableVerticalSwipes: vi.fn(),
  });

  it('fills the whole screen and matches the shop colours, so there is no light strip at the top or bottom', () => {
    const app = fake();
    configureTelegramApp(app, '#12151a');
    expect(app.ready).toHaveBeenCalled();
    expect(app.expand).toHaveBeenCalled();
    expect(app.setHeaderColor).toHaveBeenCalledWith('#12151a');
    expect(app.setBackgroundColor).toHaveBeenCalledWith('#12151a');
    expect(app.setBottomBarColor).toHaveBeenCalledWith('#12151a');
  });

  it('stops a downward swipe while scrolling the shop from closing it by accident', () => {
    const app = fake();
    configureTelegramApp(app, '#12151a');
    expect(app.disableVerticalSwipes).toHaveBeenCalled();
  });

  it('works with older Telegram versions that lack the newer calls, and when there is no Telegram at all', () => {
    expect(() => configureTelegramApp({ ready: vi.fn(), expand: vi.fn() }, '#12151a')).not.toThrow();
    expect(() => configureTelegramApp(undefined, '#12151a')).not.toThrow();
  });
});
