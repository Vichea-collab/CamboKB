import { t } from '../../shared/lib/strings';
import { InfoPage, Section } from './InfoPage';

export default function Privacy() {
  const p = t.info.privacy;
  return (
    <InfoPage title={p.title} intro={p.intro}>
      <Section title={p.collectTitle}>
        <ul className="list-disc space-y-1.5 pl-5">
          {p.collect.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>
      <Section title={p.useTitle}>
        <p>{p.use}</p>
      </Section>
      <Section title={p.whoTitle}>
        <p>{p.who}</p>
      </Section>
      <Section title={p.cookiesTitle}>
        <p>{p.cookies}</p>
      </Section>
      <Section title={p.choicesTitle}>
        <p>{p.choices}</p>
      </Section>
    </InfoPage>
  );
}
