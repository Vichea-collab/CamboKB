import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('a');
  return (
    <Select
      aria-label="Letter"
      value={value}
      onChange={setValue}
      options={OPTIONS}
      disabled={disabled}
    />
  );
}

describe('Select (a dropdown that opens as a bottom sheet)', () => {
  it('shows the chosen option and keeps the list closed until it is tapped', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Alpha');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a sheet with every option, marks the current one, and closes after a pick', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    expect(screen.getByRole('dialog', { name: 'Letter' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Beta' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Beta');
  });

  it('closes on Escape without changing the value', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Alpha');
  });

  it('does not open when disabled', async () => {
    render(<Harness disabled />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Select on a desktop screen (a dropdown under the button)', () => {
  const asDesktop = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  afterEach(() => vi.unstubAllGlobals());

  it('opens a list, not a sheet, marks the current option and closes after a pick', async () => {
    asDesktop();
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Letter' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Beta');
  });

  it('closes on Escape and on a click outside, without changing the value', async () => {
    asDesktop();
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Alpha');
  });

  it('moves between options with the arrow keys', async () => {
    asDesktop();
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Letter' }));
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus();
  });
});
