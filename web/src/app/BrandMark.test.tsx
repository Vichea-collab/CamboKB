import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './Header';

const wordmark = () => screen.getByText('Supply').parentElement!.parentElement!;

describe('brand mark in a crowded phone header', () => {
  it('normally keeps the name next to the logo (it only gives way on the very narrowest screens)', () => {
    render(
      <MemoryRouter>
        <BrandMark />
      </MemoryRouter>,
    );
    expect(wordmark().className).toContain('max-[339px]:sr-only');
    expect(wordmark().className).not.toContain('max-[429px]:sr-only');
  });

  it('shows only the logo on phones when the header also carries the account, orders and cart buttons', () => {
    render(
      <MemoryRouter>
        <BrandMark compact />
      </MemoryRouter>,
    );
    expect(wordmark().className).toContain('max-[429px]:sr-only');
    // Still a labelled link for screen readers, and the name stays in the page for them.
    expect(screen.getByRole('link', { name: 'Cambo Keyboard Supply home' })).toHaveAttribute('href', '/');
  });
});
