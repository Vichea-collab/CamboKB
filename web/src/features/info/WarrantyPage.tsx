import { useStore } from './store-api';
import { LoadingState } from '../../shared/ui/Page';
import { t } from '../../shared/lib/strings';
import { InfoPage, Section } from './InfoPage';

export default function Warranty() {
  const store = useStore();
  const custom = store.data?.info.warranty.trim();
  return (
    <InfoPage title={t.info.warranty.title} intro={t.info.warranty.intro}>
      {store.isPending ? (
        <LoadingState />
      ) : custom ? (
        <div className="space-y-4">
          {custom.split(/\n{2,}/).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      ) : (
        <>
          <Section title={t.info.warranty.beforeTitle}>
            <p>{t.info.warranty.before}</p>
          </Section>
          <Section title={t.info.warranty.wrongTitle}>
            <p>{t.info.warranty.wrong}</p>
          </Section>
        </>
      )}
    </InfoPage>
  );
}
