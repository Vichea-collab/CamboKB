import { ArrowUpDown, Check } from 'lucide-react';
import { useState } from 'react';
import { Drawer } from '../../shared/ui/Drawer';
import { Select } from '../../shared/ui/Select';
import type { Category } from '../../shared/lib/types';
import { categoryName, t } from '../../shared/lib/strings';
import { PriceFilter } from './PriceFilter';
import { Bone } from '../../shared/ui/Skeleton';

export type SortKey = 'featured' | 'price-asc' | 'price-desc';

const OPTIONS: { key: SortKey; label: () => string }[] = [
  { key: 'featured', label: () => t.home.sortFeatured },
  { key: 'price-asc', label: () => t.home.sortPriceAsc },
  { key: 'price-desc', label: () => t.home.sortPriceDesc },
];

/** Sticks under the header while browsing: categories on the left, sort on the right. */
export function FilterBar({
  categories,
  category,
  onCategory,
  sort,
  onSort,
  minPrice = '',
  maxPrice = '',
  onPrice,
}: {
  categories: Category[];
  category: string;
  onCategory: (slug: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  /** Price range in dollars, '' when not set. The Price button shows only when `onPrice` is given. */
  minPrice?: string;
  maxPrice?: string;
  onPrice?: (min: string, max: string) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const chips = [{ slug: '', name: t.home.all }, ...categories];
  return (
    <div className="sticky top-[var(--hdr,var(--hdr-h,56px))] z-30 -mx-4 border-b border-line/60 bg-bg/90 px-4 py-2.5 backdrop-blur-md transition-[top] duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 motion-reduce:transition-none">
      <div className="flex items-center gap-3">
        <div
          className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-0.5 pr-6 [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] [scrollbar-width:none]"
          role="tablist"
          aria-label={t.home.categories}
        >
          {chips.map((c) => {
            const on = c.slug === category;
            return (
              <button
                key={c.slug || 'all'}
                role="tab"
                aria-selected={on}
                onClick={() => onCategory(c.slug)}
                className="chip"
              >
                {c.slug ? categoryName(c.slug, c.name) : c.name}
              </button>
            );
          })}
        </div>
        {onPrice && <PriceFilter min={minPrice} max={maxPrice} onApply={onPrice} />}
        {/* Phones: an icon button that opens a bottom sheet (the browser's own menu floats loose over the page). */}
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-label={t.home.sort}
          aria-haspopup="dialog"
          className="btn-icon relative shrink-0 text-ink sm:hidden"
        >
          <ArrowUpDown className="size-4" aria-hidden />
          {sort !== 'featured' && <span data-active-sort className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-yellow ring-2 ring-bg" />}
        </button>
        {/* Tablets and desktops: a labelled dropdown. */}
        <div className="relative hidden shrink-0 sm:block">
          <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Select
            aria-label={t.home.sort}
            value={sort}
            onChange={(v) => onSort(v as SortKey)}
            options={OPTIONS.map((o) => ({ value: o.key, label: o.label() }))}
            className="h-10 cursor-pointer rounded-full bg-surface pl-9 pr-3 text-sm font-semibold text-ink ring-1 ring-line hover:ring-line-strong"
          />
        </div>
      </div>
      <Drawer open={sheet} onClose={() => setSheet(false)} title={t.home.sort}>
        <div role="radiogroup" aria-label={t.home.sort} className="-mx-1 flex flex-col pb-2">
          {OPTIONS.map((o) => {
            const on = o.key === sort;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  onSort(o.key);
                  setSheet(false);
                }}
                className={`flex min-h-14 items-center justify-between gap-3 rounded-xl px-3 text-left text-base font-semibold transition-colors ${on ? 'bg-yellow/10 text-yellow' : 'text-ink hover:bg-raised'}`}
              >
                {o.label()}
                {on && <Check className="size-5" aria-hidden />}
              </button>
            );
          })}
        </div>
      </Drawer>
    </div>
  );
}

/** The category buttons' place, while the categories load. */
export function FilterBarSkeleton() {
  return (
    <div className="-mx-4 flex gap-2 overflow-hidden border-b border-line/60 px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-hidden>
      {['w-14', 'w-28', 'w-20', 'w-28', 'w-32'].map((w, i) => (
        <Bone key={i} className={`h-11 shrink-0 rounded-full ${w}`} />
      ))}
    </div>
  );
}
