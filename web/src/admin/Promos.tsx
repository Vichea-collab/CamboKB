import { formatUsd } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '../components/AuthCard';
import { api } from '../lib/api';
import { dollars, Empty, Loading, PageHeader, Table, td, th, toCents, Toggle } from './components/ui';
import type { Promo } from './types';

type Draft = { code: string; type: 'FIXED' | 'PERCENT'; value: string; min: string; startsAt: string; endsAt: string; maxUses: string; maxUsesPerUser: string; isActive: boolean };
const empty: Draft = { code: '', type: 'FIXED', value: '', min: '', startsAt: '', endsAt: '', maxUses: '', maxUsesPerUser: '', isActive: true };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export default function Promos() {
  const qc = useQueryClient();
  const promos = useQuery({ queryKey: ['admin', 'promos'], queryFn: () => api<{ items: Promo[] }>('/admin/promos').then((r) => r.items) });
  const [editing, setEditing] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(empty);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const toBody = (x: Draft) => ({
    code: x.code.trim(),
    type: x.type,
    value: x.type === 'FIXED' ? toCents(x.value) : Math.round(Number(x.value)),
    minSubtotalCents: toCents(x.min),
    startsAt: x.startsAt ? new Date(`${x.startsAt}T00:00:00+07:00`).toISOString() : null,
    endsAt: x.endsAt ? new Date(`${x.endsAt}T23:59:59+07:00`).toISOString() : null,
    maxUses: x.maxUses ? Number(x.maxUses) : null,
    maxUsesPerUser: x.maxUsesPerUser ? Number(x.maxUsesPerUser) : null,
    isActive: x.isActive,
  });
  const save = useMutation({
    mutationFn: () => (editing ? api(`/admin/promos/${editing}`, { method: 'PATCH', body: toBody(d) }) : api('/admin/promos', { method: 'POST', body: toBody(d) })),
    onSuccess: () => {
      setD(empty);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin', 'promos'] });
    },
  });
  const toggle = useMutation({
    mutationFn: (p: Promo) => api(`/admin/promos/${p.id}`, { method: 'PATCH', body: { ...toBody(fromPromo(p)), isActive: !p.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'promos'] }),
  });
  const fromPromo = (p: Promo): Draft => ({
    code: p.code,
    type: p.type,
    value: p.type === 'FIXED' ? dollars(p.value) : String(p.value),
    min: p.minSubtotalCents ? dollars(p.minSubtotalCents) : '',
    startsAt: day(p.startsAt),
    endsAt: day(p.endsAt),
    maxUses: p.maxUses ? String(p.maxUses) : '',
    maxUsesPerUser: p.maxUsesPerUser ? String(p.maxUsesPerUser) : '',
    isActive: p.isActive,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <div>
      <PageHeader title="Promo codes" />
      <form onSubmit={submit} className="panel mb-5 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <h2 className="font-display text-lg font-bold sm:col-span-2 lg:col-span-4">{editing ? `Edit ${d.code}` : 'New promo code'}</h2>
        <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
        <L label="Code"><input className="field uppercase" value={d.code} onChange={(e) => set('code', e.target.value)} placeholder="NEWYEAR" required /></L>
        <L label="Type">
          <select className="field" value={d.type} onChange={(e) => set('type', e.target.value as Draft['type'])}>
            <option value="FIXED">Amount off ($)</option>
            <option value="PERCENT">Percent off (%)</option>
          </select>
        </L>
        <L label={d.type === 'FIXED' ? 'Amount ($)' : 'Percent (1–100)'}><input className="field" inputMode="decimal" value={d.value} onChange={(e) => set('value', e.target.value)} required /></L>
        <L label="Minimum order ($)"><input className="field" inputMode="decimal" value={d.min} onChange={(e) => set('min', e.target.value)} placeholder="none" /></L>
        <L label="Starts"><input type="date" className="field" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></L>
        <L label="Ends"><input type="date" className="field" value={d.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></L>
        <L label="Total uses"><input className="field" inputMode="numeric" value={d.maxUses} onChange={(e) => set('maxUses', e.target.value.replace(/\D/g, ''))} placeholder="unlimited" /></L>
        <L label="Uses per customer"><input className="field" inputMode="numeric" value={d.maxUsesPerUser} onChange={(e) => set('maxUsesPerUser', e.target.value.replace(/\D/g, ''))} placeholder="unlimited" /></L>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn-primary" disabled={save.isPending || !d.code.trim() || !d.value}>{editing ? 'Save changes' : 'Create code'}</button>
          {editing && <button type="button" className="btn-ghost" onClick={() => (setEditing(null), setD(empty))}>Cancel</button>}
        </div>
      </form>
      {!promos.data ? (
        <Loading />
      ) : promos.data.length === 0 ? (
        <Empty>No promo codes yet.</Empty>
      ) : (
        <Table head={<><th className={th}>Code</th><th className={th}>Discount</th><th className={th}>Rules</th><th className={th}>Used</th><th className={th}>Active</th><th className={th} /></>}>
          {promos.data.map((p) => (
            <tr key={p.id}>
              <td className={`${td} font-display font-bold`}>{p.code}</td>
              <td className={`${td} tabular-nums`}>{p.type === 'FIXED' ? formatUsd(p.value) : `${p.value}%`}</td>
              <td className={`${td} text-xs text-muted`}>
                {[p.minSubtotalCents ? `min ${formatUsd(p.minSubtotalCents)}` : null, p.endsAt ? `until ${day(p.endsAt)}` : null, p.maxUsesPerUser ? `${p.maxUsesPerUser}/customer` : null].filter(Boolean).join(', ') || 'No limits'}
              </td>
              <td className={`${td} tabular-nums`}>{p.usedCount}{p.maxUses ? ` / ${p.maxUses}` : ''}</td>
              <td className={td}><Toggle checked={p.isActive} onChange={() => toggle.mutate(p)} label={`${p.code} active`} /></td>
              <td className={`${td} text-right`}><button className="inline-block px-2 py-2 text-sm font-semibold text-yellow hover:underline" onClick={() => (setEditing(p.id), setD(fromPromo(p)), window.scrollTo({ top: 0, behavior: 'smooth' }))}>Edit</button></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
