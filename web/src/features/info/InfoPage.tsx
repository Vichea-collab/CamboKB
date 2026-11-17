import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';

export function InfoPage({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <article className="mx-auto max-w-2xl py-4 sm:py-8">
      <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">{title}</h1>
      {intro && <p className="mt-3 text-lg leading-relaxed text-muted">{intro}</p>}
      <div className="mt-8 space-y-8 leading-relaxed text-ink/90">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-xl font-bold text-ink">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
