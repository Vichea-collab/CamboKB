import { formatUsd } from '@cambo/shared';
import { ChevronRight, PackageSearch } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { isApiError } from '../../shared/lib/api';
import { categoryName, t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { BackLink, Badge, EmptyState, LoadingState } from '../../shared/ui/Page';
import { Price } from '../../shared/ui/Price';
import { QtyStepper } from '../../shared/ui/QtyStepper';
import { MAX_QTY } from '../cart/cart-store';
import { useAddToCart } from '../cart/useAddToCart';
import { useProduct, useProducts } from './api';
import { ImageGallery } from './ImageGallery';
import { ProductCard } from './ProductCard';

const SPECS_PREVIEW = 6;

export default function ProductDetail() {
  const { slug = '' } = useParams();
  const product = useProduct(slug);
  const addToCart = useAddToCart();
  const [qty, setQty] = useState(1);
  const [allSpecs, setAllSpecs] = useState(false);
  useDocumentTitle(product.data?.name);
  const related = useProducts({ category: product.data?.category.slug });

  if (product.isPending) return <LoadingState />;
  if (product.isError) {
    return (
      <div className="mx-auto max-w-md py-6">
        <EmptyState
          icon={PackageSearch}
          title={isApiError(product.error, 'NOT_FOUND') ? t.product.notFound : t.common.error}
          action={
            <Link to="/" className="btn-primary">
              {t.product.backToShop}
            </Link>
          }
        />
      </div>
    );
  }

  const p = product.data;
  const max = Math.min(MAX_QTY, Math.max(1, p.stock));
  const specs = allSpecs ? p.specs : p.specs.slice(0, SPECS_PREVIEW);
  const more = (related.data?.items ?? []).filter((x) => x.id !== p.id).slice(0, 4);
  const lowStock = !p.isSoldOut && p.stock <= 3;

  return (
    <div>
      {/* Phones: a clean back button with arrow. Tablets and desktop: the full breadcrumb. */}
      <div className="mb-2 sm:hidden">
        <BackLink to={p.category.slug ? `/?category=${p.category.slug}` : '/'}>
          {categoryName(p.category.slug, p.category.name)}
        </BackLink>
      </div>
      <nav
        aria-label={t.product.breadcrumb}
        className="mb-3 hidden sm:flex items-center gap-1 text-sm font-semibold text-muted"
      >
        <Link to="/" className="inline-flex min-h-10 items-center rounded-lg px-1 hover:text-ink">
          {t.product.shop}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link
          to={`/?category=${p.category.slug}`}
          className="inline-flex min-h-10 items-center rounded-lg px-1 hover:text-ink"
        >
          {categoryName(p.category.slug, p.category.name)}
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate text-ink/80" aria-current="page">
          {p.name}
        </span>
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-12">
        <div className="md:sticky md:top-24 md:self-start">
          <ImageGallery images={p.images} name={p.name} />
        </div>

        <div>
          <h1 className="title-page md:text-[2.4rem]">{p.name}</h1>
          {p.specsLine && <p className="mt-2 text-muted">{p.specsLine}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Price cents={p.priceCents} compareAt={p.compareAtCents} className="text-[2.2rem]" />
            <Badge tone={p.isSoldOut ? 'danger' : lowStock ? 'yellow' : 'green'}>
              {p.isSoldOut ? t.product.soldOut : t.product.inStock(p.stock)}
            </Badge>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-bg/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            {!p.isSoldOut && (
              <QtyStepper
                value={qty}
                onChange={(n) => setQty(Math.max(1, Math.min(max, n)))}
                max={max}
                label={p.name}
              />
            )}
            <button
              className="btn-primary min-h-12 flex-1 text-base md:flex-none md:px-10"
              disabled={p.isSoldOut}
              onClick={() => addToCart(p, qty)}
            >
              {p.isSoldOut
                ? t.product.soldOut
                : `${t.product.addToCart} · ${formatUsd(p.priceCents * qty)}`}
            </button>
          </div>

          <section className="mt-8">
            <h2 className="title-section">{t.product.specs}</h2>
            {p.specs.length ? (
              <>
                <dl className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
                  {specs.map((s, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-3 text-sm"
                    >
                      <dt className="font-semibold capitalize text-muted">{s.label}</dt>
                      <dd className="text-ink">{s.value}</dd>
                    </div>
                  ))}
                </dl>
                {p.specs.length > SPECS_PREVIEW && (
                  <button
                    className="link mt-2 inline-flex min-h-10 items-center text-sm"
                    onClick={() => setAllSpecs((v) => !v)}
                    aria-expanded={allSpecs}
                  >
                    {allSpecs ? t.product.showFewer : t.product.showAllSpecs(p.specs.length)}
                  </button>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.product.noSpecs}</p>
            )}
          </section>
          {p.description && (
            <p className="mt-6 whitespace-pre-line leading-relaxed text-ink/90">{p.description}</p>
          )}
        </div>
      </div>

      {more.length > 0 && (
        <section className="mt-14" aria-labelledby="more-heading">
          <h2 id="more-heading" className="title-section mb-4">
            {t.product.moreIn(categoryName(p.category.slug, p.category.name))}
          </h2>
          <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {more.map((x) => (
              <div
                key={x.id}
                className="w-[44vw] max-w-[220px] shrink-0 snap-start sm:w-auto sm:max-w-none [&>article]:h-full"
              >
                <ProductCard product={x} onAdd={addToCart} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
