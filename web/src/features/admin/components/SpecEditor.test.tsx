import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpecEditor } from './SpecEditor';

const rows = [
  { label: 'Layout', value: '75%' },
  { label: 'Switch', value: 'Linear' },
];

describe('SpecEditor', () => {
  it('adds an empty row', async () => {
    const onChange = vi.fn();
    render(<SpecEditor value={rows} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add spec' }));
    expect(onChange).toHaveBeenCalledWith([...rows, { label: '', value: '' }]);
  });

  it('moves a row up', async () => {
    const onChange = vi.fn();
    render(<SpecEditor value={rows} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Switch up' }));
    expect(onChange).toHaveBeenCalledWith([rows[1], rows[0]]);
  });

  it('removes a row', async () => {
    const onChange = vi.fn();
    render(<SpecEditor value={rows} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Layout' }));
    expect(onChange).toHaveBeenCalledWith([rows[1]]);
  });
});
