import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import {
  configureTelegramApp,
  isTelegramMiniApp,
  loadTelegramScript,
  useTelegramBackButton,
} from './telegram';

const scripts = () =>
  [...document.head.querySelectorAll('script[src*="telegram-web-app"]')] as HTMLScriptElement[];

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
    expect(() =>
      configureTelegramApp({ ready: vi.fn(), expand: vi.fn() }, '#12151a'),
    ).not.toThrow();
    expect(() => configureTelegramApp(undefined, '#12151a')).not.toThrow();
  });
});

describe('Telegram Mini App back button', () => {
  const fakeBtn = () => ({
    isVisible: false,
    show: vi.fn(),
    hide: vi.fn(),
    onClick: vi.fn(),
    offClick: vi.fn(),
  });

  const withRouter = (initialPath: string) => {
    const Wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [initialPath] }, children);
    return Wrapper;
  };

  afterEach(() => {
    delete (window as { Telegram?: unknown }).Telegram;
  });

  it('hides the back button on the root home page', () => {
    const btn = fakeBtn();
    (window as unknown as { Telegram: { WebApp: { BackButton: typeof btn } } }).Telegram = {
      WebApp: { BackButton: btn },
    };

    renderHook(() => useTelegramBackButton(), { wrapper: withRouter('/') });
    expect(btn.hide).toHaveBeenCalled();
    expect(btn.show).not.toHaveBeenCalled();
  });

  it('shows the back button on subpages and hooks up click listener', () => {
    const btn = fakeBtn();
    (window as unknown as { Telegram: { WebApp: { BackButton: typeof btn } } }).Telegram = {
      WebApp: { BackButton: btn },
    };

    const { unmount } = renderHook(() => useTelegramBackButton(), {
      wrapper: withRouter('/products/x11'),
    });
    expect(btn.show).toHaveBeenCalled();
    expect(btn.onClick).toHaveBeenCalled();

    unmount();
    expect(btn.offClick).toHaveBeenCalled();
  });

  it('gracefully does nothing when Telegram is not present', () => {
    expect(() =>
      renderHook(() => useTelegramBackButton(), { wrapper: withRouter('/checkout') }),
    ).not.toThrow();
  });
});

describe('Telegram Mini App colours follow the phone', () => {
  const themed = (colorScheme: 'light' | 'dark', bg_color: string) => ({
    ready: vi.fn(),
    expand: vi.fn(),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    colorScheme,
    themeParams: { bg_color },
    onEvent: vi.fn(),
  });
  afterEach(() => document.documentElement.style.removeProperty('--color-bg'));

  it("on a dark phone uses the phone's own background for Telegram's header, the page and the bottom bar", () => {
    const app = themed('dark', '#000000');
    configureTelegramApp(app, '#12151a');
    expect(app.setHeaderColor).toHaveBeenCalledWith('#000000');
    expect(app.setBackgroundColor).toHaveBeenCalledWith('#000000');
    expect(app.setBottomBarColor).toHaveBeenCalledWith('#000000');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#000000');
  });

  it('keeps the shop colour on a light phone, because the shop is dark only and its text is light', () => {
    const app = themed('light', '#ffffff');
    configureTelegramApp(app, '#12151a');
    expect(app.setHeaderColor).toHaveBeenCalledWith('#12151a');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('');
  });

  it('ignores a colour it cannot trust', () => {
    const app = themed('dark', 'not-a-colour');
    configureTelegramApp(app, '#12151a');
    expect(app.setHeaderColor).toHaveBeenCalledWith('#12151a');
  });

  it('follows the phone when its theme changes', () => {
    const app = themed('dark', '#000000');
    configureTelegramApp(app, '#12151a');
    const repaint = app.onEvent.mock.calls.find(
      ([event]) => event === 'themeChanged',
    )![1] as () => void;
    app.colorScheme = 'light';
    app.themeParams.bg_color = '#ffffff';
    repaint();
    expect(app.setHeaderColor).toHaveBeenLastCalledWith('#12151a');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('');
  });
});
