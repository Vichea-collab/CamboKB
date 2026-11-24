import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: vi.fn() }));
import { api } from '../lib/api';
import { RequireAdmin, RequireAuth } from '../../features/auth/auth';
import { useLang } from '../lib/i18n';
import { LoadingState, SKELETON_SHAPES } from './Skeleton';

describe('loading skeletons', () => {
  it.each(SKELETON_SHAPES)('%s: says it is loading, once, and hides the drawing from screen readers', (shape) => {
    const { container } = render(<LoadingState shape={shape} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/^Loading…?$|^Loading\.\.\.$/);
    const bones = container.querySelectorAll('.bone');
    expect(bones.length).toBeGreaterThan(2);
    bones.forEach((b) => expect(b.closest('[aria-hidden="true"]')).not.toBeNull());
  });

  it.each(SKELETON_SHAPES)('%s: has no spinner, and nothing a keyboard can land on', (shape) => {
    const { container } = render(<LoadingState shape={shape} />);
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('a, button, input, [tabindex]')).toBeNull();
  });

  it('speaks Khmer when the shop is in Khmer', () => {
    useLang.getState().setLang('km');
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent(/[ក-៿]/);
    useLang.getState().setLang('en');
  });

  it.each([
    ['RequireAuth', RequireAuth],
    ['RequireAdmin', RequireAdmin],
  ])('%s shows the page’s own skeleton while it checks who is logged in', (_name, Guard) => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Guard loading={<LoadingState shape="list" />}>secret</Guard>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('[data-shape="list"]')).not.toBeNull();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});
