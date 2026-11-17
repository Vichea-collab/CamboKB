import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BannerCarousel } from './BannerCarousel';
import { CategoryChips } from './CategoryChips';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { ProductGrid } from './ProductGrid';
import { useBanners, useCategories, useProducts } from './api';
import { t } from '../../shared/lib/strings';
import { useAddToCart } from '../cart/useAddToCart';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';

export default function Home() {
  useDocumentTitle();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const [draft, setDraft] = useState(q);

  // Debounce typing into the URL (?q=) so results are shareable and back/forward works.
  useEffect(() => {
    if (draft === q) return;
    const id = setTimeout(() => {
      setParams((p) => {
        const next = new URLSearchParams(p);
        if (draft.trim()) next.set('q', draft.trim());
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [draft, q, setParams]);

  const categories = useCategories();
  const banners = useBanners();
  const products = useProducts({ q, category });
  const addToCart = useAddToCart();

  const selectCategory = (slug: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (slug) next.set('category', slug);
      else next.delete('category');
      return next;
    });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-[0_4px_18px_rgb(0_0_0/0.35)] focus-within:border-yellow/60">
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="sr-only">Search</span>
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.home.searchPlaceholder}
          className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-muted/80"
          enterKeyHint="search"
        />
      </label>

      {!q && !category && banners.data && <BannerCarousel banners={banners.data} />}

      {categories.data && <CategoryChips categories={categories.data} active={category} onSelect={selectCategory} />}

      <p className="text-sm font-semibold text-muted" aria-live="polite">
        {products.data ? t.home.count(products.data.total) : ' '}
      </p>

      {products.isError ? (
        <div className="panel p-8 text-center">
          <p className="text-muted">{t.home.error}</p>
          <button className="btn-ghost mt-4" onClick={() => products.refetch()}>
            {t.home.retry}
          </button>
        </div>
      ) : !products.data ? (
        <ProductGrid>
          {Array.from({ length: 10 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </ProductGrid>
      ) : products.data.items.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-muted">{t.home.empty}</p>
          {(q || category) && (
            <button
              className="btn-ghost mt-4"
              onClick={() => {
                setDraft('');
                setParams({});
              }}
            >
              {t.home.clear}
            </button>
          )}
        </div>
      ) : (
        <ProductGrid>
          {products.data.items.map((p) => (
            <ProductCard key={p.id} product={p} onAdd={addToCart} />
          ))}
        </ProductGrid>
      )}
    </div>
  );
}
