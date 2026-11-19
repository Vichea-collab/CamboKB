import { formatUsd } from '@cambo/shared';
import { QrCode, ShieldCheck, Truck, Wallet, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '../../shared/lib/strings';
import { useStore } from './store-api';

/** What a customer wants to know before paying: what delivery costs, how they can pay, and what if something is wrong. */
export function ShopPerks({ className = '' }: { className?: string }) {
  const store = useStore();
  const d = store.data?.delivery;
  return (
    <ul className={`divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line ${className}`}>
      <Perk icon={Truck} title={t.product.deliveryTitle}>
        {d
          ? t.product.deliveryFrom(
              formatUsd(Math.min(d.phnomPenhStandardFeeCents, ...d.grabTiers.map((x) => x.feeCents))),
              formatUsd(d.provinceFeeCents),
            )
          : t.product.feesShown}{' '}
        <Link to="/delivery" className="link">
          {t.product.details}
        </Link>
      </Perk>
      <Perk icon={store.data?.payments.khqr ? QrCode : Wallet} title={t.product.payTitle}>
        {store.data?.payments.khqr ? t.product.payKhqr : t.product.payCod}
      </Perk>
      <Perk icon={ShieldCheck} title={t.product.warrantyTitle}>
        {t.product.warrantyBlurb}{' '}
        <Link to="/warranty" className="link">
          {t.product.readMore}
        </Link>
      </Perk>
    </ul>
  );
}

function Perk({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-raised text-yellow">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-muted">{children}</p>
      </div>
    </li>
  );
}
