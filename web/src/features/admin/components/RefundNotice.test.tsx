import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RefundNotice } from './RefundNotice';

describe('refund notice on a cancelled order that was paid', () => {
  it('says how much to send back, and marks it refunded when the shop has done it', async () => {
    const onRefunded = vi.fn();
    render(<RefundNotice amountCents={4400} busy={false} onRefunded={onRefunded} />);
    expect(screen.getByText(/paid \$44/i)).toBeInTheDocument();
    expect(screen.getByText(/send the money back/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark as refunded' }));
    expect(onRefunded).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed twice while saving', () => {
    render(<RefundNotice amountCents={4400} busy onRefunded={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark as refunded' })).toBeDisabled();
  });
});
