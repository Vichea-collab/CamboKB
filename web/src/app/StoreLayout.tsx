import { Outlet, ScrollRestoration } from 'react-router';
import { Footer } from './Footer';
import { Header } from './Header';
import { Toast } from '../shared/ui/Toast';
import { CartDrawer } from '../features/cart/CartDrawer';

export function StoreLayout() {
  return (
    <div className="min-h-dvh">
      <Header />
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-4 sm:px-6 lg:px-8">
        <main>
          <Outlet />
        </main>
        <Footer />
      </div>
      <CartDrawer />
      <Toast />
      <ScrollRestoration />
    </div>
  );
}
