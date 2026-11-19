import { ArrowUpDown } from 'lucide-react';
import type { Category } from '../../shared/lib/types';
import { categoryName, t } from '../../shared/lib/strings';

export type SortKey = 'featured' | 'price-asc' | 'price-desc';

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
        <label className="relative shrink-0">
          <span className="sr-only">{t.home.sort}</span>
          {/* Phones: just an icon (the real select sits invisibly on top). From tablet up: a labelled select. */}
          <span className="btn-icon relative text-ink sm:hidden" aria-hidden>
            <ArrowUpDown className="size-4" />
            {sort !== 'featured' && (
              <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-yellow ring-2 ring-bg" />
            )}
          </span>
          <ArrowUpDown
            className="pointer-events-none absolute left-3 top-1/2 hidden size-4 -translate-y-1/2 text-muted sm:block"
            aria-hidden
          />
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full text-ink opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-yellow sm:static sm:h-10 sm:w-auto sm:bg-surface sm:pl-9 sm:pr-4 sm:text-sm sm:font-semibold sm:opacity-100 sm:ring-1 sm:ring-line sm:hover:ring-line-strong"
          >
            <option value="featured">{t.home.sortFeatured}</option>
            <option value="price-asc">{t.home.sortPriceAsc}</option>
            <option value="price-desc">{t.home.sortPriceDesc}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
