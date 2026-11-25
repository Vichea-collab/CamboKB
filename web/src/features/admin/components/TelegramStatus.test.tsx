import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../shared/lib/api')>()),
  api: vi.fn(),
}));
import { api } from '../../../shared/lib/api';
import { TelegramStatus } from './TelegramStatus';

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TelegramStatus />
    </QueryClientProvider>,
  );

describe('Telegram status', () => {
  it('keeps its place with a skeleton while it loads', () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    const { container } = show();
    expect(container.querySelectorAll('.bone').length).toBeGreaterThan(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is replaced by the status', async () => {
    vi.mocked(api).mockResolvedValue({
      serviceReachable: true,
      waitingForService: { pending: 0, failed: 0 },
      mode: 'webhook',
      botConfigured: true,
      adminChatSet: true,
      alertsOn: true,
      outbox: { pending: 0, failed: 0, oldestPendingAgeSec: null, lastError: null },
    });
    const { container } = show();
    expect(await screen.findByText('Telegram is connected')).toBeInTheDocument();
    expect(container.querySelector('.bone')).toBeNull();
  });

  it('goes away when the status cannot be read', async () => {
    vi.mocked(api).mockRejectedValue(new Error('down'));
    const { container } = show();
    await vi.waitFor(() => expect(container.querySelector('.bone')).toBeNull());
  });
});
