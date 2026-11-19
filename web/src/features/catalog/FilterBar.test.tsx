import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLang } from '../../shared/lib/i18n';
import { FilterBar, type SortKey } from './FilterBar';

const categories = [{ id: 'c1', slug: 'mice', name: 'Mice' }];
const setup = (sort: SortKey = 'featured') => {
  const onSort = vi.fn();
  render(<FilterBar categories={categories as never} category="" onCategory={vi.fn()} sort={sort} onSort={onSort} />);
  return { onSort, openSheet: () => userEvent.click(screen.getByRole('button', { name: 'Sort' })) };
};

describe('sorting on a phone', () => {
  beforeEach(() => {
    localStorage.clear();
    useLang.getState().setLang('en');
  });

  it('opens a bottom sheet with every option, and marks the current one', async () => {
    const { openSheet } = setup('price-asc');
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Sort' });
    const options = within(sheet).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(['Featured', 'Price: low to high', 'Price: high to low']);
    expect(within(sheet).getByRole('radio', { name: 'Price: low to high' })).toBeChecked();
  });

  it('sorts and closes the sheet when an option is chosen', async () => {
    const { onSort, openSheet } = setup();
    await openSheet();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Price: high to low' }));
    expect(onSort).toHaveBeenCalledWith('price-desc');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a dot on the button while a sort other than the default is on', () => {
    setup('price-desc');
    expect(screen.getByRole('button', { name: 'Sort' }).querySelector('[data-active-sort]')).not.toBeNull();
  });

  it('keeps the plain labelled dropdown for tablets and desktops', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Sort' })).toBeInTheDocument();
  });
});
