import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCardData } from '../../shared/lib/types';
import { ProductCard } from './ProductCard';

const product = (over: Partial<ProductCardData> = {}): ProductCardData => ({
  id: '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11',
  slug: 'aula-f75',
  name: 'Aula F75 Max Gradient Black',
  specsLine: '75% Layout • Hot-Swap • Multi-Mode',
  priceCents: 6500,
  compareAtCents: null,
  isSoldOut: false,
  category: { slug: 'keyboards', name: 'Keyboards' },
  image: { sm: '/a-400.webp', md: '/a-800.webp', lg: '/a-1200.webp' },
  imageCount: 1,
  ...over,
});

const renderCard = (p: ProductCardData, onAdd = vi.fn()) =>
  render(
    <MemoryRouter>
      <ProductCard product={p} onAdd={onAdd} />
    </MemoryRouter>,
  );

describe('ProductCard', () => {
  it('shows name, specs, price and links to the product page', () => {
    renderCard(product());
    expect(screen.getByText('Aula F75 Max Gradient Black')).toBeInTheDocument();
    expect(screen.getByText('$65')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Aula F75/ })).toHaveAttribute('href', '/products/aula-f75');
  });

  it('adds to cart', async () => {
    const onAdd = vi.fn();
    renderCard(product(), onAdd);
    await userEvent.click(screen.getByRole('button', { name: /Add Aula F75/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11' }));
  });

  it('marks sold-out products and disables Add', () => {
    renderCard(product({ isSoldOut: true }));
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Aula F75/ })).toBeDisabled();
  });

  it('shows the photo count when there are several photos', () => {
    renderCard(product({ imageCount: 4 }));
    expect(screen.getByText('📷 4')).toBeInTheDocument();
  });
});
