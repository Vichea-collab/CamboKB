import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { apiText } from '../lib/api';
import { t } from '../lib/strings';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ErrorState, LoadingState, PageHeader } from './Page';

// A printed document is laid out as an A4 sheet (210 x 297 mm at 96 dpi) plus 16px padding on all sides for the screen preview.
const PAD = 16;
const SHEET_W = 794 + PAD * 2;
const SHEET_H = 1160;
/** The sheet is never drawn bigger than this (1 = real size), however far someone zooms in. */
const MAX_SCALE = 1.5;

/**
 * How far to shrink the sheet so it fits the width it is shown in (never up). The box is held in state through a
 * callback ref: it only exists once the document has loaded, so an effect that ran on mount would never see it.
 */
function useFit(width: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setFit(Math.min(1, el.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, width]);
  return { ref: setEl, fit };
}

const gap = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * Every PDF in the shop is looked at first, then downloaded with a button: this is that page. The document's page
 * form is shown in a frame with every restriction on (it holds customer-written text): no scripts, no forms, no
 * access to the shop. It starts fitted to the screen; on a phone that is small, so it can be zoomed with a two-finger
 * pinch and panned sideways. The page itself never zooms: this and the photo viewer are the only places that do.
 *
 * `autoHeight` is for documents that run over several pages (a sales report): the frame is then as tall as its
 * content, which needs the frame to share the page's origin. Scripts are still off, so nothing in it can run.
 */
export function DocumentPreview({
  title,
  htmlPath,
  downloadHref,
  back,
  autoHeight = false,
}: {
  title: string;
  htmlPath: string;
  downloadHref: string;
  back: { to: string; label: string };
  autoHeight?: boolean;
}) {
  useDocumentTitle(title);
  const page = useQuery({ queryKey: ['document', htmlPath], queryFn: () => apiText(htmlPath), retry: false });
  const { ref: fitRef, fit } = useFit(SHEET_W);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1); // 1 = fitted to the screen
  const [contentH, setContentH] = useState(SHEET_H);
  const maxZoom = Math.max(1, MAX_SCALE / fit);
  const level = Math.min(zoom, maxZoom);
  const scale = fit * level;
  const sheetW = Math.round(SHEET_W * scale);
  const frameH = autoHeight ? Math.max(SHEET_H, contentH) : SHEET_H;

  // The latest numbers, for the touch handlers (which are attached once, not on every render).
  const live = useRef({ level, maxZoom, sheetW });
  live.current = { level, maxZoom, sheetW };
  // The point of the sheet under the fingers, kept there while the sheet grows or shrinks.
  const anchor = useRef<{ ratio: number; x: number } | null>(null);

  useEffect(() => {
    if (!scroller) return;
    let pinch: { dist: number; level: number } | null = null;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinch = { dist: gap(e.touches[0]!, e.touches[1]!), level: live.current.level };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2 || pinch.dist === 0) return;
      e.preventDefault(); // two fingers zoom the sheet, they do not scroll the page
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const x = (a.clientX + b.clientX) / 2 - scroller.getBoundingClientRect().left;
      anchor.current = { ratio: (scroller.scrollLeft + x) / live.current.sheetW, x };
      setZoom(Math.min(live.current.maxZoom, Math.max(1, (pinch.level * gap(a, b)) / pinch.dist)));
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    scroller.addEventListener('touchstart', start, { passive: true });
    scroller.addEventListener('touchmove', move, { passive: false });
    scroller.addEventListener('touchend', end, { passive: true });
    scroller.addEventListener('touchcancel', end, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', start);
      scroller.removeEventListener('touchmove', move);
      scroller.removeEventListener('touchend', end);
      scroller.removeEventListener('touchcancel', end);
    };
  }, [scroller]);

  useLayoutEffect(() => {
    if (!scroller || !anchor.current) return;
    scroller.scrollLeft = anchor.current.ratio * sheetW - anchor.current.x;
    anchor.current = null;
  }, [scroller, sheetW]);

  /** Size the frame to its content once it has loaded, and again when its fonts arrive. */
  const measure = (e: SyntheticEvent<HTMLIFrameElement>) => {
    if (!autoHeight) return;
    const doc = e.currentTarget.contentDocument;
    if (!doc) return;
    const read = () => setContentH(Math.ceil(doc.documentElement.scrollHeight));
    read();
    void doc.fonts?.ready.then(read);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={title}
        back={back}
        actions={
          <a href={downloadHref} download className="btn-primary">
            <Download className="size-[18px]" aria-hidden />
            {t.invoice.download}
          </a>
        }
      />
      {page.isError ? (
        <ErrorState message={(page.error as Error).message} onRetry={() => page.refetch()} />
      ) : !page.data ? (
        <LoadingState shape="sheet" />
      ) : (
        <div ref={fitRef} className="w-full">
          {/* Pinch with two fingers to zoom the sheet, then pan sideways; swiping up and down still scrolls the page.
              The frame ignores touches so they reach this box (a frame would swallow them). */}
          <div ref={setScroller} className="overflow-x-auto overflow-y-hidden [touch-action:pan-x_pan-y]" data-testid="document-scroller">
            <div
              className="mx-auto overflow-hidden rounded-2xl bg-[#e7eaf0] shadow-sm ring-1 ring-line"
              style={{ width: sheetW, height: Math.round(frameH * scale) }}
              data-testid="document-sheet"
            >
              <iframe
                title={title}
                srcDoc={page.data}
                sandbox={autoHeight ? 'allow-same-origin' : ''}
                onLoad={measure}
                className="pointer-events-none block border-0 bg-[#e7eaf0]"
                style={{
                  width: SHEET_W,
                  height: frameH,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
