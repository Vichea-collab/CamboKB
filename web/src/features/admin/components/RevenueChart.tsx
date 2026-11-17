import { formatUsd } from '@cambo/shared';
import { useCallback, useMemo, useRef, useState } from 'react';

type Bucket = { period: string; orders: number; units: number; revenueCents: number };

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

/** Nice round axis maximum and 4 ticks. */
function ticks(max: number) {
  if (max <= 0) return { top: 100_00, step: 25_00 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: step * 4, step };
}

const label = (period: string, groupBy: 'day' | 'month') => {
  const d = new Date(`${period}${groupBy === 'month' ? '-01' : ''}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    ...(groupBy === 'day' ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' }),
  });
};

/**
 * Single-series revenue bars (one measure, one axis). Order counts live in the
 * tooltip and the table, never on a second axis.
 */
export function RevenueChart({ buckets, groupBy }: { buckets: Bucket[]; groupBy: 'day' | 'month' }) {
  const observer = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([e]) => e && setWidth(Math.max(280, e.contentRect.width)));
    observer.current.observe(el);
  }, []);

  const { top, step } = useMemo(() => ticks(Math.max(...buckets.map((b) => b.revenueCents), 0)), [buckets]);
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, buckets.length);
  const barW = Math.max(2, Math.min(36, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const every = Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 56)));
  const active = hover !== null ? buckets[hover] : undefined;

  return (
    <div ref={measure} className="relative">
      <svg width={width} height={H} role="img" aria-label={`Revenue by ${groupBy}`} className="block" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(i * step)} y2={y(i * step)} stroke="rgb(255 255 255 / 0.07)" />
            <text x={PAD.left - 8} y={y(i * step)} dy="0.35em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
              {formatUsd(i * step)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(b.revenueCents));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={b.period}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`}
                  fill="#ffb703"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${label(b.period, groupBy)}: ${formatUsd(b.revenueCents)}, ${b.orders} orders`}
              />
              {i % every === 0 && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
                  {label(b.period, groupBy)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="rgb(255 255 255 / 0.2)" />
      </svg>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-line-strong bg-raised px-3 py-2 text-sm shadow-pop"
          style={{
            left: Math.min(width - 150, Math.max(0, PAD.left + hover * slot + slot / 2 - 70)),
            top: Math.max(0, y(active.revenueCents) - 72),
          }}
        >
          <p className="font-semibold">{label(active.period, groupBy)}</p>
          <p className="tabular-nums">{formatUsd(active.revenueCents)}</p>
          <p className="text-xs text-muted tabular-nums">
            {active.orders} orders · {active.units} items
          </p>
        </div>
      )}
    </div>
  );
}
