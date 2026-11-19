import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { displayStatus, StatusBadge } from './StatusBadge';

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
