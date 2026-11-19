import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useFocusSearch } from './useFocusSearch';

function Page() {
  const ref = useFocusSearch<HTMLInputElement>();
  const { search } = useLocation();
  return (
    <>
      <input ref={ref} aria-label="Search" />
      <output data-testid="url">{search}</output>
    </>
  );
}
const show = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Page />
    </MemoryRouter>,
  );

describe('the Search tab of the bottom bar', () => {
  it('puts the cursor in the search box, and removes the marker from the address', () => {
    show('/?focus=search');
    expect(screen.getByLabelText('Search')).toHaveFocus();
    expect(screen.getByTestId('url').textContent).toBe('');
  });

  it('keeps the rest of the address (a category or sort the customer chose)', () => {
    show('/?category=mice&focus=search');
    expect(screen.getByTestId('url').textContent).toBe('?category=mice');
  });

  it('does nothing on a normal visit', () => {
    show('/?q=mouse');
    expect(screen.getByLabelText('Search')).not.toHaveFocus();
    expect(screen.getByTestId('url').textContent).toBe('?q=mouse');
  });
});
