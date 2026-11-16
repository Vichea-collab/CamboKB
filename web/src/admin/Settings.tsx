import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { FormError } from '../components/AuthCard';
import { api } from '../lib/api';
import { dollars, Loading, PageHeader, toCents, Toggle } from './components/ui';

const MapPicker = lazy(() => import('../components/MapPicker'));

type Settings = {
  storeName: string;
  telegramNotify: boolean;
  delivery: { store: { lat: number; lng: number }; provinceFeeCents: number; phnomPenhStandardFeeCents: number; grabTiers: { maxKm: number; feeCents: number }[]; grabBeyondFeeCents: number };
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<Settings>('/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);
  const save = useMutation({ mutationFn: (body: Settings) => api<Settings>('/admin/settings', { method: 'PUT', body }), onSuccess: (r) => qc.setQueryData(['admin', 'settings'], r) });

  if (!s) return <Loading />;
  const d = s.delivery;
  const setD = (patch: Partial<Settings['delivery']>) => setS({ ...s, delivery: { ...d, ...patch } });
  const fee = (cents: number, onChange: (c: number) => void, label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field tabular-nums" inputMode="decimal" defaultValue={dollars(cents)} onChange={(e) => onChange(toCents(e.target.value))} />
    </label>
  );
  return (
    <form
      className="max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(s);
      }}
    >
      <PageHeader title="Settings" actions={<button className="btn-primary px-4 py-2.5 text-sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</button>} />
      <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
      {save.isSuccess && <p className="text-sm font-semibold text-green">Saved. New rates apply to the next checkout.</p>}
      <section className="panel space-y-4 p-5">
        <label className="block">
          <span className="label">Store name</span>
          <input className="field" value={s.storeName} onChange={(e) => setS({ ...s, storeName: e.target.value })} maxLength={60} />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-semibold">New-order alerts on Telegram</span>
            <span className="text-xs text-muted">Sent to the chat set in TELEGRAM_ADMIN_CHAT_ID</span>
          </span>
          <Toggle checked={s.telegramNotify} onChange={(v) => setS({ ...s, telegramNotify: v })} label="Telegram alerts" />
        </div>
      </section>
      <section className="panel space-y-4 p-5">
        <h2 className="font-display text-lg font-bold">Delivery fees</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {fee(d.phnomPenhStandardFeeCents, (c) => setD({ phnomPenhStandardFeeCents: c }), 'Phnom Penh, standard ($)')}
          {fee(d.provinceFeeCents, (c) => setD({ provinceFeeCents: c }), 'Province ($)')}
          {fee(d.grabBeyondFeeCents, (c) => setD({ grabBeyondFeeCents: c }), 'Grab, beyond last tier ($)')}
        </div>
        <div>
          <p className="label">Grab by distance from the store</p>
          <div className="space-y-2">
            {d.grabTiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm text-muted">Up to</span>
                <input className="field w-20 tabular-nums" inputMode="decimal" value={tier.maxKm} onChange={(e) => setD({ grabTiers: d.grabTiers.map((x, j) => (j === i ? { ...x, maxKm: Number(e.target.value) || 0 } : x)) })} aria-label={`Tier ${i + 1} km`} />
                <span className="text-sm text-muted">km →</span>
                <input className="field w-24 tabular-nums" inputMode="decimal" defaultValue={dollars(tier.feeCents)} onChange={(e) => setD({ grabTiers: d.grabTiers.map((x, j) => (j === i ? { ...x, feeCents: toCents(e.target.value) } : x)) })} aria-label={`Tier ${i + 1} fee`} />
                <span className="text-sm text-muted">$</span>
                <button type="button" className="ml-auto rounded-lg px-2 py-1 text-danger hover:bg-danger/10" onClick={() => setD({ grabTiers: d.grabTiers.filter((_, j) => j !== i) })} aria-label={`Remove tier ${i + 1}`}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => setD({ grabTiers: [...d.grabTiers, { maxKm: (d.grabTiers.at(-1)?.maxKm ?? 0) + 2, feeCents: d.grabBeyondFeeCents }] })}>
              + Add tier
            </button>
          </div>
        </div>
        <div>
          <p className="label">Store location (distances are measured from here)</p>
          <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-raised/50" />}>
            <MapPicker value={d.store} fallback={d.store} onChange={(p) => setD({ store: p })} />
          </Suspense>
        </div>
      </section>
    </form>
  );
}
