import { Navigate, useSearchParams } from 'react-router';
import { apiUrl } from '../../shared/lib/api';
import { DocumentPreview } from '../../shared/ui/DocumentPreview';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The sales report for the dates picked on the Reports page: look at it first, then download it as a PDF. */
export default function ReportPreview() {
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const groupBy = params.get('groupBy') === 'month' ? 'month' : 'day';
  if (!DATE.test(from) || !DATE.test(to) || from > to) return <Navigate to="/admin/reports" replace />;
  const query = `from=${from}&to=${to}&groupBy=${groupBy}`;
  return (
    <DocumentPreview
      title={`Sales report ${from} to ${to}`}
      htmlPath={`/admin/reports/report.html?${query}`}
      downloadHref={apiUrl(`/admin/reports/report.pdf?${query}&download=1`)}
      back={{ to: `/admin/reports?${query}`, label: 'Reports' }}
      autoHeight
    />
  );
}
