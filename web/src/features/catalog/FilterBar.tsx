import { ArrowUpDown, Check } from 'lucide-react';
import { useState } from 'react';
import { Drawer } from '../../shared/ui/Drawer';
import type { Category } from '../../shared/lib/types';
import { categoryName, t } from '../../shared/lib/strings';

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
}: {
  categories: Category[];
  category: string;
  onCategory: (slug: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const chips = [{ slug: '', name: t.home.all }, ...categories];
  return (
    <div className="sticky top-[var(--hdr,64px)] z-30 -mx-4 border-b border-line/60 bg-bg/90 px-4 py-2.5 backdrop-blur-md transition-[top] duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 motion-reduce:transition-none">
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
          <select
            aria-label={t.home.sort}
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="h-10 cursor-pointer appearance-none rounded-full bg-surface pl-9 pr-4 text-sm font-semibold text-ink ring-1 ring-line hover:ring-line-strong"
          >
            {OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label()}
              </option>
            ))}
          </select>
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
