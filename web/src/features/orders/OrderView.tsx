import { formatPhone, formatUsdExact } from '@cambo/shared';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { t } from '../../shared/lib/strings';
import type { Order } from '../../shared/lib/types';
import { formatDateTime as when } from '../../shared/lib/format';
import { Section } from '../../shared/ui/Page';
import { StatusBadge } from '../../shared/ui/StatusBadge';

const STEPS = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;

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
            {i < STEPS.length - 1 && (
              <span
                className={`absolute left-[9px] top-5 h-full w-0.5 ${done && reached.get(STEPS[i + 1]!) ? 'bg-yellow' : 'bg-raised'}`}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${done ? 'bg-yellow text-yellow-ink' : 'border-2 border-raised bg-surface'}`}
            >
              {done && <Check className="size-3" strokeWidth={3.5} aria-hidden />}
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
        <Section title={t.orderView.items}>
          <ul className="divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.productId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="media size-14 shrink-0 rounded-xl">
                  {i.image && <img src={i.image} alt="" className="size-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug">{i.name}</p>
                  <p className="text-xs text-muted tabular-nums">
                    {i.quantity} × {formatUsdExact(i.priceCents)}
                  </p>
                </div>
                <span className="font-display font-bold tabular-nums">
                  {formatUsdExact(i.lineTotalCents)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <Row label={t.checkout.subtotal} value={formatUsdExact(order.subtotalCents)} />
            <Row label={t.checkout.deliveryFee} value={formatUsdExact(order.deliveryFeeCents)} />
            {order.discountCents > 0 && (
              <Row
                label={`${t.checkout.discount}${order.promoCode ? ` (${order.promoCode})` : ''}`}
                value={`-${formatUsdExact(order.discountCents)}`}
              />
            )}
            <div className="flex justify-between pt-2 text-base font-bold">
              <dt>{t.checkout.total}</dt>
              <dd className="font-display text-xl tabular-nums">{formatUsdExact(order.totalCents)}</dd>
            </div>
          </dl>
        </Section>
        <Section title={t.orderView.details}>
          <div className="grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted">{t.checkout.contact}</h3>
              <p className="font-semibold">{order.contactName}</p>
              <p className="tabular-nums">{formatPhone(order.contactPhone)}</p>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted">{t.checkout.delivery}</h3>
              <p>
                {t.region[order.region]} · {t.service[order.deliveryService]}
              </p>
              <p className="text-ink/85">{order.addressLine}</p>
              {order.trackingNumber && <TrackingLine value={order.trackingNumber} />}
              {order.lat !== null && order.lng !== null && (
                <a
                  className="link inline-flex min-h-10 items-center"
                  href={`https://maps.google.com/?q=${order.lat},${order.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.orderView.mapPin}
                </a>
              )}
              {order.deliveryService === 'GRAB' && (order.lat === null || order.lng === null) && (
                <p className="mt-1 text-sm font-semibold text-yellow">{t.orderView.noPin}</p>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted">{t.checkout.payment}</h3>
              <p>
                {order.payment ? t.payment[order.payment.method] : '—'} ·{' '}
                {order.payment ? t.paymentStatus[order.payment.status] : ''}
              </p>
            </div>
            {order.note && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-muted">{t.checkout.note}</h3>
                <p className="whitespace-pre-line">{order.note}</p>
              </div>
            )}
          </div>
        </Section>
      </div>
      <aside className="space-y-4">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <StatusBadge status={order.status} payment={order.payment?.status} />
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

/** The carrier's tracking code, easy to copy into the carrier's app. */
function TrackingLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-raised px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">{t.orderView.tracking}</p>
        <p className="truncate font-display font-bold tabular-nums">{value}</p>
      </div>
      <button
        type="button"
        aria-label={t.orderView.copyTracking}
        className="btn-ghost btn-sm shrink-0"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? <Check className="size-4 text-green" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied && t.orderView.copied}
      </button>
    </div>
  );
}
