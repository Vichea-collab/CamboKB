import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DatePicker } from './DatePicker';

function Harness({
  initial = '2026-11-20',
  min,
  max,
  allowClear,
}: {
  initial?: string;
  min?: string;
  max?: string;
  allowClear?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DatePicker
      aria-label="Day"
      value={value}
      onChange={setValue}
      min={min}
      max={max}
      allowClear={allowClear}
    />
  );
}
const field = () => screen.getByRole('button', { name: 'Day' });

describe('DatePicker (a calendar in a bottom sheet)', () => {
  it('shows the chosen day, or the placeholder when there is none', () => {
    const { unmount } = render(<Harness />);
    expect(field()).toHaveTextContent('20 Nov 2026');
    unmount();
    render(<Harness initial="" />);
    expect(field()).toHaveTextContent('Select date');
  });

  it('opens on the month of the value and picks a day', async () => {
    render(<Harness />);
    await userEvent.click(field());
    expect(screen.getByRole('dialog', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '5 November 2026' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field()).toHaveTextContent('5 Nov 2026');
  });

  it('moves between months, across the year end', async () => {
    render(<Harness initial="2026-12-15" />);
    await userEvent.click(field());
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('January 2027')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('November 2026')).toBeInTheDocument();
  });

  it('does not let a day outside min and max be picked', async () => {
    render(<Harness min="2026-11-10" max="2026-11-25" />);
    await userEvent.click(field());
    expect(screen.getByRole('button', { name: '9 November 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '10 November 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '26 November 2026' })).toBeDisabled();
  });

  it('clears the date, unless a date is always needed', async () => {
    const { unmount } = render(<Harness />);
    await userEvent.click(field());
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(field()).toHaveTextContent('Select date');
    unmount();
    render(<Harness allowClear={false} />);
    await userEvent.click(field());
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});
