import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoleControl } from './RoleControl';

describe('RoleControl', () => {
  it('offers to make a customer an admin', async () => {
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RoleControl role="CUSTOMER" name="Dara" isSelf={false} busy={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    expect(onChange).toHaveBeenCalledWith('ADMIN');
  });

  it('offers to turn an admin back into a customer', async () => {
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RoleControl role="ADMIN" name="Dara" isSelf={false} busy={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make customer' }));
    expect(onChange).toHaveBeenCalledWith('CUSTOMER');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<RoleControl role="CUSTOMER" name="Dara" isSelf={false} busy={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("doesn't let you change your own role", () => {
    render(<RoleControl role="ADMIN" name="Me" isSelf busy={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText("This is you. Another admin can change your role.")).toBeInTheDocument();
  });
});
