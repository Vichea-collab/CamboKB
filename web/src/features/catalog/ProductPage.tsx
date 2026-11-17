import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ImageGallery } from './ImageGallery';
import { Price } from '../../shared/ui/Price';
import { QtyStepper } from '../../shared/ui/QtyStepper';
import { isApiError } from '../../shared/lib/api';
import { useProduct } from './api';
import { t } from '../../shared/lib/strings';
import { useAddToCart } from '../cart/useAddToCart';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { MAX_QTY } from '../cart/cart-store';

export default function ProductDetail() {
  const { slug = '' } = useParams();
  const product = useProduct(slug);
  const addToCart = useAddToCart();
  const [qty, setQty] = useState(1);
  useDocumentTitle(product.data?.name);

  if (product.isPending) return <p className="py-16 text-center text-muted">{t.common.loading}</p>;
  if (product.isError) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <p className="text-muted">{isApiError(product.error, 'NOT_FOUND') ? t.product.notFound : t.common.error}</p>
        <Link to="/" className="btn-primary mt-5">
          {t.product.backToShop}
        </Link>
      </div>
    );
  }

  const p = product.data;
  const max = Math.min(MAX_QTY, Math.max(1, p.stock));
  return (
    <div className="pb-24 md:pb-0">
      <Link to="/" className="-ml-1 mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-muted hover:text-ink">
        ← {t.common.back}
      </Link>
      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <ImageGallery images={p.images} name={p.name} />
        <div>
          <Link to={`/?category=${p.category.slug}`} className="inline-block py-2 text-sm font-bold text-yellow hover:underline">
            {p.category.name}
          </Link>
          <h1 className="mt-1.5 font-display text-[1.75rem] font-bold leading-tight tracking-[-0.02em] md:text-4xl">{p.name}</h1>
          {p.specsLine && <p className="mt-2 text-muted">{p.specsLine}</p>}
          <div className="mt-4 flex items-center gap-3">
            <Price cents={p.priceCents} compareAt={p.compareAtCents} className="text-3xl" />
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.isSoldOut ? 'bg-danger/15 text-danger' : 'bg-green/15 text-green'}`}>
              {p.isSoldOut ? t.product.soldOut : t.product.inStock(p.stock)}
            </span>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
            {!p.isSoldOut && <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(max, n)))} max={max} label={p.name} />}
            <button className="btn-primary flex-1 md:flex-none md:px-8" disabled={p.isSoldOut} onClick={() => addToCart(p, qty)}>
              {p.isSoldOut ? t.product.soldOut : t.product.addToCart}
            </button>
          </div>

          <section className="mt-8">
            <h2 className="font-display text-lg font-bold">{t.product.specs}</h2>
            {p.specs.length ? (
              <dl className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {p.specs.map((s, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-3 text-sm">
                    <dt className="font-semibold capitalize text-muted">{s.label}</dt>
                    <dd className="text-ink">{s.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.product.noSpecs}</p>
            )}
          </section>
          {p.description && <p className="mt-6 whitespace-pre-line leading-relaxed text-ink/90">{p.description}</p>}
        </div>
      </div>
    </div>
  );
}
