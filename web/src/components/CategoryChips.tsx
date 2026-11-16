import type { Category } from '../lib/types';
import { t } from '../lib/strings';

const ICON: Record<string, string> = { keyboards: ' ⌨️' };

export function CategoryChips({ categories, active, onSelect }: { categories: Category[]; active: string; onSelect: (slug: string) => void }) {
  const chips = [{ slug: '', name: t.home.all }, ...categories];
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Categories">
      {chips.map((c) => {
        const on = c.slug === active;
        return (
          <button
            key={c.slug || 'all'}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(c.slug)}
            className={`shrink-0 rounded-full border px-4 py-2 text-[0.8rem] transition-colors ${
              on ? 'border-transparent bg-yellow font-extrabold text-bg shadow-[0_4px_14px_rgb(255_183_3/0.35)]' : 'border-line bg-surface font-semibold text-muted hover:text-ink'
            }`}
          >
            {c.name}
            {ICON[c.slug] ?? ''}
          </button>
        );
      })}
    </div>
  );
}
