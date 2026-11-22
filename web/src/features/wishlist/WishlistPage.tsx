import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import type { ProductCardData } from '../../shared/lib/types';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { useUi } from '../../shared/lib/ui-store';
import { EmptyState, ErrorState, PageHeader } from '../../shared/ui/Page';
import { useAddToCart } from '../cart/useAddToCart';
import { ProductCard, ProductCardSkeleton } from '../catalog/ProductCard';
import { ProductGrid } from '../catalog/ProductGrid';
import { useWishlist } from './wishlist-store';

/** Saved products joined with live data, in saved order. Ids that no longer exist are dropped with a notice. */
function useWishlistProducts() {
  const ids = useWishlist((s) => s.ids);
  const removeMany = useWishlist((s) => s.removeMany);
  const showToast = useUi((s) => s.showToast);
  const key = [...ids].sort().join(',');
  const query = useQuery({
    queryKey: ['products', 'by-ids', 'wishlist', key],
    queryFn: () =>
      api<{ items: ProductCardData[] }>(`/products/by-ids?ids=${key}`).then((r) => r.items),
    enabled: ids.length > 0,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!query.data) return;
    const found = new Set(query.data.map((p) => p.id));
    const gone = ids.filter((id) => !found.has(id));
    if (gone.length) {
      removeMany(gone);
      showToast(t.wishlist.goneToast);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const byId = new Map((query.data ?? []).map((p) => [p.id, p]));
  const items = ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
  return { ids, items, query };
}

export default function Wishlist() {
  useDocumentTitle(t.wishlist.title);
  const { ids, items, query } = useWishlistProducts();
  const addToCart = useAddToCart();

  return (
    <div>
      <PageHeader
        title={t.wishlist.title}
        description={ids.length > 0 ? t.wishlist.count(ids.length) : undefined}
      />
      {ids.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t.wishlist.empty}
          action={
            <Link to="/" className="btn-primary">
              {t.wishlist.browse}
            </Link>
          }
        >
          {t.wishlist.emptyHint}
        </EmptyState>
      ) : query.isError ? (
        <ErrorState message={t.home.error} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <ProductGrid>
          {ids.slice(0, 8).map((id) => (
            <ProductCardSkeleton key={id} />
          ))}
        </ProductGrid>
      ) : (
        <ProductGrid>
          {items.map((p) => (
            <ProductCard key={p.id} product={p} onAdd={addToCart} />
          ))}
        </ProductGrid>
      )}
    </div>
  );
}
