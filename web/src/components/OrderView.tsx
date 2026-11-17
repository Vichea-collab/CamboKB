import { formatPhone, formatUsd } from '@cambo/shared';
import type { ReactNode } from 'react';
import { t } from '../lib/strings';
import type { Order } from '../lib/types';
import { StatusBadge } from './StatusBadge';

const STEPS = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh', dateStyle: 'medium', timeStyle: 'short' });

/** Progress through the fixed order flow; a cancelled order shows where it stopped. */
export function OrderTimeline({ order }: { order: Order }) {
  const reached = new Map(order.events.map((e) => [e.toStatus, e]));
  const cancelled = reached.get('CANCELLED');
  return (
    <ol className="space-y-0">
      {STEPS.map((s, i) => {
        const ev = reached.get(s);
        const done = Boolean(ev);
        return (
          <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
            {i < STEPS.length - 1 && <span className={`absolute left-[9px] top-5 h-full w-0.5 ${done && reached.get(STEPS[i + 1]!) ? 'bg-yellow' : 'bg-raised'}`} aria-hidden />}
            <span className={`relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${done ? 'bg-yellow text-bg' : 'border-2 border-raised bg-surface'}`}>
              {done ? '✓' : ''}
            </span>
            <div className={done ? '' : 'text-muted'}>
              <p className="text-sm font-semibold">{t.status[s]}</p>
              {ev && <p className="text-xs text-muted">{when(ev.at)}</p>}
            </div>
          </li>
        );
      })}
      {cancelled && (
        <li className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {t.status.CANCELLED} · {when(cancelled.at)}
          {cancelled.note ? ` — ${cancelled.note}` : ''}
        </li>
      )}
    </ol>
  );
}

export function OrderSummary({ order, actions }: { order: Order; actions?: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <section className="panel p-5">
          <ul className="divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.productId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-[#090c10]">{i.image && <img src={i.image} alt="" className="size-full object-cover" />}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug">{i.name}</p>
                  <p className="text-xs text-muted tabular-nums">
                    {i.quantity} × {formatUsd(i.priceCents)}
                  </p>
                </div>
                <span className="font-display font-bold tabular-nums">{formatUsd(i.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <Row label={t.checkout.subtotal} value={formatUsd(order.subtotalCents)} />
            <Row label={t.checkout.deliveryFee} value={formatUsd(order.deliveryFeeCents)} />
            {order.discountCents > 0 && <Row label={`${t.checkout.discount}${order.promoCode ? ` (${order.promoCode})` : ''}`} value={`-${formatUsd(order.discountCents)}`} />}
            <div className="flex justify-between pt-2 text-base font-bold">
              <dt>{t.checkout.total}</dt>
              <dd className="font-display text-xl tabular-nums">{formatUsd(order.totalCents)}</dd>
            </div>
          </dl>
        </section>
        <section className="panel grid gap-4 p-5 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-1 font-semibold text-muted">{t.checkout.contact}</h3>
            <p className="font-semibold">{order.contactName}</p>
            <p className="tabular-nums">{formatPhone(order.contactPhone)}</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-muted">{t.checkout.delivery}</h3>
            <p>
              {t.region[order.region]} · {t.service[order.deliveryService]}
            </p>
            <p className="text-ink/85">{order.addressLine}</p>
            {order.lat !== null && order.lng !== null && (
              <a className="-my-1 mt-0 inline-block py-2 font-semibold text-yellow hover:underline" href={`https://maps.google.com/?q=${order.lat},${order.lng}`} target="_blank" rel="noopener noreferrer">
                Open map pin
              </a>
            )}
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-muted">{t.checkout.payment}</h3>
            <p>
              {order.payment ? t.payment[order.payment.method] : '—'} · {order.payment ? t.paymentStatus[order.payment.status] : ''}
            </p>
          </div>
          {order.note && (
            <div>
              <h3 className="mb-1 font-semibold text-muted">{t.checkout.note}</h3>
              <p className="whitespace-pre-line">{order.note}</p>
            </div>
          )}
        </section>
      </div>
      <aside className="space-y-4">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <StatusBadge status={order.status} />
            <span className="text-xs text-muted">{when(order.createdAt)}</span>
          </div>
          <OrderTimeline order={order} />
        </section>
        {actions}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <dt>{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}
