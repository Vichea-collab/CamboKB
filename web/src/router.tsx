import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, useRouteError } from 'react-router';
import { RequireAdmin, RequireAuth } from './lib/auth';
import { t } from './lib/strings';
import { StoreLayout } from './layouts/StoreLayout';
import Home from './pages/Home';
import ProductDetail from './pages/ProductDetail';

const Checkout = lazy(() => import('./pages/Checkout'));
const OrderSuccess = lazy(() => import('./pages/OrderSuccess'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Profile = lazy(() => import('./pages/account/Profile'));
const Orders = lazy(() => import('./pages/account/Orders'));
const OrderDetail = lazy(() => import('./pages/account/OrderDetail'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

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
      { path: 'orders/:number/success', element: authed(<OrderSuccess />) },
      { path: 'login', element: page(<Login />) },
      { path: 'signup', element: page(<Signup />) },
      { path: 'forgot-password', element: page(<ForgotPassword />) },
      { path: 'account', element: authed(<Profile />) },
      { path: 'account/orders', element: authed(<Orders />) },
      { path: 'account/orders/:number', element: authed(<OrderDetail />) },
      { path: '*', element: <ErrorPage /> },
    ],
  },
  { path: '/admin/*', errorElement: <ErrorPage />, element: page(<RequireAdmin><AdminApp /></RequireAdmin>) },
]);
