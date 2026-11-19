import { DEFAULT_DELIVERY_SETTINGS, formatPhone, formatUsdExact } from '@cambo/shared';
import { PageHeader } from '../../shared/ui/Page';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { FormError } from '../../shared/ui/FormCard';
import { PhoneInput } from '../../shared/ui/PhoneInput';
import { useQuote, type QuoteInput } from './useQuote';
import { api, ApiError, isApiError } from '../../shared/lib/api';
import { useMe } from '../auth/auth';
import { useTelegramVerification } from '../auth/useTelegramVerification';
import { useCartProducts } from '../catalog/api';
import { t } from '../../shared/lib/strings';
import { canShareLocationInTelegram } from '../../shared/lib/telegram';
import type { Order } from '../../shared/lib/types';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { useCart } from '../cart/cart-store';
import { ShopPerks } from '../info/ShopPerks';
import { useStore } from '../info/store-api';

const MapPicker = lazy(() => import('../../shared/ui/MapPicker'));

type Region = QuoteInput['region'];
type Service = QuoteInput['deliveryService'];
type Profile = {
  defaultAddress: {
    region: Region;
    addressLine: string;
    lat: number | null;
    lng: number | null;
  } | null;
};

export default function Checkout() {
  useDocumentTitle(t.checkout.title);
  const me = useMe();
  const cartItems = useCart((s) => s.items);
  const { lines } = useCartProducts();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/me') });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState<Region>('PHNOM_PENH');
  const [service, setService] = useState<Service>('GRAB');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [promoDraft, setPromoDraft] = useState('');
  const [promo, setPromo] = useState<string>();
  const [promoError, setPromoError] = useState<string>();
  const [payment, setPayment] = useState<'COD' | 'KHQR'>('COD');
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string>();

  // Prefill once from the account.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !me.data || !profile.data) return;
    prefilled.current = true;
    setName(me.data.name);
    setPhone(formatPhone(me.data.phone));
    const a = profile.data.defaultAddress;
    if (a) {
      setRegion(a.region);
      if (a.region === 'PROVINCE') setService('VET');
      setAddress(a.addressLine);
      if (a.lat !== null && a.lng !== null) setPin({ lat: a.lat, lng: a.lng });
    }
  }, [me.data, profile.data]);

  const store = useStore();
  const khqrAvailable = store.data?.payments?.khqr ?? false;
  const chooseRegion = (r: Region) => {
    setRegion(r);
    if (r === 'PROVINCE' && service === 'GRAB') setService('VET');
  };
  const codAvailable = region === 'PHNOM_PENH';
  // Cash on delivery isn't offered outside Phnom Penh: switch province orders to KHQR.
  useEffect(() => {
    if (!codAvailable && payment === 'COD' && khqrAvailable) setPayment('KHQR');
  }, [codAvailable, payment, khqrAvailable]);

  const quoteInput: QuoteInput = {
    items: cartItems,
    region,
    deliveryService: service,
    pin: region === 'PHNOM_PENH' ? pin : null,
    promoCode: promo,
  };
  const quote = useQuote(quoteInput);

  // A promo that stops being valid (e.g. cart dropped below the minimum) is removed with its reason.
  useEffect(() => {
    if (promo && isApiError(quote.error, 'PROMO_INVALID')) {
      setPromoError(
        t.checkout.promoErrors[
          (quote.error.details as { reason?: string })?.reason ?? 'NOT_FOUND'
        ] ?? t.checkout.promoErrors.NOT_FOUND,
      );
      setPromo(undefined);
    }
  }, [quote.error, promo]);

  const applyPromo = async () => {
    const code = promoDraft.trim().toUpperCase();
    if (!code) return;
    setPromoError(undefined);
    try {
      await api('/checkout/quote', { method: 'POST', body: { ...quoteInput, promoCode: code } });
      setPromo(code);
    } catch (err) {
      setPromoError(
        isApiError(err, 'PROMO_INVALID')
          ? (t.checkout.promoErrors[(err.details as { reason?: string })?.reason ?? ''] ??
              t.checkout.promoErrors.NOT_FOUND)
          : (err as Error).message,
      );
    }
  };

  const locate = () => {
    if (!navigator.geolocation) return setLocError(t.checkout.locationDenied);
    setLocating(true);
    setLocError(undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocError(t.checkout.locationDenied);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  const onPin = useCallback((p: { lat: number; lng: number }) => setPin(p), []);

  // Or share it from the phone's Telegram: the bot sends the location back and the pin follows it.
  const tgLocation = useTelegramVerification('SHARE_LOCATION');
  const telegramShare = canShareLocationInTelegram();
  const sharedLocation = tgLocation.status === 'verified' ? tgLocation.location : undefined;
  useEffect(() => {
    if (sharedLocation) setPin(sharedLocation);
  }, [sharedLocation]);

  const { submit, placing, error } = usePlaceOrder();

  if (cartItems.length === 0 && !placing) return <Navigate to="/" replace />;

  // Grab is priced by distance and the driver needs a point on the map: a typed address alone is not enough.
  const pinMissing = region === 'PHNOM_PENH' && service === 'GRAB' && !pin;
  const canSubmit =
    !pinMissing &&
    Boolean(quote.data) &&
    !quote.isFetching &&
    name.trim() &&
    phone.trim() &&
    address.trim() &&
    !placing &&
    (payment === 'COD' ? codAvailable : khqrAvailable);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    submit({
      ...quoteInput,
      contactName: name.trim(),
      contactPhone: phone,
      addressLine: address.trim(),
      note: note.trim() || undefined,
      paymentMethod: payment,
    });
  };

  return (
    <form onSubmit={onSubmit} className="pb-28 lg:pb-0" noValidate>
      <PageHeader title={t.checkout.title} back={{ to: '/', label: t.product.backToShop }} />

      {/* Phones: the order stays in view at the top, folded away until you want to check it. */}
      <details className="panel group mb-5 overflow-hidden lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {t.checkout.summary}
            <ChevronDown
              className="size-4 text-muted transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
          <span className="font-display text-lg font-extrabold tabular-nums">
            {quote.data ? formatUsdExact(quote.data.totalCents) : '—'}
          </span>
        </summary>
        <ul className="divide-y divide-line border-t border-line px-4">
          {lines.map((l) => (
            <li key={l.productId} className="flex items-center gap-3 py-3">
              <div className="media size-12 shrink-0 rounded-xl">
                {l.product.image && (
                  <img src={l.product.image.sm} alt="" className="size-full object-cover" />
                )}
              </div>
              <p className="min-w-0 flex-1 text-sm leading-snug">
                <span className="line-clamp-2 font-semibold">{l.product.name}</span>
                <span className="text-xs text-muted">× {l.quantity}</span>
              </p>
              <span className="text-sm font-bold tabular-nums">
                {formatUsdExact(l.product.priceCents * l.quantity)}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="space-y-4">
          <Section step={1} title={t.checkout.contact} done={Boolean(name.trim() && phone.trim())}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="contact-name" label={t.checkout.name}>
                <input
                  id="contact-name"
                  className="field"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                />
              </Field>
              <Field id="contact-phone" label={t.checkout.phone}>
                <PhoneInput
                  id="contact-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </Field>
            </div>
          </Section>

          <Section step={2} title={t.checkout.delivery} done={Boolean(address.trim())}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="region" label={t.checkout.region}>
                <select
                  id="region"
                  className="field"
                  value={region}
                  onChange={(e) => chooseRegion(e.target.value as Region)}
                >
                  <option value="PHNOM_PENH">{t.checkout.phnomPenh}</option>
                  <option value="PROVINCE">{t.checkout.province}</option>
                </select>
              </Field>
              <Field id="service" label={t.checkout.service}>
                <select
                  id="service"
                  className="field"
                  value={service}
                  onChange={(e) => setService(e.target.value as Service)}
                >
                  {region === 'PHNOM_PENH' && <option value="GRAB">🚀 {t.checkout.grab}</option>}
                  <option value="VET">📦 {t.checkout.vet}</option>
                  <option value="JNT">🚚 {t.checkout.jnt}</option>
                </select>
              </Field>
            </div>
            {region === 'PHNOM_PENH' && (
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted">{t.checkout.pinHelp}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={locate}
                      disabled={locating}
                      className="btn-ghost btn-sm"
                    >
                      📍 {locating ? t.checkout.locating : t.checkout.useLocation}
                    </button>
                    {telegramShare && (
                      <button
                        type="button"
                        onClick={() => void tgLocation.start()}
                        disabled={tgLocation.status === 'starting' || tgLocation.status === 'waiting'}
                        className="btn-ghost btn-sm"
                      >
                        ✈️ {tgLocation.status === 'waiting' ? t.checkout.shareWaiting : t.checkout.shareTelegram}
                      </button>
                    )}
                  </div>
                </div>
                {!telegramShare && <p className="text-sm text-muted">{t.checkout.shareDesktopHint}</p>}
                {telegramShare && tgLocation.status === 'waiting' && (
                  <p className="text-sm text-muted" aria-live="polite">
                    {t.checkout.shareHelp}{' '}
                    {tgLocation.deepLink && (
                      <a className="link" href={tgLocation.deepLink} target="_blank" rel="noopener noreferrer">
                        {t.checkout.shareOpen}
                      </a>
                    )}
                  </p>
                )}
                {tgLocation.status === 'verified' && sharedLocation && (
                  <p className="text-sm text-green" role="status">
                    ✓ {t.checkout.shareReceived}
                  </p>
                )}
                {(tgLocation.status === 'expired' || tgLocation.status === 'error') && (
                  <p className="text-sm text-danger" role="alert">
                    {tgLocation.status === 'expired' ? t.checkout.shareExpired : t.checkout.shareError}
                  </p>
                )}
                {locError && <p className="text-sm text-danger">{locError}</p>}
                {pinMissing && (
                  <p className="text-sm font-semibold text-yellow" role="status">
                    {t.checkout.pinRequired}
                  </p>
                )}
                <Suspense
                  fallback={<div className="h-56 animate-pulse rounded-xl bg-raised/50 sm:h-64" />}
                >
                  <MapPicker
                    value={pin}
                    fallback={DEFAULT_DELIVERY_SETTINGS.store}
                    onChange={onPin}
                  />
                </Suspense>
                {quote.data?.distanceKm != null && (
                  <p className="text-xs text-muted">{t.checkout.distance(quote.data.distanceKm)}</p>
                )}
              </div>
            )}
            <div className="mt-4">
              <Field id="address" label={t.checkout.address}>
                <textarea
                  id="address"
                  rows={2}
                  className="field resize-none"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t.checkout.addressPlaceholder}
                  maxLength={500}
                  required
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field id="note" label={t.checkout.note}>
                <input
                  id="note"
                  className="field"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
          </Section>

          <Section step={3} title={t.checkout.payment} done>
            <div className="space-y-2" role="radiogroup" aria-label={t.checkout.payment}>
              <PaymentOption
                checked={payment === 'COD'}
                disabled={!codAvailable}
                onSelect={() => setPayment('COD')}
                label={t.checkout.cod}
                hint={!codAvailable ? t.checkout.codProvinceHint : undefined}
              />
              <PaymentOption
                checked={payment === 'KHQR'}
                disabled={!khqrAvailable}
                onSelect={() => setPayment('KHQR')}
                label={t.checkout.khqr}
                hint={khqrAvailable ? t.checkout.khqrHint : undefined}
                badge={khqrAvailable ? undefined : t.checkout.comingSoon}
              />
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4">
          <Section title={t.checkout.summary}>
            <ul className="hidden divide-y divide-line lg:block">
              {lines.map((l) => (
                <li key={l.productId} className="flex items-center gap-3 py-2.5 first:pt-0">
                  <div className="media size-12 shrink-0 rounded-xl">
                    {l.product.image && (
                      <img src={l.product.image.sm} alt="" className="size-full object-cover" />
                    )}
                  </div>
                  <p className="min-w-0 flex-1 text-sm leading-snug">
                    <span className="line-clamp-2 font-semibold">{l.product.name}</span>
                    <span className="text-xs text-muted">× {l.quantity}</span>
                  </p>
                  <span className="text-sm font-bold tabular-nums">
                    {formatUsdExact(l.product.priceCents * l.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-line pt-4">
              <label htmlFor="promo" className="label">
                {t.checkout.promo}
              </label>
              {promo ? (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-green/10 py-1 pl-3.5 pr-1 text-sm font-semibold text-green">
                  <span className="flex items-center gap-2">
                    <Check className="size-4" strokeWidth={3} aria-hidden />
                    {promo}
                  </span>
                  <button
                    type="button"
                    className="btn-sm rounded-lg text-muted hover:text-ink"
                    onClick={() => setPromo(undefined)}
                  >
                    {t.checkout.removePromo}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    id="promo"
                    className="field uppercase"
                    value={promoDraft}
                    onChange={(e) => setPromoDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyPromo())}
                    autoCapitalize="characters"
                  />
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={applyPromo}
                    disabled={!promoDraft.trim()}
                  >
                    {t.checkout.apply}
                  </button>
                </div>
              )}
              {promoError && <p className="mt-1.5 text-sm text-danger">{promoError}</p>}
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm" aria-live="polite">
              <Line
                label={t.checkout.subtotal}
                value={quote.data ? formatUsdExact(quote.data.subtotalCents) : '—'}
              />
              <Line
                label={t.checkout.deliveryFee}
                value={quote.data ? formatUsdExact(quote.data.deliveryFeeCents) : '—'}
              />
              {quote.data && quote.data.discountCents > 0 && (
                <Line
                  label={t.checkout.discount}
                  value={`-${formatUsdExact(quote.data.discountCents)}`}
                />
              )}
              <div className="flex items-baseline justify-between pt-2">
                <dt className="text-base font-bold">{t.checkout.total}</dt>
                <dd
                  className={`font-display text-2xl font-bold tabular-nums ${quote.isFetching ? 'opacity-60' : ''}`}
                >
                  {quote.data ? formatUsdExact(quote.data.totalCents) : '—'}
                </dd>
              </div>
            </dl>

            <div className="mt-4 space-y-3">
              <FormError>
                {error ??
                  (quote.error && !isApiError(quote.error, 'PROMO_INVALID')
                    ? (quote.error as Error).message
                    : undefined)}
              </FormError>
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
                <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
                  {placing ? t.checkout.placing : t.checkout.confirm}
                </button>
              </div>
            </div>
          </Section>
          <ShopPerks className="mt-5" />
        </aside>
      </div>
    </form>
  );
}

/** Place the order once: a ref blocks double-taps, and the Idempotency-Key makes retries safe server-side. */
function usePlaceOrder() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clear = useCart((s) => s.clear);
  const setQty = useCart((s) => s.setQty);
  const removeMany = useCart((s) => s.removeMany);
  const [key] = useState(() => crypto.randomUUID());
  const inFlight = useRef(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (body: object) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPlacing(true);
    setError(undefined);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key },
      });
      clear();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      navigate(
        order.payment?.method === 'KHQR'
          ? `/orders/${order.number}/pay`
          : `/orders/${order.number}/success`,
        { replace: true },
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OUT_OF_STOCK') {
        for (const i of (err.details as { items: { productId: string; available: number }[] })
          .items)
          setQty(i.productId, i.available);
        setError(t.checkout.outOfStock);
      } else if (err instanceof ApiError && err.code === 'PRODUCT_UNAVAILABLE') {
        removeMany((err.details as { productIds: string[] }).productIds);
        setError(t.checkout.outOfStock);
      } else setError((err as Error).message);
      qc.invalidateQueries({ queryKey: ['products', 'by-ids'] });
      inFlight.current = false;
      setPlacing(false);
    }
  };
  return { submit, placing, error };
}

function Section({
  title,
  children,
  step,
  done,
}: {
  title: string;
  children: ReactNode;
  step?: number;
  done?: boolean;
}) {
  return (
    <section className="panel p-5">
      <h2 className="title-section mb-4 flex items-center gap-3">
        {step && (
          <span
            className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-extrabold transition-colors ${
              done
                ? 'bg-green/15 text-green ring-1 ring-green/40'
                : 'bg-raised text-muted ring-1 ring-line-strong'
            }`}
            aria-label={`Step ${step}${done ? ', complete' : ''}`}
          >
            {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : step}
          </span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <dt>{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function PaymentOption({
  checked,
  disabled,
  onSelect,
  label,
  hint,
  badge,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
  badge?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border p-3.5 ${checked ? 'border-yellow/60 bg-yellow/5' : 'border-line bg-bg'} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
    >
      <input
        type="radio"
        name="payment"
        className="mt-0.5 size-4 accent-[#ffb703]"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-label={label}
      />
      <span className="flex-1">
        <span className="flex items-center gap-2 font-semibold">
          {label}
          {badge && <span className="badge bg-raised text-muted">{badge}</span>}
        </span>
        {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}
