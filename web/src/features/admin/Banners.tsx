import { ArrowDown, ArrowUp, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { FormError } from '../../shared/ui/FormCard';
import { api } from '../../shared/lib/api';
import { EmptyState, Section } from '../../shared/ui/Page';
import { Loading, PageHeader, Toggle } from './components/ui';
import type { AdminBanner } from './types';

export default function Banners() {
  const qc = useQueryClient();
  const banners = useQuery({
    queryKey: ['admin', 'banners'],
    queryFn: () => api<{ items: AdminBanner[] }>('/admin/banners').then((r) => r.items),
  });
  const file = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const done = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'banners'] });
    qc.invalidateQueries({ queryKey: ['catalog', 'banners'] });
  };
  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      if (link.trim()) fd.append('linkUrl', link.trim());
      return api('/admin/banners', { method: 'POST', body: fd });
    },
    onSuccess: () => (setLink(''), done()),
    onSettled: () => file.current && (file.current.value = ''),
  });
  const patch = useMutation({
    mutationFn: (b: { id: string; isActive?: boolean; linkUrl?: string | null }) =>
      api(`/admin/banners/${b.id}`, {
        method: 'PATCH',
        body: { isActive: b.isActive, linkUrl: b.linkUrl },
      }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/banners/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api('/admin/banners/reorder', { method: 'POST', body: { ids } }),
    onSettled: done,
  });

  if (!banners.data) return <Loading />;
  const move = (i: number, d: -1 | 1) => {
    const ids = banners.data.map((b) => b.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + d, 0, id!);
    reorder.mutate(ids);
  };
  const error = upload.error ?? patch.error ?? remove.error;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Banners"
        description="The slides at the top of the shop's home page, in this order."
      />
      <Section
        title="Add a banner"
        description="Wide images work best (about 2:1). JPEG, PNG or WebP up to 8 MB."
      >
        <div className="space-y-3">
          <FormError>{error ? (error as Error).message : undefined}</FormError>
          <input
            className="field"
            placeholder="Link when tapped (optional), e.g. https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            aria-label="Banner link"
          />
          <button
            className="btn-primary"
            onClick={() => file.current?.click()}
            disabled={upload.isPending}
          >
            <Upload className="size-4" aria-hidden />
            {upload.isPending ? 'Uploading…' : 'Choose image'}
          </button>
          <input
            ref={file}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
          />
        </div>
      </Section>
      {banners.data.length === 0 ? (
        <EmptyState icon={ImageIcon} title="No banners yet">
          The shop hides the carousel until you add one.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {banners.data.map((b, i) => (
            <li key={b.id} className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <img
                src={b.image.md}
                alt=""
                className={`aspect-[2/1] w-full rounded-xl object-cover sm:w-56 ${b.isActive ? '' : 'opacity-40'}`}
              />
              <div className="flex flex-1 flex-col gap-2">
                <input
                  className="field"
                  defaultValue={b.linkUrl ?? ''}
                  placeholder="No link"
                  aria-label="Banner link"
                  onBlur={(e) =>
                    (e.target.value.trim() || null) !== b.linkUrl &&
                    patch.mutate({ id: b.id, linkUrl: e.target.value.trim() || null })
                  }
                />
                <div className="flex items-center gap-3">
                  <Toggle
                    checked={b.isActive}
                    onChange={(v) => patch.mutate({ id: b.id, isActive: v })}
                    label="Show banner"
                  />
                  <span className="text-sm text-muted">{b.isActive ? 'Showing' : 'Hidden'}</span>
                  <span className="flex-1" />
                  <button
                    className="icon-btn"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move banner up"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === banners.data.length - 1}
                    aria-label="Move banner down"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                  <button
                    className="icon-btn-danger"
                    onClick={() => confirm('Delete this banner?') && remove.mutate(b.id)}
                    aria-label="Delete banner"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
