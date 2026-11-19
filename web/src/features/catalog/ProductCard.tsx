import { Images, Keyboard, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { categoryName, t } from '../../shared/lib/strings';
import type { ProductCardData } from '../../shared/lib/types';
import { Price } from '../../shared/ui/Price';
import { QtyStepper } from '../../shared/ui/QtyStepper';
import { useCart } from '../cart/cart-store';

export function ProductCard({
  product: p,
  onAdd,
}: {
  product: ProductCardData;
  onAdd: (p: ProductCardData) => void;
}) {
  const qty = useCart((s) => s.items.find((i) => i.productId === p.id)?.quantity ?? 0);
  const setQty = useCart((s) => s.setQty);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-surface ring-1 ring-line transition duration-200 hover:-translate-y-0.5 hover:shadow-lift hover:ring-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <Link
        to={`/products/${p.slug}`}
        className="flex flex-1 flex-col focus-visible:outline-offset-[-2px]"
      >
        <div className="media relative aspect-square">
          {p.image ? (
            <img
              src={p.image.md}
              srcSet={`${p.image.sm} 400w, ${p.image.md} 800w`}
              sizes="(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              alt=""
              loading="lazy"
              decoding="async"
              className={`size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${p.isSoldOut ? 'opacity-40 grayscale' : ''}`}
            />
          ) : (
            <div className="grid size-full place-items-center text-muted/50">
              <Keyboard className="size-10" aria-hidden />
            </div>
          )}
          {p.isSoldOut && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="badge bg-bg/90 text-danger ring-1 ring-danger/40">
                {t.product.soldOut}
              </span>
            </span>
          )}
          {p.imageCount > 1 && (
            <span
              aria-label={t.product.photosLabel(p.imageCount)}
              className="badge absolute bottom-2 right-2 bg-bg/80 px-2 text-ink backdrop-blur-sm"
            >
              <Images className="size-3" aria-hidden />
              {p.imageCount}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col px-3 pb-1 pt-3">
          <p className="text-xs font-semibold text-muted">{categoryName(p.category.slug, p.category.name)}</p>
          <h3 className="mt-0.5 line-clamp-2 text-[0.92rem] font-bold leading-snug">{p.name}</h3>
          {p.specsLine && <p className="mt-1 line-clamp-1 text-xs text-muted">{p.specsLine}</p>}
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-2">
        <Price cents={p.priceCents} compareAt={p.compareAtCents} className="text-[1.3rem]" />
        {qty > 0 && !p.isSoldOut ? (
          <QtyStepper compact value={qty} onChange={(n) => setQty(p.id, n)} label={p.name} />
        ) : (
          <button
            type="button"
            onClick={() => onAdd(p)}
            disabled={p.isSoldOut}
            aria-label={`${t.product.add} ${p.name}`}
            className="btn-primary btn-sm min-h-10 gap-1 px-3.5"
          >
            <Plus className="size-4" strokeWidth={3} aria-hidden />
            {t.product.add}
          </button>
        )}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line" aria-hidden>
      <div className="aspect-square animate-pulse bg-raised/60 motion-reduce:animate-none" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-1/3 animate-pulse rounded bg-raised/70" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-raised" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-raised/70" />
        <div className="flex items-center justify-between pt-2">
          <div className="h-6 w-14 animate-pulse rounded bg-raised" />
          <div className="h-10 w-20 animate-pulse rounded-xl bg-raised/60" />
        </div>
      </div>
    </div>
  );
}
