import { Outlet, ScrollRestoration } from 'react-router';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { Toast } from '../components/Toast';
import { CartDrawer } from '../components/CartDrawer';

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
