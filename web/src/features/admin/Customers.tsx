import { formatPhone, formatUsd } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/lib/api';
import type { Paged } from '../../shared/lib/types';
import { Empty, Loading, PageHeader, Table, td, th } from './components/ui';
import { Pager } from './Orders';
import type { Customer } from './types';

export default function Customers() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'customers', query, page],
    queryFn: () => api<Paged<Customer>>(`/admin/customers?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Customers" />
      <form
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <input className="field" placeholder="Name, phone or Telegram username" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        <button className="btn-ghost shrink-0">Search</button>
      </form>
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <Empty>No customers found.</Empty>
      ) : (
        <>
          <Table head={<><th className={th}>Name</th><th className={th}>Phone</th><th className={th}>Telegram</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Spent</th></>}>
            {list.data.items.map((c) => (
              <tr key={c.id} className="hover:bg-raised/40">
                <td className={td}>
                  <Link to={`/admin/customers/${c.id}`} className="font-semibold text-yellow hover:underline">{c.name}</Link>
                  {c.role === 'ADMIN' && <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-[11px] font-bold text-muted">Admin</span>}
                  {c.disabled && <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">Disabled</span>}
                </td>
                <td className={`${td} tabular-nums`}>{formatPhone(c.phone)}</td>
                <td className={`${td} text-muted`}>{c.telegramUsername ? `@${c.telegramUsername}` : '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{c.orderCount}</td>
                <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(c.totalSpentCents)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  );
}
