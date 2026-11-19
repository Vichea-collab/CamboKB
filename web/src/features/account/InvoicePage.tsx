import { useParams } from 'react-router';
import InvoiceView from '../orders/InvoiceView';
import { t } from '../../shared/lib/strings';

export default function InvoicePage() {
  const { number = '' } = useParams();
  const n = encodeURIComponent(number);
  return <InvoiceView number={number} htmlPath={`/orders/${n}/invoice.html`} pdfPath={`/orders/${n}/invoice.pdf`} back={{ to: `/account/orders/${n}`, label: t.invoice.backToOrder }} />;
}
