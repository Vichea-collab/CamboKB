import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusActions } from './StatusActions';

describe('StatusActions', () => {
  it('offers the next step and cancel for a pending order', () => {
    render(<StatusActions status="PENDING" busy={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Confirm order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });

  it('offers no changes once delivered', () => {
    render(<StatusActions status="DELIVERED" busy={false} onChange={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('cannot cancel once shipping', () => {
    render(<StatusActions status="SHIPPING" busy={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });
});
