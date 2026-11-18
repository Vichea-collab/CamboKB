import { formatUsd } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/lib/api';
import { useUi } from '../../shared/lib/ui-store';
import { Empty, Loading, PageHeader, td, th } from './components/ui';
import type { AdminProduct } from './types';

type Status = 'all' | 'active' | 'hidden';
const SEGMENTS: [Status, string][] = [
  ['active', 'In shop'],
  ['hidden', 'Archived'],
  ['all', 'All'],
];

export default function Products() {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const products = useQuery({ queryKey: ['admin', 'products', status, q], queryFn: () => api<{ items: AdminProduct[] }>(`/admin/products?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };
  const reorder = useMutation({ mutationFn: (ids: string[]) => api('/admin/products/reorder', { method: 'POST', body: { ids } }), onSettled: refresh });
  const setStock = useMutation({
    mutationFn: ({ id, stock }: { id: string; stock: number }) => api(`/admin/products/${id}`, { method: 'PATCH', body: { stock } }),
    onSuccess: () => {
      showToast('Stock updated');
      refresh();
    },
    onError: (err) => {
      showToast((err as Error).message);
      refresh();
    },
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = products.data!.items.map((p) => p.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + d, 0, id!);
    reorder.mutate(ids);
  };
  const canReorder = status !== 'hidden' && !q;
  const items = products.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Products"
        actions={
          <Link to="/admin/products/new" className="btn-primary min-h-11 gap-1.5 px-4 py-2.5 text-sm">
            <Plus className="size-4" strokeWidth={3} aria-hidden /> New product
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field pl-10" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        <div className="flex rounded-xl bg-surface p-1 ring-1 ring-line" role="group" aria-label="Visibility">
          {SEGMENTS.map(([key, label]) => (
            <button key={key} aria-pressed={status === key} onClick={() => setStatus(key)} className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${status === key ? 'bg-raised text-ink ring-1 ring-line-strong' : 'text-muted hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {!products.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>No products here yet.</Empty>
      ) : (
        <>
          {/* Phones: cards with the stock right there. */}
          <ul className="space-y-2.5 md:hidden">
            {items.map((p) => (
              <li key={p.id} className="flex gap-3 rounded-2xl bg-surface p-3 ring-1 ring-line">
                <Link to={`/admin/products/${p.id}`} className="size-16 shrink-0 overflow-hidden rounded-xl bg-[#0b0e12]">
                  {p.image && <img src={p.image.sm} alt="" className="size-full object-cover" />}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/products/${p.id}`} className="line-clamp-2 text-sm font-bold leading-snug">
                    {p.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {p.category.name} · {formatUsd(p.priceCents)}
                    {!p.isActive && <span className="ml-1.5 font-semibold text-danger">Archived</span>}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                    Stock <StockInput product={p} onSave={(stock) => setStock.mutate({ id: p.id, stock })} />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-2xl bg-surface ring-1 ring-line md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>Category</th>
                  <th className={`${th} text-right`}>Price</th>
                  <th className={`${th} text-right`}>Stock</th>
                  {canReorder && <th className={`${th} text-right`}>Order in shop</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((p, i) => (
                  <tr key={p.id} className="transition-colors hover:bg-raised/40">
                    <td className={td}>
                      <Link to={`/admin/products/${p.id}`} className="flex items-center gap-3">
                        <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-[#0b0e12]">{p.image && <img src={p.image.sm} alt="" className="size-full object-cover" />}</span>
                        <span>
                          <span className="block font-semibold hover:text-yellow">{p.name}</span>
                          {!p.isActive && <span className="text-xs text-danger">Archived</span>}
                          {p.isActive && p.isSoldOut && <span className="text-xs text-yellow">Marked sold out</span>}
                        </span>
                      </Link>
                    </td>
                    <td className={`${td} text-muted`}>{p.category.name}</td>
                    <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(p.priceCents)}</td>
                    <td className={`${td} text-right`}>
                      <StockInput product={p} onSave={(stock) => setStock.mutate({ id: p.id, stock })} />
                    </td>
                    {canReorder && (
                      <td className={`${td} text-right`}>
                        <button className="inline-grid size-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Move ${p.name} up`}>
                          <ArrowUp className="size-4" aria-hidden />
                        </button>
                        <button className="inline-grid size-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Move ${p.name} down`}>
                          <ArrowDown className="size-4" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Type a number and tab away (or press Enter): it saves. Low and zero stock are colour-coded. */
function StockInput({ product, onSave }: { product: AdminProduct; onSave: (stock: number) => void }) {
  const [value, setValue] = useState(String(product.stock));
  const [seen, setSeen] = useState(product.stock);
  // Follow the server when the product changes elsewhere.
  if (seen !== product.stock) {
    setSeen(product.stock);
    setValue(String(product.stock));
  }
  const commit = () => {
    const n = Math.max(0, Math.floor(Number(value)));
    if (!Number.isFinite(n) || value.trim() === '') return setValue(String(product.stock));
    if (n !== product.stock) onSave(n);
    setValue(String(n));
  };
  const tone = product.stock === 0 ? 'text-danger ring-danger/40' : product.stock <= 3 ? 'text-yellow ring-yellow/40' : 'text-ink ring-line-strong';
  return (
    <input
      inputMode="numeric"
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label={`Stock for ${product.name}`}
      className={`h-9 w-16 rounded-lg bg-bg px-2 text-center text-sm font-bold tabular-nums ring-1 transition focus:outline-none focus:ring-2 focus:ring-yellow ${tone}`}
    />
  );
}
