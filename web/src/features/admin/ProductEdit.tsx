import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ExternalLink, RotateCcw, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Section } from '../../shared/ui/Page';
import { useUi } from '../../shared/lib/ui-store';
import { FormError } from '../../shared/ui/FormCard';
import { api } from '../../shared/lib/api';
import { useCategories } from '../catalog/api';
import { dollars, Loading, PageHeader, toCents, Toggle } from './components/ui';
import { ImageUploader } from './components/ImageUploader';
import { SaveBar, useUnsavedGuard } from './components/SaveBar';
import { SpecEditor } from './components/SpecEditor';
import type { AdminProduct } from './types';
import { Select } from '../../shared/ui/Select';

type Form = {
  name: string;
  categoryId: string;
  specsLine: string;
  description: string;
  price: string;
  compareAt: string;
  stock: string;
  isSoldOut: boolean;
  isActive: boolean;
  specs: { label: string; value: string }[];
};
const blank: Form = {
  name: '',
  categoryId: '',
  specsLine: '',
  description: '',
  price: '',
  compareAt: '',
  stock: '0',
  isSoldOut: false,
  isActive: true,
  specs: [],
};

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const categories = useCategories();
  const product = useQuery({
    queryKey: ['admin', 'product', id],
    queryFn: () => api<AdminProduct>(`/admin/products/${id}`),
    enabled: !isNew,
  });
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
        specs: form.specs
          .filter((s) => s.label.trim())
          .map((s) => ({ label: s.label.trim(), value: s.value.trim() })),
      };
      return isNew
        ? api<AdminProduct>('/admin/products', { method: 'POST', body })
        : api<AdminProduct>(`/admin/products/${id}`, { method: 'PATCH', body });
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
  const reorderImages = async (ids: string[]) =>
    refresh(
      await api<AdminProduct>(`/admin/products/${id}/images/order`, {
        method: 'PATCH',
        body: { ids },
      }),
    );
  const deleteImage = async (imageId: string) => {
    if (!confirm('Delete this photo?')) return;
    refresh(
      await api<AdminProduct>(`/admin/products/${id}/images/${imageId}`, { method: 'DELETE' }),
    );
  };

  const archive = useMutation({
    mutationFn: () => api(`/admin/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      showToast('Product archived and hidden from shop');
      navigate('/admin/products');
    },
    onError: (err) => showToast((err as Error).message),
  });

  const restore = useMutation({
    mutationFn: () => api<AdminProduct>(`/admin/products/${id}`, { method: 'PATCH', body: { isActive: true } }),
    onSuccess: (p) => {
      refresh(p);
      set('isActive', true);
      showToast('Product restored to shop');
    },
    onError: (err) => showToast((err as Error).message),
  });

  const removePermanent = useMutation({
    mutationFn: () => api(`/admin/products/${id}?permanent=1`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      showToast('Product deleted permanently');
      navigate('/admin/products');
    },
    onError: (err) => showToast((err as Error).message),
  });

  if (!isNew && !product.data) return <Loading shape="form" />;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        title={isNew ? 'New product' : form.name || 'Product'}
        back={{ to: '/admin/products', label: 'Products' }}
        actions={
          !isNew &&
          product.data?.isActive && (
            <a
              href={`/products/${product.data.slug}`}
              target="_blank"
              rel="noopener"
              className="btn-ghost btn-sm"
            >
              <ExternalLink className="size-4" aria-hidden /> View in shop
            </a>
          )
        }
      />
      <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Section title="Details">
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="p-name">
                  Name
                </label>
                <input
                  id="p-name"
                  className="field"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="p-specs">
                  Short specs (shown on the card)
                </label>
                <input
                  id="p-specs"
                  className="field"
                  value={form.specsLine}
                  onChange={(e) => set('specsLine', e.target.value)}
                  placeholder="75% Layout • Hot-Swap • Multi-Mode"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="label" htmlFor="p-desc">
                  Description
                </label>
                <textarea
                  id="p-desc"
                  rows={4}
                  className="field"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  maxLength={5000}
                />
              </div>
            </div>
          </Section>
          <Section title="Photos">
            {isNew ? (
              <p className="text-sm text-muted">Create the product first, then add photos.</p>
            ) : (
              <ImageUploader
                images={product.data!.images}
                onUpload={upload}
                onReorder={reorderImages}
                onDelete={deleteImage}
              />
            )}
          </Section>
          <Section title="Specifications" description="Shown as a table on the product page.">
            <SpecEditor value={form.specs} onChange={(specs) => set('specs', specs)} />
          </Section>
        </div>
        <aside className="space-y-5">
          <Section title="Price and stock">
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="p-cat">
                  Category
                </label>
                <Select
                  id="p-cat"
                  title="Category"
                  value={form.categoryId}
                  onChange={(v) => set('categoryId', v)}
                  options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="p-price">
                    Price ($)
                  </label>
                  <input
                    id="p-price"
                    className="field tabular-nums"
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) => set('price', e.target.value.replace(/[^\d.]/g, ''))}
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="p-compare">
                    Was ($)
                  </label>
                  <input
                    id="p-compare"
                    className="field tabular-nums"
                    inputMode="decimal"
                    value={form.compareAt}
                    onChange={(e) => set('compareAt', e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="optional"
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="p-stock">
                  Stock
                </label>
                <input
                  id="p-stock"
                  className="field tabular-nums"
                  inputMode="numeric"
                  value={form.stock}
                  onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
          </Section>
          <Section title="Visibility">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-semibold">Show in shop</span>
                  <span className="text-xs text-muted">Off = archived (kept for past orders)</span>
                </span>
                <Toggle
                  checked={form.isActive}
                  onChange={(v) => set('isActive', v)}
                  label="Show in shop"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-semibold">Sold out</span>
                  <span className="text-xs text-muted">Also automatic when stock is 0</span>
                </span>
                <Toggle
                  checked={form.isSoldOut}
                  onChange={(v) => set('isSoldOut', v)}
                  label="Sold out"
                />
              </div>
            </div>
          </Section>
          {!isNew && product.data && (
            <Section title="Danger zone">
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  {product.data.orderCount > 0
                    ? `This product appears in ${product.data.orderCount} order(s). It cannot be permanently deleted to preserve historical receipts, but you can archive it to hide it from the shop.`
                    : 'This product has no order history. You can archive it to hide it, or delete it permanently.'}
                </p>
                <div className="flex flex-col gap-2">
                  {product.data.isActive ? (
                    <button
                      type="button"
                      className="btn-danger btn-sm w-full justify-center"
                      disabled={archive.isPending}
                      onClick={() =>
                        confirm(`Archive "${product.data!.name}" and remove from shop?`) &&
                        archive.mutate()
                      }
                    >
                      <Archive className="size-4" aria-hidden />
                      {archive.isPending ? 'Archiving…' : 'Archive product'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary btn-sm w-full justify-center"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate()}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      {restore.isPending ? 'Restoring…' : 'Restore to shop'}
                    </button>
                  )}
                  {product.data.orderCount === 0 && (
                    <button
                      type="button"
                      className="btn-danger btn-sm w-full justify-center"
                      disabled={removePermanent.isPending}
                      onClick={() =>
                        confirm(
                          `Permanently delete "${product.data!.name}"? This cannot be undone.`,
                        ) && removePermanent.mutate()
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {removePermanent.isPending ? 'Deleting…' : 'Delete permanently'}
                    </button>
                  )}
                </div>
              </div>
            </Section>
          )}
        </aside>
      </div>
      <SaveBar
        dirty={dirty || isNew}
        saving={save.isPending}
        label={isNew ? 'Create product' : 'Save changes'}
        disabled={!form.name.trim() || !form.price}
        message={
          isNew && !dirty
            ? 'Add a name and price to create the product'
            : isNew && (!form.name.trim() || !form.price)
              ? 'Name and price are needed to create the product'
              : undefined
        }
      />
    </form>
  );
}
