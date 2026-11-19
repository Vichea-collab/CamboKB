import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '../../shared/ui/FormCard';
import { api } from '../../shared/lib/api';
import { Loading, PageHeader } from './components/ui';

type Cat = { id: string; name: string; slug: string; sortOrder: number; productCount: number };

export default function Categories() {
  const qc = useQueryClient();
  const cats = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api<{ items: Cat[] }>('/admin/categories').then((r) => r.items),
  });
  const [name, setName] = useState('');
  const done = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
    qc.invalidateQueries({ queryKey: ['catalog', 'categories'] });
  };
  const create = useMutation({
    mutationFn: () => api('/admin/categories', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: () => (setName(''), done()),
  });
  const rename = useMutation({
    mutationFn: (c: { id: string; name: string }) =>
      api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { name: c.name } }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/categories/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api('/admin/categories/reorder', { method: 'POST', body: { ids } }),
    onSettled: done,
  });

  if (!cats.data) return <Loading />;
  const move = (i: number, d: -1 | 1) => {
    const ids = cats.data.map((c) => c.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + d, 0, id!);
    reorder.mutate(ids);
  };
  const error = create.error ?? rename.error ?? remove.error;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Categories"
        description="The filters shoppers see on the home page, in this order. Rename a category by editing its name."
      />
      <FormError>{error ? (error as Error).message : undefined}</FormError>
      <ul className="panel divide-y divide-line">
        {cats.data.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 p-3">
            <input
              className="field"
              defaultValue={c.name}
              aria-label={`Name of ${c.name}`}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value.trim() !== c.name &&
                rename.mutate({ id: c.id, name: e.target.value.trim() })
              }
            />
            <span className="hidden w-24 shrink-0 text-right text-sm text-muted tabular-nums sm:block">
              {c.productCount} products
            </span>
            <button
              className="icon-btn"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${c.name} up`}
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
            <button
              className="icon-btn"
              onClick={() => move(i, 1)}
              disabled={i === cats.data.length - 1}
              aria-label={`Move ${c.name} down`}
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
            <button
              className="icon-btn-danger"
              disabled={c.productCount > 0}
              title={c.productCount > 0 ? 'Move or archive its products first' : undefined}
              onClick={() => confirm(`Delete “${c.name}”?`) && remove.mutate(c.id)}
              aria-label={`Delete ${c.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="panel flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          className="field"
          placeholder="New category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New category name"
        />
        <button className="btn-primary shrink-0" disabled={!name.trim() || create.isPending}>
          Add category
        </button>
      </form>
    </div>
  );
}
