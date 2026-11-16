import { Route, Routes } from 'react-router';
import { AdminLayout } from './AdminLayout';
import Banners from './Banners';
import Categories from './Categories';
import CustomerDetail from './CustomerDetail';
import Customers from './Customers';
import Dashboard from './Dashboard';
import OrderDetail from './OrderDetail';
import Orders from './Orders';
import ProductEdit from './ProductEdit';
import Products from './Products';
import Promos from './Promos';
import Reports from './Reports';
import Settings from './Settings';

/** Admin section: lazy-loaded, so none of this ships to shoppers. */
export default function AdminApp() {
  return (
    <AdminLayout>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductEdit />} />
        <Route path="products/:id" element={<ProductEdit />} />
        <Route path="categories" element={<Categories />} />
        <Route path="banners" element={<Banners />} />
        <Route path="promos" element={<Promos />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<p className="text-muted">Page not found.</p>} />
      </Routes>
    </AdminLayout>
  );
}
