import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('a');
  return <Select aria-label="Letter" value={value} onChange={setValue} options={OPTIONS} disabled={disabled} />;
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
