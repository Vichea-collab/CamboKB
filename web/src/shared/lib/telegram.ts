/**
 * Telegram's Mini App script (window.Telegram.WebApp) is only useful when the store is opened inside
 * Telegram. It used to sit in the page head, where it blocked the first paint of every visitor for as
 * long as telegram.org took to answer (over a second, and a hang where telegram.org is slow or blocked).
 */
const SCRIPT_SRC = 'https://telegram.org/js/telegram-web-app.js';

/** Telegram opens a Mini App with launch parameters (tgWebAppData, tgWebAppVersion, ...) in the address. */
export const isTelegramMiniApp = () => window.location.hash.includes('tgWebApp');

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

/** The parts of Telegram's WebApp object we use. Older Telegram versions lack the newer calls. */
export type TelegramWebApp = {
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
};

/**
 * Make the store feel like part of Telegram: full height, our colours in Telegram's own header, background
 * and bottom bar (so no light strip shows while the page loads or overscrolls), and no accidental
 * close or collapse when a swipe down at the top of a long list is meant as scrolling.
 */
export function configureTelegramApp(app: TelegramWebApp | undefined, color: string): void {
  if (!app) return;
  app.ready();
  app.expand();
  app.setHeaderColor?.(color);
  app.setBackgroundColor?.(color);
  app.setBottomBarColor?.(color);
  app.disableVerticalSwipes?.();
}

export const telegramApp = () => (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
