import { formatUsd } from '@cambo/shared';
import { ChevronRight, QrCode, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { isApiError } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { Price } from '../../shared/ui/Price';
import { QtyStepper } from '../../shared/ui/QtyStepper';
import { MAX_QTY } from '../cart/cart-store';
import { useAddToCart } from '../cart/useAddToCart';
import { useStore } from '../info/store-api';
import { useProduct, useProducts } from './api';
import { ImageGallery } from './ImageGallery';
import { ProductCard } from './ProductCard';

const SPECS_PREVIEW = 6;

export default function ProductDetail() {
  const { slug = '' } = useParams();
  const product = useProduct(slug);
  const store = useStore();
  const addToCart = useAddToCart();
  const [qty, setQty] = useState(1);
  const [allSpecs, setAllSpecs] = useState(false);
  useDocumentTitle(product.data?.name);
  const related = useProducts({ category: product.data?.category.slug });

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
  const d = store.data?.delivery;
  const specs = allSpecs ? p.specs : p.specs.slice(0, SPECS_PREVIEW);
  const more = (related.data?.items ?? []).filter((x) => x.id !== p.id).slice(0, 6);
  const lowStock = !p.isSoldOut && p.stock <= 3;

  return (
    <div className="pb-24 md:pb-0">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-muted">
        <Link to="/" className="inline-flex min-h-8 items-center rounded px-1 hover:text-ink">
          Shop
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link to={`/?category=${p.category.slug}`} className="inline-flex min-h-8 items-center rounded px-1 hover:text-ink">
          {p.category.name}
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate text-ink/80" aria-current="page">
          {p.name}
        </span>
      </nav>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-12">
        <div className="md:sticky md:top-24 md:self-start">
          <ImageGallery images={p.images} name={p.name} />
        </div>

        <div>
          <h1 className="font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] md:text-[2.4rem]">{p.name}</h1>
          {p.specsLine && <p className="mt-2 text-muted">{p.specsLine}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Price cents={p.priceCents} compareAt={p.compareAtCents} className="text-[2.2rem]" />
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${p.isSoldOut ? 'bg-danger/15 text-danger' : lowStock ? 'bg-yellow/15 text-yellow' : 'bg-green/15 text-green'}`}>
              {p.isSoldOut ? t.product.soldOut : t.product.inStock(p.stock)}
            </span>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-bg/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            {!p.isSoldOut && <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(max, n)))} max={max} label={p.name} />}
            <button className="btn-primary flex-1 py-3.5 text-base md:flex-none md:px-10" disabled={p.isSoldOut} onClick={() => addToCart(p, qty)}>
              {p.isSoldOut ? t.product.soldOut : `${t.product.addToCart} · ${formatUsd(p.priceCents * qty)}`}
            </button>
          </div>

          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            <Perk icon={Truck} title="Delivery across Cambodia">
              {d ? `Phnom Penh from ${formatUsd(Math.min(d.phnomPenhStandardFeeCents, ...d.grabTiers.map((x) => x.feeCents)))}, provinces ${formatUsd(d.provinceFeeCents)}.` : 'Fees are shown before you pay.'}{' '}
              <Link to="/delivery" className="font-semibold text-yellow hover:underline">
                Details
              </Link>
            </Perk>
            <Perk icon={store.data?.payments.khqr ? QrCode : Wallet} title="Pay your way">
              {store.data?.payments.khqr ? 'KHQR with any bank app, or cash on delivery in Phnom Penh.' : 'Cash on delivery in Phnom Penh.'}
            </Perk>
            <Perk icon={ShieldCheck} title="Warranty & returns">
              Something wrong? We'll make it right.{' '}
              <Link to="/warranty" className="font-semibold text-yellow hover:underline">
                Read more
              </Link>
            </Perk>
          </ul>

          <section className="mt-8">
            <h2 className="font-display text-xl font-extrabold tracking-[-0.02em]">{t.product.specs}</h2>
            {p.specs.length ? (
              <>
                <dl className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
                  {specs.map((s, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-3 text-sm">
                      <dt className="font-semibold capitalize text-muted">{s.label}</dt>
                      <dd className="text-ink">{s.value}</dd>
                    </div>
                  ))}
                </dl>
                {p.specs.length > SPECS_PREVIEW && (
                  <button className="mt-3 text-sm font-semibold text-yellow hover:underline" onClick={() => setAllSpecs((v) => !v)} aria-expanded={allSpecs}>
                    {allSpecs ? 'Show fewer' : `Show all ${p.specs.length} specifications`}
                  </button>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.product.noSpecs}</p>
            )}
          </section>
          {p.description && <p className="mt-6 whitespace-pre-line leading-relaxed text-ink/90">{p.description}</p>}
        </div>
      </div>

      {more.length > 0 && (
        <section className="mt-14" aria-labelledby="more-heading">
          <h2 id="more-heading" className="mb-4 font-display text-xl font-extrabold tracking-[-0.02em]">
            More in {p.category.name}
          </h2>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
            {more.map((x) => (
              <div key={x.id} className="w-[44vw] max-w-[220px] shrink-0 snap-start sm:w-auto sm:max-w-none">
                <ProductCard product={x} onAdd={addToCart} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Perk({ icon: Icon, title, children }: { icon: typeof Truck; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-raised text-yellow">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-muted">{children}</p>
      </div>
    </li>
  );
}
