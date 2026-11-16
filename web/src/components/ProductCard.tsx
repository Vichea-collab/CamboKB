import { Link } from 'react-router';
import { t } from '../lib/strings';
import type { ProductCardData } from '../lib/types';
import { Price } from './Price';

const badge = 'absolute rounded-full border border-line bg-bg/85 px-2 py-[3px] text-[0.65rem] font-bold backdrop-blur-md';

export function ProductCard({ product: p, onAdd }: { product: ProductCardData; onAdd: (p: ProductCardData) => void }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_4px_16px_rgb(0_0_0/0.3)] transition-colors hover:border-line-strong">
      <Link to={`/products/${p.slug}`} className="flex flex-1 flex-col rounded-[18px] focus-visible:outline-offset-[-2px]">
        <div className="relative aspect-square overflow-hidden bg-[#090c10]">
          {p.image ? (
            <img
              src={p.image.md}
              srcSet={`${p.image.sm} 400w, ${p.image.md} 800w`}
              sizes="(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-300 ease-[cubic-bezier(.25,1,.5,1)] group-hover:scale-[1.04]"
            />
          ) : (
            <div className="grid size-full place-items-center text-4xl opacity-40">⌨️</div>
          )}
          <span className={`${badge} left-2 top-2 text-yellow`}>{p.category.name}</span>
          {p.isSoldOut && <span className="absolute right-2 top-2 rounded-md bg-red-500/90 px-2 py-[3px] text-[0.62rem] font-extrabold text-white">{t.product.soldOut}</span>}
          {p.imageCount > 1 && <span className={`${badge} bottom-2 right-2 text-[0.62rem] text-ink`}>{t.product.photos(p.imageCount)}</span>}
        </div>
        <div className="flex flex-1 flex-col px-3 pb-0 pt-3">
          <h3 className="line-clamp-2 text-[0.88rem] font-extrabold leading-snug">{p.name}</h3>
          {p.specsLine && <p className="mt-1 line-clamp-2 text-[0.72rem] leading-snug text-muted">{p.specsLine}</p>}
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-3">
        <Price cents={p.priceCents} compareAt={p.compareAtCents} className="text-[1.1rem]" />
        <button
          type="button"
          onClick={() => onAdd(p)}
          disabled={p.isSoldOut}
          aria-label={`${t.product.add} ${p.name}`}
          className="rounded-[10px] bg-yellow px-3.5 py-2 text-[0.8rem] font-extrabold text-bg shadow-[0_2px_10px_rgb(255_183_3/0.35)] transition-[background-color,transform] hover:bg-yellow-hover active:scale-95 disabled:bg-raised disabled:text-muted disabled:shadow-none"
        >
          + {t.product.add}
        </button>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-surface" aria-hidden>
      <div className="aspect-square animate-pulse bg-raised/60" />
      <div className="space-y-2 p-3">
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-raised" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-raised/70" />
        <div className="h-8 w-full animate-pulse rounded-lg bg-raised/50" />
      </div>
    </div>
  );
}
