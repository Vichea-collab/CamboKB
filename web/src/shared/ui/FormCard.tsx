import { MessageCircle, QrCode, Truck } from 'lucide-react';
import type { ReactNode } from 'react';

export function AuthCard({ title, intro, children, footer }: { title: string; intro?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 py-4 sm:py-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:py-14">
      {/* Desktop only: a reason to sign up, on a faint amber glow. */}
      <aside className="relative hidden overflow-hidden rounded-3xl bg-surface p-10 ring-1 ring-line lg:block">
        <div className="pointer-events-none absolute -left-20 -top-24 size-96 rounded-full bg-yellow/10 blur-3xl" aria-hidden />
        <div className="relative">
          <img src="/logo.svg" alt="" className="size-14 rounded-2xl ring-1 ring-line" />
          <p className="mt-8 font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-[-0.035em]">
            Your desk setup,
            <br />
            delivered.
          </p>
          <ul className="mt-9 space-y-5 text-[15px]">
            <Perk icon={MessageCircle} title="Order updates on Telegram">
              Confirmed, on the way, delivered. We message you each step.
            </Perk>
            <Perk icon={QrCode} title="Pay with KHQR">
              Scan with ABA, ACLEDA, Wing or any Cambodian bank app.
            </Perk>
            <Perk icon={Truck} title="Delivery across Cambodia">
              Same-day by Grab in Phnom Penh, VET and J&amp;T to the provinces.
            </Perk>
          </ul>
        </div>
      </aside>

      <div className="mx-auto w-full max-w-md">
        <div className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
          <h1 className="font-display text-[1.7rem] font-extrabold tracking-[-0.03em]">{title}</h1>
          {intro && <p className="mt-2 text-sm leading-relaxed text-muted">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

function Perk({ icon: Icon, title, children }: { icon: typeof Truck; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-yellow ring-1 ring-line-strong">
        <Icon className="size-5" aria-hidden />
      </span>
      <span>
        <span className="block font-bold">{title}</span>
        <span className="text-muted">{children}</span>
      </span>
    </li>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">
      {children}
    </p>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-danger">
      {children}
    </p>
  );
}
