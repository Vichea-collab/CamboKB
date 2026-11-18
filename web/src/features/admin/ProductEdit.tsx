import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useUi } from '../../shared/lib/ui-store';
import { FormError } from '../../shared/ui/FormCard';
import { api } from '../../shared/lib/api';
import { useCategories } from '../catalog/api';
import { dollars, Loading, PageHeader, toCents, Toggle } from './components/ui';
import { ImageUploader } from './components/ImageUploader';
import { SaveBar, useUnsavedGuard } from './components/SaveBar';
import { SpecEditor } from './components/SpecEditor';
import type { AdminProduct } from './types';

type Form = { name: string; categoryId: string; specsLine: string; description: string; price: string; compareAt: string; stock: string; isSoldOut: boolean; isActive: boolean; specs: { label: string; value: string }[] };
const blank: Form = { name: '', categoryId: '', specsLine: '', description: '', price: '', compareAt: '', stock: '0', isSoldOut: false, isActive: true, specs: [] };

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const categories = useCategories();
  const product = useQuery({ queryKey: ['admin', 'product', id], queryFn: () => api<AdminProduct>(`/admin/products/${id}`), enabled: !isNew });
  const [form, setForm] = useState<Form>(blank);
  const showToast = useUi((s) => s.showToast);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: v }));
  };

  useEffect(() => {
    const p = product.data;
    if (!p) return;
    setForm({
      name: p.name,
      categoryId: p.categoryId,
      specsLine: p.specsLine,
      description: p.description,
      price: dollars(p.priceCents),
      compareAt: p.compareAtCents ? dollars(p.compareAtCents) : '',
      stock: String(p.stock),
      isSoldOut: p.isSoldOut,
      isActive: p.isActive,
      specs: p.specs,
    });
  }, [product.data]);
  useEffect(() => {
    if (isNew && !form.categoryId && categories.data?.[0]) set('categoryId', categories.data[0].id);
  }, [isNew, form.categoryId, categories.data]);

  const refresh = (p: AdminProduct) => {
    qc.setQueryData(['admin', 'product', p.id], p);
    qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        categoryId: form.categoryId,
        specsLine: form.specsLine.trim(),
        description: form.description.trim(),
        priceCents: toCents(form.price),
        compareAtCents: form.compareAt ? toCents(form.compareAt) : null,
        stock: Math.max(0, Math.floor(Number(form.stock || 0))),
        isSoldOut: form.isSoldOut,
        isActive: form.isActive,
        specs: form.specs.filter((s) => s.label.trim()).map((s) => ({ label: s.label.trim(), value: s.value.trim() })),
      };
      return isNew ? api<AdminProduct>('/admin/products', { method: 'POST', body }) : api<AdminProduct>(`/admin/products/${id}`, { method: 'PATCH', body });
    },
    onSuccess: (p) => {
      refresh(p);
      setDirty(false);
      showToast(isNew ? 'Product created' : 'Changes saved');
      if (isNew) navigate(`/admin/products/${p.id}`, { replace: true });
    },
  });

  const upload = async (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    refresh(await api<AdminProduct>(`/admin/products/${id}/images`, { method: 'POST', body: fd }));
  };
  const reorderImages = async (ids: string[]) => refresh(await api<AdminProduct>(`/admin/products/${id}/images/order`, { method: 'PATCH', body: { ids } }));
  const deleteImage = async (imageId: string) => {
    if (!confirm('Delete this photo?')) return;
    refresh(await api<AdminProduct>(`/admin/products/${id}/images/${imageId}`, { method: 'DELETE' }));
  };

  if (!isNew && !product.data) return <Loading />;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        title={isNew ? 'New product' : form.name || 'Product'}
        back={
          <Link to="/admin/products" className="-ml-1 mb-1 inline-flex min-h-10 items-center rounded-lg px-1 text-sm font-semibold text-muted hover:text-ink">
            ← Products
          </Link>
        }
        actions={
          <>
            {!isNew && product.data?.isActive && (
              <a href={`/products/${product.data.slug}`} target="_blank" rel="noopener" className="btn-ghost px-3 py-2 text-sm">
                View in shop
              </a>
            )}
          </>
        }
      />
      <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section className="panel space-y-4 p-5">
            <div>
              <label className="label" htmlFor="p-name">Name</label>
              <input id="p-name" className="field" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required />
            </div>
            <div>
              <label className="label" htmlFor="p-specs">Short specs (shown on the card)</label>
              <input id="p-specs" className="field" value={form.specsLine} onChange={(e) => set('specsLine', e.target.value)} placeholder="75% Layout • Hot-Swap • Multi-Mode" maxLength={200} />
            </div>
            <div>
              <label className="label" htmlFor="p-desc">Description</label>
              <textarea id="p-desc" rows={4} className="field" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
            </div>
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 font-display text-lg font-bold">Photos</h2>
            {isNew ? <p className="text-sm text-muted">Create the product first, then add photos.</p> : <ImageUploader images={product.data!.images} onUpload={upload} onReorder={reorderImages} onDelete={deleteImage} />}
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 font-display text-lg font-bold">Specifications</h2>
            <SpecEditor value={form.specs} onChange={(specs) => set('specs', specs)} />
          </section>
        </div>
        <aside className="space-y-5">
          <section className="panel space-y-4 p-5">
            <div>
              <label className="label" htmlFor="p-cat">Category</label>
              <select id="p-cat" className="field" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="p-price">Price ($)</label>
                <input id="p-price" className="field tabular-nums" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value.replace(/[^\d.]/g, ''))} required />
              </div>
              <div>
                <label className="label" htmlFor="p-compare">Was ($)</label>
                <input id="p-compare" className="field tabular-nums" inputMode="decimal" value={form.compareAt} onChange={(e) => set('compareAt', e.target.value.replace(/[^\d.]/g, ''))} placeholder="optional" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="p-stock">Stock</label>
              <input id="p-stock" className="field tabular-nums" inputMode="numeric" value={form.stock} onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))} />
            </div>
          </section>
          <section className="panel space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-semibold">Show in shop</span>
                <span className="text-xs text-muted">Off = archived (kept for past orders)</span>
              </span>
              <Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Show in shop" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-semibold">Sold out</span>
                <span className="text-xs text-muted">Also automatic when stock is 0</span>
              </span>
              <Toggle checked={form.isSoldOut} onChange={(v) => set('isSoldOut', v)} label="Sold out" />
            </div>
          </section>
        </aside>
      </div>
      <SaveBar dirty={dirty || isNew} saving={save.isPending} label={isNew ? 'Create product' : 'Save changes'} disabled={!form.name.trim() || !form.price} />
    </form>
  );
}
