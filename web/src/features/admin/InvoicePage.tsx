import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../../shared/lib/api';
import InvoiceView from '../orders/InvoiceView';
import { LoadingState } from '../../shared/ui/Page';
import type { AdminOrder } from './types';

export default function AdminInvoicePage() {
  const { id = '' } = useParams();
  const order = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => api<AdminOrder>(`/admin/orders/${id}`) });
  if (!order.data) return <LoadingState shape="sheetPage" />;
  return <InvoiceView number={order.data.number} htmlPath={`/admin/orders/${id}/invoice.html`} pdfPath={`/admin/orders/${id}/invoice.pdf`} back={{ to: `/admin/orders/${id}`, label: order.data.number }} />;
}
