import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLang } from '../../shared/lib/i18n';
import { cleanDollars, PriceFilter } from './PriceFilter';

describe('cleanDollars', () => {
  it('keeps whole and two-decimal dollar amounts and drops everything else', () => {
    expect(cleanDollars('25')).toBe('25');
    expect(cleanDollars(' $12.5 ')).toBe('12.5');
    expect(cleanDollars('007')).toBe('7');
    expect(cleanDollars('9.99')).toBe('9.99');
    expect(['', 'abc', '-5', '1.234', '1e3', '1,5'].map(cleanDollars)).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });
});

const setup = (min = '', max = '') => {
  const onApply = vi.fn();
  render(<PriceFilter min={min} max={max} onApply={onApply} />);
  return { onApply, open: () => userEvent.click(screen.getByRole('button', { name: 'Price' })) };
};

describe('price filter on a phone', () => {
  beforeEach(() => {
    localStorage.clear();
    useLang.getState().setLang('en');
  });

  it('opens a sheet with quick picks and applies one in a tap', async () => {
    const { onApply, open } = setup();
    await open();
    const sheet = screen.getByRole('dialog', { name: 'Price' });
    expect(
      within(sheet)
        .getAllByRole('button', { pressed: false })
        .map((b) => b.textContent),
    ).toEqual(['Under $10', '$10 – $25', '$25 – $50', 'Over $50']);
    await userEvent.click(within(sheet).getByRole('button', { name: '$10 – $25' }));
    expect(onApply).toHaveBeenCalledWith('10', '25');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies typed amounts, and swaps them when the low end is higher', async () => {
    const { onApply, open } = setup();
    await open();
    await userEvent.type(screen.getByLabelText('From ($)'), '40');
    await userEvent.type(screen.getByLabelText('To ($)'), '15.5');
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(onApply).toHaveBeenCalledWith('15.5', '40');
  });

  it('ignores text that is not an amount', async () => {
    const { onApply, open } = setup();
    await open();
    await userEvent.type(screen.getByLabelText('From ($)'), 'abc');
    await userEvent.type(screen.getByLabelText('To ($)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(onApply).toHaveBeenCalledWith('', '30');
  });

  it('shows the active range on the button, marks its quick pick, and clears it', async () => {
    const { onApply, open } = setup('10', '25');
    expect(screen.getByRole('button', { name: 'Price' })).toHaveTextContent('$10 – $25');
    await open();
    expect(screen.getByRole('button', { name: '$10 – $25', pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear price' }));
    expect(onApply).toHaveBeenCalledWith('', '');
  });
});

describe('price filter on desktop', () => {
  beforeEach(() => {
    useLang.getState().setLang('en');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens a panel under the button, not a sheet, and closes on Escape', async () => {
    const { onApply, open } = setup();
    await open();
    const panel = screen.getByRole('dialog', { name: 'Price' });
    expect(panel).toHaveStyle({ position: 'fixed' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Over $50' }));
    expect(onApply).toHaveBeenCalledWith('50', '');
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
