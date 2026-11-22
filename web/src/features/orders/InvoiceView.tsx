import { apiUrl } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { DocumentPreview } from '../../shared/ui/DocumentPreview';

/** An invoice: look at it first, then download it as a PDF. */
export default function InvoiceView({
  number,
  htmlPath,
  pdfPath,
  back,
}: {
  number: string;
  htmlPath: string;
  pdfPath: string;
  back: { to: string; label: string };
}) {
  return <DocumentPreview title={`${t.invoice.title} ${number}`} htmlPath={htmlPath} downloadHref={apiUrl(`${pdfPath}?download=1`)} back={back} />;
}
