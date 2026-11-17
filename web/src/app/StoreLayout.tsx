import { Outlet, ScrollRestoration } from 'react-router';
import { Footer } from './Footer';
import { Header } from './Header';
import { Toast } from '../shared/ui/Toast';
import { CartDrawer } from '../features/cart/CartDrawer';

export function StoreLayout() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 sm:px-6 lg:px-8">
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <Toast />
      <ScrollRestoration />
    </div>
  );
}
