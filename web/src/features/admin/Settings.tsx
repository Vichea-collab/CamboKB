import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { FormError } from '../../shared/ui/FormCard';
import { api } from '../../shared/lib/api';
import { useUi } from '../../shared/lib/ui-store';
import { SaveBar, useUnsavedGuard } from './components/SaveBar';
import { TelegramStatus } from './components/TelegramStatus';
import { Plus, Trash2 } from 'lucide-react';
import { Section } from '../../shared/ui/Page';
import { dollars, Loading, PageHeader, toCents, Toggle } from './components/ui';

const MapPicker = lazy(() => import('../../shared/ui/MapPicker'));

type Info = {
  phone: string;
  telegram: string;
  facebook: string;
  address: string;
  hours: string;
  warranty: string;
};
type Settings = {
  storeName: string;
  telegramNotify: boolean;
  info: Info;
  delivery: {
    store: { lat: number; lng: number };
    provinceFeeCents: number;
    phnomPenhStandardFeeCents: number;
    grabTiers: { maxKm: number; feeCents: number }[];
    grabBeyondFeeCents: number;
  };
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api<Settings>('/admin/settings'),
  });
  const [s, setS] = useState<Settings | null>(null);
  const showToast = useUi((st) => st.showToast);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);
  // Every edit goes through setS below; wrap it so we know when there is something to save.
  const edit = (next: Settings) => {
    setDirty(true);
    setS(next);
  };
  const save = useMutation({
    mutationFn: (body: Settings) => api<Settings>('/admin/settings', { method: 'PUT', body }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'settings'], r);
      setDirty(false);
      showToast('Settings saved. New rates apply to the next checkout.');
    },
  });

  if (!s) return <Loading />;
  const d = s.delivery;
  const setD = (patch: Partial<Settings['delivery']>) =>
    edit({ ...s, delivery: { ...d, ...patch } });
  const setInfo = (patch: Partial<Info>) => edit({ ...s, info: { ...s.info, ...patch } });
  const fee = (cents: number, onChange: (c: number) => void, label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="field tabular-nums"
        inputMode="decimal"
        defaultValue={dollars(cents)}
        onChange={(e) => onChange(toCents(e.target.value))}
      />
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
      <PageHeader title="Settings" />
      <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
      <Section title="Store">
        <div className="space-y-4">
          <label className="block">
            <span className="label">Store name</span>
            <input
              className="field"
              value={s.storeName}
              onChange={(e) => edit({ ...s, storeName: e.target.value })}
              maxLength={60}
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-semibold">New-order alerts on Telegram</span>
              <span className="text-xs text-muted">Sent to your shop's Telegram alert chat</span>
            </span>
            <Toggle
              checked={s.telegramNotify}
              onChange={(v) => edit({ ...s, telegramNotify: v })}
              label="Telegram alerts"
            />
          </div>
          <TelegramStatus />
        </div>
      </Section>
      <Section
        title="Contact and policies"
        description="Shown in the shop footer and on the Contact and Warranty pages. Leave a field empty to hide it."
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoField
              label="Phone"
              value={s.info.phone}
              onChange={(v) => setInfo({ phone: v })}
              placeholder="087 522 210"
            />
            <InfoField
              label="Telegram username"
              value={s.info.telegram}
              onChange={(v) => setInfo({ telegram: v })}
              placeholder="Cambo_KB_Bot"
            />
            <InfoField
              label="Facebook page link"
              value={s.info.facebook}
              onChange={(v) => setInfo({ facebook: v })}
              placeholder="https://facebook.com/…"
            />
            <InfoField
              label="Opening hours"
              value={s.info.hours}
              onChange={(v) => setInfo({ hours: v })}
              placeholder="Daily 8:00–20:00"
            />
          </div>
          <label className="block">
            <span className="label">Address</span>
            <textarea
              className="field resize-none"
              rows={2}
              value={s.info.address}
              onChange={(e) => setInfo({ address: e.target.value })}
              maxLength={300}
            />
          </label>
          <label className="block">
            <span className="label">Warranty and returns</span>
            <textarea
              className="field"
              rows={6}
              value={s.info.warranty}
              onChange={(e) => setInfo({ warranty: e.target.value })}
              maxLength={4000}
              placeholder="Leave empty to show a short general message. Separate paragraphs with a blank line."
            />
          </label>
        </div>
      </Section>
      <Section title="Delivery fees" description="Customers see these at checkout before they pay.">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {fee(
              d.phnomPenhStandardFeeCents,
              (c) => setD({ phnomPenhStandardFeeCents: c }),
              'Phnom Penh, standard ($)',
            )}
            {fee(d.provinceFeeCents, (c) => setD({ provinceFeeCents: c }), 'Province ($)')}
            {fee(
              d.grabBeyondFeeCents,
              (c) => setD({ grabBeyondFeeCents: c }),
              'Grab, beyond last tier ($)',
            )}
          </div>
          <div>
            <p className="label">Grab by distance from the store</p>
            <div className="space-y-2">
              {d.grabTiers.map((tier, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">Up to (km)</span>
                    <input
                      className="field tabular-nums"
                      inputMode="decimal"
                      value={tier.maxKm}
                      onChange={(e) =>
                        setD({
                          grabTiers: d.grabTiers.map((x, j) =>
                            j === i ? { ...x, maxKm: Number(e.target.value) || 0 } : x,
                          ),
                        })
                      }
                      aria-label={`Tier ${i + 1} km`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">Fee ($)</span>
                    <input
                      className="field tabular-nums"
                      inputMode="decimal"
                      defaultValue={dollars(tier.feeCents)}
                      onChange={(e) =>
                        setD({
                          grabTiers: d.grabTiers.map((x, j) =>
                            j === i ? { ...x, feeCents: toCents(e.target.value) } : x,
                          ),
                        })
                      }
                      aria-label={`Tier ${i + 1} fee`}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn-danger size-11"
                    onClick={() => setD({ grabTiers: d.grabTiers.filter((_, j) => j !== i) })}
                    aria-label={`Remove tier ${i + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  setD({
                    grabTiers: [
                      ...d.grabTiers,
                      {
                        maxKm: (d.grabTiers.at(-1)?.maxKm ?? 0) + 2,
                        feeCents: d.grabBeyondFeeCents,
                      },
                    ],
                  })
                }
              >
                <Plus className="size-4" aria-hidden /> Add tier
              </button>
            </div>
          </div>
          <div>
            <p className="label">Store location (distances are measured from here)</p>
            <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-raised/50" />}>
              <MapPicker value={d.store} fallback={d.store} onChange={(p) => setD({ store: p })} />
            </Suspense>
          </div>
        </div>
      </Section>
      <SaveBar dirty={dirty} saving={save.isPending} label="Save settings" />
    </form>
  );
}

function InfoField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
      />
    </label>
  );
}
