type Row = { label: string; value: string };

export function SpecEditor({ value, onChange }: { value: Row[]; onChange: (rows: Row[]) => void }) {
  const update = (i: number, patch: Partial<Row>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const [row] = next.splice(i, 1);
    next.splice(i + d, 0, row!);
    onChange(next);
  };
  const iconBtn = 'grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted hover:text-ink disabled:opacity-30';
  return (
    <div className="space-y-2">
      {value.map((r, i) => {
        const name = r.label || `row ${i + 1}`;
        return (
          <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
            <input className="field sm:w-44" placeholder="Label (e.g. Switch)" value={r.label} onChange={(e) => update(i, { label: e.target.value })} aria-label={`Spec ${i + 1} label`} />
            <input className="field" placeholder="Value" value={r.value} onChange={(e) => update(i, { value: e.target.value })} aria-label={`Spec ${i + 1} value`} />
            <div className="flex gap-1">
              <button type="button" className={iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${name} up`}>
                ↑
              </button>
              <button type="button" className={iconBtn} onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label={`Move ${name} down`}>
                ↓
              </button>
              <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${name}`}>
                ✕
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => onChange([...value, { label: '', value: '' }])}>
        <span aria-hidden>+</span> Add spec
      </button>
    </div>
  );
}
