import { useStore, telHref } from '../../lib/store';
import { InfoPage } from './InfoPage';

export default function Contact() {
  const store = useStore();
  const info = store.data?.info;
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (info?.phone) rows.push({ label: 'Phone', value: <a className="font-semibold text-yellow hover:underline" href={telHref(info.phone)}>{info.phone}</a> });
  if (info?.telegram) rows.push({ label: 'Telegram', value: <a className="font-semibold text-yellow hover:underline" href={`https://t.me/${info.telegram}`} target="_blank" rel="noopener noreferrer">@{info.telegram}</a> });
  if (info?.facebook) rows.push({ label: 'Facebook', value: <a className="font-semibold text-yellow hover:underline" href={info.facebook} target="_blank" rel="noopener noreferrer">{info.facebook.replace(/^https:\/\/(www\.)?/, '')}</a> });
  if (info?.address) rows.push({ label: 'Address', value: <span className="whitespace-pre-line">{info.address}</span> });
  if (info?.hours) rows.push({ label: 'Opening hours', value: <span className="whitespace-pre-line">{info.hours}</span> });

  return (
    <InfoPage title="Contact" intro="Questions about a product or your order? Reach us any of these ways.">
      {store.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="panel p-5 text-muted">Contact details are coming soon. In the meantime, message us from the shop's Telegram bot.</p>
      ) : (
        <dl className="panel divide-y divide-line">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-muted">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </InfoPage>
  );
}
