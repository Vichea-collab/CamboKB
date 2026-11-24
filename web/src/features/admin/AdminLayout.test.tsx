import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
vi.mock('./useAdminLive', () => ({ useAdminLive: () => true }));
import { api } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { AdminLayout } from './AdminLayout';

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout>page</AdminLayout>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('admin frame', () => {
  beforeEach(() =>
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === '/auth/session' ? { user: { id: '1', name: 'Dara', role: 'ADMIN' } } : {},
    ),
  );

  it('carries the same shop name as the shop, on phones and on desktops', () => {
    show();
    expect(t.brand.name).toBe('Cambo Keyboard Supply');
    const links = screen.getAllByRole('link', { name: `${t.brand.name} Admin` });
    expect(links).toHaveLength(2);
    links.forEach((l) => expect(l).toHaveAttribute('href', '/admin'));
  });

  it('keeps its phone menu clear of the iPhone browser’s floating buttons', () => {
    show();
    const bar = screen.getAllByRole('navigation', { name: 'Admin' }).find((n) => n.className.includes('fixed'));
    expect(bar).toHaveClass('bottom-bar');
  });
});
