import { formatUsdExact } from '@cambo/shared';
import { useStore } from './store-api';
import { LoadingState } from '../../shared/ui/Page';
import { t } from '../../shared/lib/strings';
import { InfoPage, Section } from './InfoPage';

export default function Delivery() {
  const store = useStore();
  const d = store.data?.delivery;
  return (
    <InfoPage title={t.info.delivery.title} intro={t.info.delivery.intro}>
      {!d ? (
        <LoadingState />
      ) : (
        <>
          <Section title={t.info.delivery.phnomPenh}>
            <ul className="panel divide-y divide-line">
              <Row label={t.info.delivery.grabToday}>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {d.grabTiers.map((tier) => (
                    <li key={tier.maxKm} className="flex justify-between gap-6">
                      <span>{t.info.delivery.upTo(tier.maxKm)}</span>
                      <b className="font-semibold text-ink">{formatUsdExact(tier.feeCents)}</b>
                    </li>
                  ))}
                  <li className="flex justify-between gap-6">
                    <span>{t.info.delivery.further}</span>
                    <b className="font-semibold text-ink">{formatUsdExact(d.grabBeyondFeeCents)}</b>
                  </li>
                </ul>
              </Row>
              <Row label={t.info.delivery.vetJnt} value={formatUsdExact(d.phnomPenhStandardFeeCents)} />
            </ul>
            <p className="text-sm text-muted">
              {t.info.delivery.pinNote}
            </p>
          </Section>
          <Section title={t.info.delivery.provinces}>
            <ul className="panel">
              <Row
                label={t.info.delivery.provinceRow}
                value={formatUsdExact(d.provinceFeeCents)}
              />
            </ul>
            <p className="text-sm text-muted">{t.info.delivery.grabOnly}</p>
          </Section>
          <Section title={t.info.delivery.how}>
            <ol className="list-decimal space-y-2 pl-5">
              {t.info.delivery.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Section>
          <Section title={t.info.delivery.paying}>
            <p>{t.info.delivery.payingBody}</p>
          </Section>
        </>
      )}
    </InfoPage>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
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
