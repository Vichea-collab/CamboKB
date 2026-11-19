/** A tiny trend line with a soft fill. Decorative: the numbers beside it carry the meaning. */
export function Sparkline({ values, className = '' }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 36;
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 3 - (v / max) * (h - 8);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffb703" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffb703" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="#ffb703" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last)} cy={y(values[last]!)} r="2.5" fill="#ffb703" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
