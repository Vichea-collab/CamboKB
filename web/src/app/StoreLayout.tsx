import { Outlet, ScrollRestoration } from 'react-router';
import { BottomNav } from './BottomNav';
import { Footer } from './Footer';
import { Header } from './Header';
import { t } from '../shared/lib/strings';
import { Toast } from '../shared/ui/Toast';
import { CartDrawer } from '../features/cart/CartDrawer';

import { useTelegramBackButton } from '../shared/lib/telegram';

export function StoreLayout() {
  useTelegramBackButton();
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-yellow px-4 py-2 font-semibold text-yellow-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        {t.nav.skip}
      </a>
      <Header />
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-4 sm:px-6 lg:px-8">
        <main id="main" tabIndex={-1} className="outline-none">
          <Outlet />
        </main>
        <Footer />
      </div>
      <BottomNav />
      <CartDrawer />
      <Toast />
      <ScrollRestoration />
    </div>
  );
}
