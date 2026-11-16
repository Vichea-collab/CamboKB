type Role = 'ADMIN' | 'CUSTOMER';

/** Promote a customer to admin or back. Admins can't change their own role. */
export function RoleControl({ role, name, isSelf, busy, onChange }: { role: Role; name: string; isSelf: boolean; busy: boolean; onChange: (role: Role) => void }) {
  const isAdmin = role === 'ADMIN';
  return (
    <section className="panel flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <h2 className="font-display text-lg font-bold">Role</h2>
        <p className="text-sm text-muted">
          {isAdmin ? 'Admin: can open this dashboard and manage the store.' : 'Customer: can shop and see their own orders.'}
        </p>
        {isSelf && <p className="mt-1 text-sm text-muted">This is you. Another admin can change your role.</p>}
      </div>
      {!isSelf && (
        <button
          className={isAdmin ? 'btn-ghost' : 'btn-primary'}
          disabled={busy}
          onClick={() => {
            const next: Role = isAdmin ? 'CUSTOMER' : 'ADMIN';
            const question = isAdmin
              ? `Make ${name} a customer? They lose access to the admin right away.`
              : `Make ${name} an admin? They will be able to manage products, orders and customers.`;
            if (confirm(question)) onChange(next);
          }}
        >
          {isAdmin ? 'Make customer' : 'Make admin'}
        </button>
      )}
    </section>
  );
}
