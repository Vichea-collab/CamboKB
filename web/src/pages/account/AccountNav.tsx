import { NavLink } from 'react-router';
import { t } from '../../lib/strings';

export function AccountNav() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-yellow text-bg' : 'border border-line bg-surface text-muted hover:text-ink'}`;
  return (
    <nav className="mb-5 flex gap-2" aria-label="Account">
      <NavLink to="/account" end className={tab}>
        {t.account.profile}
      </NavLink>
      <NavLink to="/account/orders" className={tab}>
        {t.account.orders}
      </NavLink>
    </nav>
  );
}
