import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

type Row = { label: string; value: string };

export function SpecEditor({ value, onChange }: { value: Row[]; onChange: (rows: Row[]) => void }) {
  const update = (i: number, patch: Partial<Row>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const [row] = next.splice(i, 1);
    next.splice(i + d, 0, row!);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {value.map((r, i) => {
        const name = r.label || `row ${i + 1}`;
        return (
          <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
            <input
              className="field sm:w-44"
              placeholder="Label (e.g. Switch)"
              value={r.label}
              onChange={(e) => update(i, { label: e.target.value })}
              aria-label={`Spec ${i + 1} label`}
            />
            {/* Grows with long values instead of cutting them off. */}
            <textarea
              rows={1}
              className="field min-h-11 resize-none [field-sizing:content]"
              placeholder="Value"
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
              aria-label={`Spec ${i + 1} value`}
            />
            <div className="flex gap-1">
              <button
                type="button"
                className="icon-btn size-11"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${name} up`}
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn size-11"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                aria-label={`Move ${name} down`}
              >
                <ArrowDown className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn-danger size-11"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Remove ${name}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => onChange([...value, { label: '', value: '' }])}
      >
        <Plus className="size-4" aria-hidden /> Add spec
      </button>
    </div>
  );
}
