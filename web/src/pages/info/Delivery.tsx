import { formatUsd } from '@cambo/shared';
import { useStore } from '../../lib/store';
import { InfoPage, Section } from './InfoPage';

export default function Delivery() {
  const store = useStore();
  const d = store.data?.delivery;
  return (
    <InfoPage title="Delivery" intro="We deliver across Cambodia. The delivery fee is shown before you pay.">
      {!d ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <Section title="Phnom Penh">
            <ul className="panel divide-y divide-line">
              <Row label="Grab, delivered today">
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {d.grabTiers.map((t, i) => (
                    <li key={t.maxKm} className="flex justify-between gap-6">
                      <span>{i === 0 ? `Up to ${t.maxKm} km` : `Up to ${t.maxKm} km`} from our store</span>
                      <b className="font-semibold text-ink">{formatUsd(t.feeCents)}</b>
                    </li>
                  ))}
                  <li className="flex justify-between gap-6">
                    <span>Further away</span>
                    <b className="font-semibold text-ink">{formatUsd(d.grabBeyondFeeCents)}</b>
                  </li>
                </ul>
              </Row>
              <Row label="VET or J&T Express" value={formatUsd(d.phnomPenhStandardFeeCents)} />
            </ul>
            <p className="text-sm text-muted">Drop a pin on the map at checkout and we'll price Grab by the real distance.</p>
          </Section>
          <Section title="Other provinces">
            <ul className="panel">
              <Row label="VET (Vireak Buntham Express) or J&T Express" value={formatUsd(d.provinceFeeCents)} />
            </ul>
            <p className="text-sm text-muted">Grab delivery is only available in Phnom Penh.</p>
          </Section>
          <Section title="How it works">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Place your order. You'll get a message on Telegram right away.</li>
              <li>We confirm it by Telegram or phone before it goes out.</li>
              <li>You'll hear from us again when it's packed, on the way and delivered.</li>
            </ol>
          </Section>
          <Section title="Paying">
            <p>Cash on delivery is available in Phnom Penh. Online payment with KHQR is coming soon.</p>
          </Section>
        </>
      )}
    </InfoPage>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <li className="p-4">
      <div className="flex items-baseline justify-between gap-6">
        <span className="font-semibold">{label}</span>
        {value && <b className="font-display text-lg tabular-nums">{value}</b>}
      </div>
      {children}
    </li>
  );
}
