import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, useRouteError } from 'react-router';
import { RequireAdmin, RequireAuth } from '../features/auth/auth';
import { t } from '../shared/lib/strings';
import { StoreLayout } from './StoreLayout';
import Home from '../features/catalog/HomePage';
import ProductDetail from '../features/catalog/ProductPage';

const Checkout = lazy(() => import('../features/checkout/CheckoutPage'));
const PayPage = lazy(() => import('../features/payments/PayPage'));
const OrderSuccess = lazy(() => import('../features/checkout/OrderSuccessPage'));
const Login = lazy(() => import('../features/auth/LoginPage'));
const Signup = lazy(() => import('../features/auth/SignupPage'));
const ForgotPassword = lazy(() => import('../features/auth/ForgotPasswordPage'));
const Profile = lazy(() => import('../features/account/ProfilePage'));
const Orders = lazy(() => import('../features/account/OrdersPage'));
const OrderDetail = lazy(() => import('../features/account/OrderDetailPage'));
const Contact = lazy(() => import('../features/info/ContactPage'));
const Delivery = lazy(() => import('../features/info/DeliveryPage'));
const Warranty = lazy(() => import('../features/info/WarrantyPage'));
const Privacy = lazy(() => import('../features/info/PrivacyPage'));
const AdminApp = lazy(() => import('../features/admin/AdminApp'));

const page = (node: ReactNode) => <Suspense fallback={<p className="py-10 text-center text-muted">{t.common.loading}</p>}>{node}</Suspense>;
const authed = (node: ReactNode) => page(<RequireAuth>{node}</RequireAuth>);

function ErrorPage() {
  const err = useRouteError() as { status?: number } | undefined;
  return (
    <div className="mx-auto grid min-h-[70dvh] max-w-md place-items-center px-6 text-center">
      <div>
        <p className="font-display text-5xl font-bold text-yellow">{err?.status === 404 ? '404' : 'Oops'}</p>
        <p className="mt-3 text-muted">{err?.status === 404 ? "This page doesn't exist." : t.common.error}</p>
        <Link to="/" className="btn-primary mt-6">
          {t.product.backToShop}
        </Link>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <StoreLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Home /> },
      { path: 'products/:slug', element: <ProductDetail /> },
      { path: 'checkout', element: authed(<Checkout />) },
      { path: 'orders/:number/pay', element: authed(<PayPage />) },
      { path: 'orders/:number/success', element: authed(<OrderSuccess />) },
      { path: 'login', element: page(<Login />) },
      { path: 'signup', element: page(<Signup />) },
      { path: 'forgot-password', element: page(<ForgotPassword />) },
      { path: 'account', element: authed(<Profile />) },
      { path: 'account/orders', element: authed(<Orders />) },
      { path: 'account/orders/:number', element: authed(<OrderDetail />) },
      { path: 'contact', element: page(<Contact />) },
      { path: 'delivery', element: page(<Delivery />) },
      { path: 'warranty', element: page(<Warranty />) },
      { path: 'privacy', element: page(<Privacy />) },
      { path: '*', element: <ErrorPage /> },
    ],
  },
  { path: '/admin/*', errorElement: <ErrorPage />, element: page(<RequireAdmin><AdminApp /></RequireAdmin>) },
]);
