import { Search, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useFocusSearch } from './useFocusSearch';
import { t } from '../../shared/lib/strings';
import { EmptyState, ErrorState } from '../../shared/ui/Page';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { useAddToCart } from '../cart/useAddToCart';
import { useBanners, useCategories, useProducts } from './api';
import { BannerCarousel } from './BannerCarousel';
import { FilterBar, type SortKey } from './FilterBar';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { ProductGrid } from './ProductGrid';

const SORTS: SortKey[] = ['featured', 'price-asc', 'price-desc'];

export default function Home() {
  useDocumentTitle();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = (
    SORTS.includes(params.get('sort') as SortKey) ? params.get('sort') : 'featured'
  ) as SortKey;
  const [draft, setDraft] = useState(q);
  const searchBox = useFocusSearch<HTMLInputElement>();

  const update = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // Debounce typing into the URL (?q=) so results are shareable and back/forward works.
  useEffect(() => {
    if (draft === q) return;
    const id = setTimeout(() => update('q', draft.trim()), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, q]);

  const categories = useCategories();
  const banners = useBanners();
  const products = useProducts({ q, category });
  const addToCart = useAddToCart();

  const items = useMemo(() => {
    const list = products.data?.items ?? [];
    if (sort === 'price-asc') return [...list].sort((a, b) => a.priceCents - b.priceCents);
    if (sort === 'price-desc') return [...list].sort((a, b) => b.priceCents - a.priceCents);
    return list;
  }, [products.data, sort]);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">{t.home.heading}</h1>
      <label className="flex min-h-12 items-center gap-3 rounded-2xl bg-surface px-4 ring-1 ring-line transition focus-within:ring-2 focus-within:ring-yellow/70">
        <Search className="size-5 shrink-0 text-muted" aria-hidden />
        <span className="sr-only">{t.home.searchLabel}</span>
        <input
          ref={searchBox}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.home.searchPlaceholder}
          className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-muted/80 [&::-webkit-search-cancel-button]:hidden"
          enterKeyHint="search"
        />
        {draft && (
          <button
            type="button"
            onClick={() => setDraft('')}
            aria-label={t.home.clearSearch}
            className="icon-btn -mr-2 rounded-full"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </label>

      {!q && !category && banners.data && <BannerCarousel banners={banners.data} />}

      <div>
        {categories.data && (
          <FilterBar
            categories={categories.data}
            category={category}
            onCategory={(s) => update('category', s)}
            sort={sort}
            onSort={(s) => update('sort', s === 'featured' ? '' : s)}
          />
        )}
        <p className="mb-3 mt-4 text-sm font-semibold text-muted" aria-live="polite">
          {products.data ? t.home.count(products.data.total) : ' '}
        </p>

        {products.isError ? (
          <ErrorState message={t.home.error} onRetry={() => products.refetch()} />
        ) : !products.data ? (
          <ProductGrid>
            {Array.from({ length: 10 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </ProductGrid>
        ) : items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t.home.empty}
            action={
              (q || category) && (
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setDraft('');
                    setParams({});
                  }}
                >
                  {t.home.clear}
                </button>
              )
            }
          />
        ) : (
          <ProductGrid>
            {items.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={addToCart} />
            ))}
          </ProductGrid>
        )}
      </div>
    </div>
  );
}
