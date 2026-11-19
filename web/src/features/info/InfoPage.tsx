import type { ReactNode } from 'react';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { PageHeader } from '../../shared/ui/Page';

export function InfoPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <article className="mx-auto max-w-2xl sm:py-4">
      <PageHeader title={title} description={intro} back={{ to: '/', label: t.product.backToShop }} />
      <div className="mt-8 space-y-8 leading-relaxed text-ink/90">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="title-section mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
