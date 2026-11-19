import { useStore, telHref } from './store-api';
import { EmptyState, LoadingState } from '../../shared/ui/Page';
import { t } from '../../shared/lib/strings';
import { InfoPage } from './InfoPage';

export default function Contact() {
  const store = useStore();
  const info = store.data?.info;
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (info?.phone)
    rows.push({
      label: t.info.contact.phone,
      value: (
        <a className="link" href={telHref(info.phone)}>
          {info.phone}
        </a>
      ),
    });
  if (info?.telegram)
    rows.push({
      label: t.info.contact.telegram,
      value: (
        <a
          className="link"
          href={`https://t.me/${info.telegram}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          @{info.telegram}
        </a>
      ),
    });
  if (info?.facebook)
    rows.push({
      label: t.info.contact.facebook,
      value: (
        <a className="link" href={info.facebook} target="_blank" rel="noopener noreferrer">
          {info.facebook.replace(/^https:\/\/(www\.)?/, '')}
        </a>
      ),
    });
  if (info?.address)
    rows.push({
      label: t.info.contact.address,
      value: <span className="whitespace-pre-line">{info.address}</span>,
    });
  if (info?.hours)
    rows.push({
      label: t.info.contact.hours,
      value: <span className="whitespace-pre-line">{info.hours}</span>,
    });

  return (
    <InfoPage title={t.info.contact.title} intro={t.info.contact.intro}>
      {store.isPending ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title={t.info.contact.soon}>{t.info.contact.soonBody}</EmptyState>
      ) : (
        <dl className="panel divide-y divide-line">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-sm font-semibold text-muted">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </InfoPage>
  );
}
