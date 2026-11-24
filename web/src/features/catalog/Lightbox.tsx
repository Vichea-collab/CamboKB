import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { ImageUrls } from '../../shared/lib/types';
import { t } from '../../shared/lib/strings';

type Photo = ImageUrls & { id: string };
type View = { scale: number; x: number; y: number };

const MIN = 1;
const MAX = 5;
const DOUBLE_TAP = 2.5;
const FLAT: View = { scale: MIN, x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Full-screen photo viewer: zoom with the buttons, the wheel, a pinch or a double tap; drag to look around
 * a zoomed photo; swipe, arrow keys or the arrows to change photos. It fits any screen: the photo is
 * always scaled to fit, and the toolbar and thumbnails never cover it on short phones.
 */
export function Lightbox({
  photos,
  name,
  index,
  onIndex,
  onClose,
}: {
  photos: Photo[];
  name: string;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(FLAT);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastTap = useRef({ at: 0, x: 0, y: 0 });
  const photo = photos[index]!;
  const many = photos.length > 1;

  /** Keep a zoomed photo from being dragged away from the screen. The photo is drawn to fit the stage, so its size follows its shape. */
  const limit = useCallback((next: View): View => {
    const box = stage.current;
    const el = img.current;
    if (!box || !el) return next;
    const ratio =
      el.naturalWidth && el.naturalHeight
        ? el.naturalWidth / el.naturalHeight
        : box.clientWidth / box.clientHeight;
    const fitW = Math.min(box.clientWidth, box.clientHeight * ratio);
    const fitH = fitW / ratio;
    const maxX = Math.max(0, (fitW * next.scale - box.clientWidth) / 2);
    const maxY = Math.max(0, (fitH * next.scale - box.clientHeight) / 2);
    return { scale: next.scale, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, []);

  /** Zoom to `scale`, keeping the point under (cx, cy), measured from the middle of the stage, where it is. */
  const zoomTo = useCallback(
    (scale: number, cx = 0, cy = 0) =>
      setView((v) => {
        const s = clamp(scale, MIN, MAX);
        if (s === MIN) return FLAT;
        const k = s / v.scale;
        return limit({ scale: s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
      }),
    [limit],
  );
  /** Change photo and show it unzoomed. */
  const go = (i: number) => {
    setView(FLAT);
    onIndex(i);
  };
  const step = (by: number) => go((index + by + photos.length) % photos.length);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && many) step(1);
      else if (e.key === 'ArrowLeft' && many) step(-1);
      else if (e.key === '+' || e.key === '=') zoomTo(view.scale * 1.5);
      else if (e.key === '-' || e.key === '_') zoomTo(view.scale / 1.5);
      else if (e.key === '0') setView(FLAT);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // The photo is re-fitted when the window or phone is turned, so a zoomed photo cannot end up off screen.
  useEffect(() => {
    const refit = () => setView((v) => limit(v));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [limit]);

  const centre = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  };

  const onWheel = (e: WheelEvent) => {
    const c = centre(e);
    zoomTo(view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), c.x, c.y);
  };

  const down = (e: PointerEvent) => {
    stage.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: view.scale };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
    }
  };

  const move = (e: PointerEvent) => {
    const known = pointers.current.get(e.pointerId);
    if (!known) return;
    const dx = e.clientX - known.x;
    const dy = e.clientY - known.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = centre({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
      zoomTo(gesture.current.scale * (dist / gesture.current.dist), mid.x, mid.y);
    } else if (drag.current) {
      if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 6)
        drag.current.moved = true;
      if (view.scale > MIN) setView((v) => limit({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const up = (e: PointerEvent) => {
    const start = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (!start || pointers.current.size > 0) return;
    drag.current = null;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // A swipe on a photo that is not zoomed changes the photo.
    if (view.scale === MIN && many && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (start.moved) return;
    // A double tap (or double click) zooms in on the spot, or back out.
    const now = e.timeStamp;
    const tap = lastTap.current;
    if (now - tap.at < 320 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 40) {
      const c = centre(e);
      if (view.scale > MIN) setView(FLAT);
      else zoomTo(DOUBLE_TAP, c.x, c.y);
      lastTap.current = { at: 0, x: 0, y: 0 };
    } else lastTap.current = { at: now, x: e.clientX, y: e.clientY };
  };

  const zoomed = view.scale > MIN;
  const tool =
    'grid size-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.product.photoViewer(name)}
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white motion-safe:animate-[lightbox_.15s_ease-out]"
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="min-w-12 pl-2 text-sm font-semibold tabular-nums" aria-live="polite">
          {many ? `${index + 1}/${photos.length}` : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={tool}
            aria-label={t.product.photoZoomOut}
            disabled={!zoomed}
            onClick={() => zoomTo(view.scale / 1.6)}
          >
            <Minus className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            className={tool}
            aria-label={t.product.photoZoomReset}
            disabled={!zoomed}
            onClick={() => setView(FLAT)}
          >
            <RotateCcw className="size-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            className={tool}
            aria-label={t.product.photoZoomIn}
            disabled={view.scale >= MAX}
            onClick={() => zoomTo(view.scale * 1.6)}
          >
            <Plus className="size-5" aria-hidden />
          </button>
          <button
            ref={closeBtn}
            type="button"
            className={tool}
            aria-label={t.common.close}
            onClick={onClose}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div
        ref={stage}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        onWheel={onWheel}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div className="absolute inset-0">
          <img
            ref={img}
            key={photo.id}
            src={photo.lg}
            srcSet={`${photo.md} 800w, ${photo.lg} 1200w`}
            sizes="100vw"
            alt={t.product.photoAlt(name, index + 1)}
            draggable={false}
            onLoad={() => setView((v) => limit(v))}
            className="absolute inset-0 size-full object-contain will-change-transform"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: pointers.current.size ? 'none' : 'transform .15s ease-out',
            }}
          />
        </div>
        {many && (
          <>
            <button
              type="button"
              className={`${tool} absolute left-2 top-1/2 -translate-y-1/2 max-sm:hidden`}
              aria-label={t.product.photoPrev}
              onClick={() => step(-1)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <button
              type="button"
              className={`${tool} absolute right-2 top-1/2 -translate-y-1/2 max-sm:hidden`}
              aria-label={t.product.photoNext}
              onClick={() => step(1)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </>
        )}
      </div>

      {many && (
        <div className="flex justify-center gap-2 overflow-x-auto px-3 pb-[calc(0.75rem+var(--bar-safe))] pt-2 [scrollbar-width:none] [@media(max-height:480px)]:hidden">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(i)}
              aria-label={t.product.photoGo(i + 1)}
              aria-current={i === index}
              className={`size-14 shrink-0 overflow-hidden rounded-lg border-2 transition-opacity ${i === index ? 'border-yellow' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              <img src={p.sm} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes lightbox{from{opacity:0}}`}</style>
    </div>,
    document.body,
  );
}
