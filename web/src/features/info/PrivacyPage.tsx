import { InfoPage, Section } from './InfoPage';

export default function Privacy() {
  return (
    <InfoPage title="Privacy" intro="What we keep about you, and why.">
      <Section title="What we collect">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your name and phone number, confirmed through Telegram when you sign up.</li>
          <li>Your Telegram user ID and username, so we can message you about your orders.</li>
          <li>Your delivery address, map pin and notes, and what you ordered.</li>
          <li>A password, stored only as a secure hash. We can't read it.</li>
        </ul>
      </Section>
      <Section title="How we use it">
        <p>To confirm and deliver your orders, send order updates on Telegram, give you your order history and invoices, and keep your account secure.</p>
      </Section>
      <Section title="Who sees it">
        <p>Our team, and the delivery service you choose (Grab, VET or J&T), who only get what they need to deliver: your name, phone number and address. We never sell your information and we don't use advertising trackers.</p>
      </Section>
      <Section title="Cookies and storage">
        <p>We use one cookie to keep you logged in, and your browser's storage to remember your cart. Nothing else.</p>
      </Section>
      <Section title="Your choices">
        <p>You can change your name, phone number and password in your account. To delete your account and data, ask us through the contact page and we'll remove it, except for order records we need to keep.</p>
      </Section>
    </InfoPage>
  );
}
