import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, Navigate, useLocation, useRouteError } from 'react-router';
import { RequireAdmin, RequireAuth } from '../features/auth/auth';
import { t } from '../shared/lib/strings';
import { LoadingState } from '../shared/ui/Page';
import { StoreLayout } from './StoreLayout';
import Home from '../features/catalog/HomePage';
import ProductDetail from '../features/catalog/ProductPage';

const Checkout = lazy(() => import('../features/checkout/CheckoutPage'));
const PayPage = lazy(() => import('../features/payments/PayPage'));
const OrderSuccess = lazy(() => import('../features/checkout/OrderSuccessPage'));
const Login = lazy(() => import('../features/auth/LoginPage'));

function ToLogin() {
  return <Navigate to={`/login${useLocation().search}`} replace />;
}
const Profile = lazy(() => import('../features/account/ProfilePage'));
const Orders = lazy(() => import('../features/account/OrdersPage'));
const OrderDetail = lazy(() => import('../features/account/OrderDetailPage'));
const Invoice = lazy(() => import('../features/account/InvoicePage'));
const Wishlist = lazy(() => import('../features/wishlist/WishlistPage'));
const Contact = lazy(() => import('../features/info/ContactPage'));
const Delivery = lazy(() => import('../features/info/DeliveryPage'));
const Warranty = lazy(() => import('../features/info/WarrantyPage'));
const Privacy = lazy(() => import('../features/info/PrivacyPage'));
const AdminApp = lazy(() => import('../features/admin/AdminApp'));

const page = (node: ReactNode) => <Suspense fallback={<LoadingState />}>{node}</Suspense>;
const authed = (node: ReactNode) => page(<RequireAuth>{node}</RequireAuth>);

function ErrorPage({ notFound = false }: { notFound?: boolean }) {
  const err = useRouteError() as { status?: number } | undefined;
  const is404 = notFound || err?.status === 404;
  return (
    <div className="mx-auto grid min-h-[70dvh] max-w-md place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-6xl font-extrabold tracking-[-0.04em] text-yellow">
          {is404 ? '404' : t.common.oops}
        </h1>
        <p className="mt-3 text-muted">
          {is404 ? t.common.pageNotFound : t.common.error}
        </p>
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
      // One page logs in and signs up; old links and bookmarks land there, keeping ?next= and ?t=.
      { path: 'signup', element: <ToLogin /> },
      { path: 'forgot-password', element: <ToLogin /> },
      { path: 'account', element: authed(<Profile />) },
      { path: 'account/orders', element: authed(<Orders />) },
      { path: 'account/orders/:number', element: authed(<OrderDetail />) },
      { path: 'account/orders/:number/invoice', element: authed(<Invoice />) },
      { path: 'wishlist', element: page(<Wishlist />) },
      { path: 'contact', element: page(<Contact />) },
      { path: 'delivery', element: page(<Delivery />) },
      { path: 'warranty', element: page(<Warranty />) },
      { path: 'privacy', element: page(<Privacy />) },
      { path: '*', element: <ErrorPage notFound /> },
    ],
  },
  {
    path: '/admin/*',
    errorElement: <ErrorPage />,
    element: page(
      <RequireAdmin>
        <AdminApp />
      </RequireAdmin>,
    ),
  },
]);
