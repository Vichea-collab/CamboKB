import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useCart } from '../cart/cart-store';
import { useUi } from '../../shared/lib/ui-store';
import { api } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import type { Banner, Category, Paged, ProductCardData, ProductDetailData } from '../../shared/lib/types';

export const useCategories = () =>
  useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => api<{ items: Category[] }>('/categories').then((r) => r.items), staleTime: 5 * 60_000 });

export const useBanners = () =>
  useQuery({ queryKey: ['catalog', 'banners'], queryFn: () => api<{ items: Banner[] }>('/banners').then((r) => r.items), staleTime: 5 * 60_000 });

export function useProducts(params: { q?: string; category?: string }) {
  const qs = new URLSearchParams({ pageSize: '100' });
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  return useQuery({
    queryKey: ['products', params.q ?? '', params.category ?? ''],
    queryFn: () => api<Paged<ProductCardData>>(`/products?${qs}`),
    placeholderData: keepPreviousData,
  });
}

export const useProduct = (slug: string) =>
  useQuery({ queryKey: ['products', 'detail', slug], queryFn: () => api<ProductDetailData>(`/products/${encodeURIComponent(slug)}`) });

/** Cart lines joined with live product data; lines for products that disappeared are dropped. */
export function useCartProducts() {
  const items = useCart((s) => s.items);
  const removeMany = useCart((s) => s.removeMany);
  const showToast = useUi((s) => s.showToast);
  const ids = items.map((i) => i.productId).sort();
  const query = useQuery({
    queryKey: ['products', 'by-ids', ids.join(',')],
    queryFn: () => api<{ items: ProductCardData[] }>(`/products/by-ids?ids=${ids.join(',')}`).then((r) => r.items),
    enabled: ids.length > 0,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!query.data) return;
    const found = new Set(query.data.map((p) => p.id));
    const gone = ids.filter((id) => !found.has(id));
    if (gone.length) {
      removeMany(gone);
      showToast(t.cart.itemRemoved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const byId = new Map((query.data ?? []).map((p) => [p.id, p]));
  const lines = items.flatMap((i) => {
    const product = byId.get(i.productId);
    return product ? [{ ...i, product }] : [];
  });
  const subtotalCents = lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
  return { lines, subtotalCents, isLoading: ids.length > 0 && query.isPending, refetch: query.refetch };
}
