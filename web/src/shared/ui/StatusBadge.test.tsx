import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { displayStatus, PaymentBadge, StatusBadge } from './StatusBadge';

describe('order status badge', () => {
  it('shows "Expired", not "Cancelled", for an order closed because its payment ran out', () => {
    render(<StatusBadge status="CANCELLED" payment="EXPIRED" />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
  });

  it('still says "Cancelled" for an order a person cancelled', () => {
    render(<StatusBadge status="CANCELLED" payment="UNPAID" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('says "Cancelled" when there is no payment information', () => {
    render(<StatusBadge status="CANCELLED" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('leaves every other status alone, whatever the payment says', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'])
      expect(displayStatus(status, 'EXPIRED')).toBe(status);
  });
});

describe('payment badge', () => {
  it('says cash on delivery is unpaid until it is collected, and paid after', () => {
    const { rerender } = render(<PaymentBadge payment={{ method: 'COD', status: 'UNPAID' }} />);
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument();
    rerender(<PaymentBadge payment={{ method: 'COD', status: 'PAID' }} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('says a KHQR order is paid, waiting, or failed', () => {
    const { rerender } = render(<PaymentBadge payment={{ method: 'KHQR', status: 'PAID' }} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('KHQR')).toBeInTheDocument();
    rerender(<PaymentBadge payment={{ method: 'KHQR', status: 'PENDING' }} />);
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    rerender(<PaymentBadge payment={{ method: 'KHQR', status: 'FAILED' }} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows a dash when there is no payment, and can hide the method', () => {
    const { rerender } = render(<PaymentBadge payment={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<PaymentBadge payment={{ method: 'KHQR', status: 'PAID' }} showMethod={false} />);
    expect(screen.queryByText('KHQR')).not.toBeInTheDocument();
  });
});
