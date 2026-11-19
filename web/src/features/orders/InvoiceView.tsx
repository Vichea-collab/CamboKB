import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiText, apiUrl } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { ErrorState, LoadingState, PageHeader } from '../../shared/ui/Page';

// The invoice is laid out as an A4 sheet (210 x 297 mm at 96 dpi).
const SHEET_W = 794;
const SHEET_H = 1160;

/** Scale the sheet down to fit a narrow screen, never up. */
function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setScale(Math.min(1, el.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return { ref, scale };
}

/**
 * Look at the invoice first, then download it as a PDF. The page is shown in a frame with every
 * restriction on (it holds customer-written text): no scripts, no forms, no access to the shop.
 */
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
  useDocumentTitle(`${t.invoice.title} ${number}`);
  const page = useQuery({ queryKey: ['invoice', htmlPath], queryFn: () => apiText(htmlPath), retry: false });
  const { ref, scale } = useFit(SHEET_W);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`${t.invoice.title} ${number}`}
        back={back}
        actions={
          <a href={apiUrl(`${pdfPath}?download=1`)} download className="btn-primary">
            <Download className="size-[18px]" aria-hidden />
            {t.invoice.download}
          </a>
        }
      />
      {page.isError ? (
        <ErrorState message={(page.error as Error).message} onRetry={() => page.refetch()} />
      ) : !page.data ? (
        <LoadingState />
      ) : (
        <div ref={ref} className="overflow-hidden rounded-2xl ring-1 ring-line" style={{ height: SHEET_H * scale }}>
          <iframe
            title={`${t.invoice.title} ${number}`}
            srcDoc={page.data}
            sandbox=""
            className="block border-0 bg-white"
            style={{ width: SHEET_W, height: SHEET_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          />
        </div>
      )}
    </div>
  );
}
