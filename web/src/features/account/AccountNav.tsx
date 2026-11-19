import { NavLink } from 'react-router';
import { t } from '../../shared/lib/strings';

/** Profile / Orders. NavLink marks the current one with aria-current, which the chip style shows. */
export function AccountNav() {
  return (
    <nav className="-mt-1 mb-5 flex gap-2" aria-label="Account">
      <NavLink to="/account" end className="chip">
        {t.account.profile}
      </NavLink>
      <NavLink to="/account/orders" className="chip">
        {t.account.orders}
      </NavLink>
    </nav>
  );
}
