import { formatUsd } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { Empty, Loading, PageHeader, Table, td, th } from './components/ui';
import type { AdminProduct } from './types';

export default function Products() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'hidden'>('active');
  const products = useQuery({ queryKey: ['admin', 'products', status, q], queryFn: () => api<{ items: AdminProduct[] }>(`/admin/products?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api('/admin/products/reorder', { method: 'POST', body: { ids } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = products.data!.items.map((p) => p.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + d, 0, id!);
    reorder.mutate(ids);
  };
  const canReorder = status !== 'hidden' && !q;
  return (
    <div>
      <PageHeader
        title="Products"
        actions={
          <Link to="/admin/products/new" className="btn-primary px-4 py-2.5 text-sm">
            + New product
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="field max-w-xs" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        <select className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Visibility">
          <option value="active">In shop</option>
          <option value="hidden">Archived</option>
          <option value="all">All</option>
        </select>
      </div>
      {!products.data ? (
        <Loading />
      ) : products.data.items.length === 0 ? (
        <Empty>No products here yet.</Empty>
      ) : (
        <Table
          head={
            <>
              <th className={th}>Product</th>
              <th className={th}>Category</th>
              <th className={`${th} text-right`}>Price</th>
              <th className={`${th} text-right`}>Stock</th>
              {canReorder && <th className={`${th} text-right`}>Order in shop</th>}
            </>
          }
        >
          {products.data.items.map((p, i) => (
            <tr key={p.id} className="hover:bg-raised/40">
              <td className={td}>
                <Link to={`/admin/products/${p.id}`} className="flex items-center gap-3">
                  <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-[#090c10]">{p.image && <img src={p.image.sm} alt="" className="size-full object-cover" />}</span>
                  <span>
                    <span className="block font-semibold hover:text-yellow">{p.name}</span>
                    {!p.isActive && <span className="text-xs text-danger">Archived</span>}
                    {p.isActive && p.isSoldOut && <span className="text-xs text-yellow">Marked sold out</span>}
                  </span>
                </Link>
              </td>
              <td className={`${td} text-muted`}>{p.category.name}</td>
              <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(p.priceCents)}</td>
              <td className={`${td} text-right tabular-nums ${p.stock <= 3 ? 'text-yellow' : ''} ${p.stock === 0 ? 'text-danger' : ''}`}>{p.stock}</td>
              {canReorder && (
                <td className={`${td} text-right`}>
                  <button className="rounded-lg px-2 py-1 text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Move ${p.name} up`}>
                    ↑
                  </button>
                  <button className="rounded-lg px-2 py-1 text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === products.data.items.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Move ${p.name} down`}>
                    ↓
                  </button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
