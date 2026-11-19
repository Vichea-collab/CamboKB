import { formatPhone, formatUsdExact } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/lib/api';
import type { Paged } from '../../shared/lib/types';
import { Search, Users } from 'lucide-react';
import { Badge, EmptyState } from '../../shared/ui/Page';
import { Loading, PageHeader, Table, td, th } from './components/ui';
import { Pager } from './Orders';
import type { Customer } from './types';

export default function Customers() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'customers', query, page],
    queryFn: () =>
      api<Paged<Customer>>(
        `/admin/customers?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Customers" />
      <form
        className="relative mb-5 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          className="field pl-10"
          type="search"
          enterKeyHint="search"
          placeholder="Name, phone or Telegram username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search customers"
        />
      </form>
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? 'No customers match your search' : 'No customers yet'}
        />
      ) : (
        <>
          <Table
            head={
              <>
                <th className={th}>Name</th>
                <th className={th}>Phone</th>
                <th className={th}>Telegram</th>
                <th className={`${th} text-right`}>Orders</th>
                <th className={`${th} text-right`}>Spent (delivered)</th>
              </>
            }
          >
            {list.data.items.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-raised/40">
                <td className={td}>
                  <span className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/customers/${c.id}`} className="link">
                      {c.name}
                    </Link>
                    {c.role === 'ADMIN' && <Badge tone="yellow">Admin</Badge>}
                    {c.disabled && <Badge tone="danger">Disabled</Badge>}
                  </span>
                </td>
                <td className={`${td} tabular-nums`}>{formatPhone(c.phone)}</td>
                <td className={`${td} text-muted`}>
                  {c.telegramUsername ? `@${c.telegramUsername}` : '—'}
                </td>
                <td className={`${td} text-right tabular-nums`}>{c.orderCount}</td>
                <td className={`${td} text-right font-bold tabular-nums`}>
                  {formatUsdExact(c.totalSpentCents)}
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            page={page}
            total={list.data.total}
            pageSize={list.data.pageSize}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
