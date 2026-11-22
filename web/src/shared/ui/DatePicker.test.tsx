import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('DatePicker on a desktop screen (a calendar under the field)', () => {
  const asDesktop = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  afterEach(() => vi.unstubAllGlobals());

  it('opens a small calendar, not a sheet, and closes after a pick', async () => {
    asDesktop();
    render(<Harness />);
    await userEvent.click(field());
    const calendar = screen.getByRole('dialog', { name: 'Day' });
    expect(calendar.parentElement).toBe(document.body);
    await userEvent.click(screen.getByRole('button', { name: '12 November 2026' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field()).toHaveTextContent('12 Nov 2026');
  });

  it('closes on Escape and on a click outside', async () => {
    asDesktop();
    render(<Harness />);
    await userEvent.click(field());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(field());
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
