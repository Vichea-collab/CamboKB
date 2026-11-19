import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * Telegram's Mini App script (window.Telegram.WebApp) is only useful when the store is opened inside
 * Telegram. It used to sit in the page head, where it blocked the first paint of every visitor for as
 * long as telegram.org took to answer (over a second, and a hang where telegram.org is slow or blocked).
 */
const SCRIPT_SRC = 'https://telegram.org/js/telegram-web-app.js';

/** Telegram opens a Mini App with launch parameters (tgWebAppData, tgWebAppVersion, ...) in the address. */
export const isTelegramMiniApp = () => window.location.hash.includes('tgWebApp');

/**
 * The bot's "Share my location" button only works in Telegram's phone and tablet apps. Telegram Desktop
 * and Telegram Web can't send a location (the button does nothing there), so offer it only on a touch device.
 */
export function canShareLocationInTelegram(): boolean {
  const ua = navigator.userAgent;
  // iPadOS announces itself as a Mac, but has a touch screen.
  return (
    /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/** Load the script when inside Telegram; resolves when it is ready, or after `timeoutMs` so the store never waits for it. */
export function loadTelegramScript(timeoutMs = 3000): Promise<void> {
  if (!isTelegramMiniApp()) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    const done = () => resolve();
    script.addEventListener('load', done);
    script.addEventListener('error', done);
    setTimeout(done, timeoutMs);
    document.head.appendChild(script);
  });
}

/** Telegram's native top-bar back button controls. */
export type TelegramBackButton = {
  isVisible?: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
};

/** The parts of Telegram's WebApp object we use. Older Telegram versions lack the newer calls. */
export type TelegramWebApp = {
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  /** The phone's own light or dark theme, and its colours. */
  colorScheme?: 'light' | 'dark';
  themeParams?: { bg_color?: string };
  onEvent?(event: string, cb: () => void): void;
  BackButton?: TelegramBackButton;
};

/** The phone's own background, but only on a dark theme: the shop is dark only, so on a light phone it keeps its own. */
function phoneBackground(app: TelegramWebApp): string | undefined {
  const bg = app.themeParams?.bg_color;
  return app.colorScheme === 'dark' && bg && /^#[0-9a-f]{6}$/i.test(bg) ? bg : undefined;
}

/**
 * Make the store feel like part of Telegram: full height, and no accidental close or collapse when a swipe
 * down at the top of a long list is meant as scrolling. On a dark phone the header, page and bottom bar all
 * use the phone's own background, so the store blends into Telegram instead of showing a different shade
 * (and it follows the phone if the theme changes). `color` is the shop's own colour, used otherwise.
 */
export function configureTelegramApp(app: TelegramWebApp | undefined, color: string): void {
  if (!app) return;
  app.ready();
  app.expand();
  const paint = () => {
    const phone = phoneBackground(app);
    const bg = phone ?? color;
    app.setHeaderColor?.(bg);
    app.setBackgroundColor?.(bg);
    app.setBottomBarColor?.(bg);
    if (phone) document.documentElement.style.setProperty('--color-bg', phone);
    else document.documentElement.style.removeProperty('--color-bg');
  };
  paint();
  app.onEvent?.('themeChanged', paint);
  app.disableVerticalSwipes?.();
}

export const telegramApp = () =>
  (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

/**
 * Keeps Telegram's native top-bar back button in sync with the router:
 * shows when navigated into a subpage, hides at the home page, and walks back on click.
 */
export function useTelegramBackButton(): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const app = telegramApp();
    const btn = app?.BackButton;
    if (!btn) return;

    if (location.pathname === '/') {
      btn.hide();
      return;
    }

    const handleClick = () => {
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate('/');
      }
    };

    btn.show();
    btn.onClick(handleClick);
    return () => {
      btn.offClick(handleClick);
    };
  }, [location.pathname, navigate]);
}
