import { useStore } from './store-api';
import { InfoPage, Section } from './InfoPage';

export default function Warranty() {
  const store = useStore();
  const custom = store.data?.info.warranty.trim();
  return (
    <InfoPage title="Warranty & returns" intro="If something is wrong with your order, tell us. We'll make it right.">
      {store.isPending ? (
        <p className="text-muted">Loading…</p>
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
          <Section title="Before you buy">
            <p>Warranty terms depend on the product and its brand. Ask us before you buy if it matters to you. We're happy to explain.</p>
          </Section>
          <Section title="If something is wrong">
            <p>Check your order when it arrives. If an item is damaged, missing or doesn't work, message us right away with your order number and a photo or short video. Your order number is on your invoice and in your account.</p>
          </Section>
        </>
      )}
    </InfoPage>
  );
}
