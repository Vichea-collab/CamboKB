import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../../shared/lib/ui-store';
import { WishlistButton } from './WishlistButton';
import { useWishlist } from './wishlist-store';

const P = { id: '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11', name: 'Aula F75' };

describe('WishlistButton', () => {
  beforeEach(() => useWishlist.setState({ ids: [] }));

  it('saves and removes with the heart, and says which it will do', async () => {
    render(<WishlistButton product={P} />);
    const heart = screen.getByRole('button', { name: 'Save Aula F75 to your wishlist' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(heart);
    expect(useWishlist.getState().ids).toEqual([P.id]);
    const saved = screen.getByRole('button', { name: 'Remove Aula F75 from your wishlist' });
    expect(saved).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(saved);
    expect(useWishlist.getState().ids).toEqual([]);
  });

  it('shows a toast when adding, not when removing', async () => {
    render(<WishlistButton product={P} />);
    await userEvent.click(screen.getByRole('button'));
    expect(useUi.getState().toast).toMatchObject({ text: 'Saved Aula F75' });
    useUi.setState({ toast: null });
    await userEvent.click(screen.getByRole('button'));
    expect(useUi.getState().toast).toBeNull();
  });

  it('the page variant has a visible label', async () => {
    render(<WishlistButton product={P} variant="page" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
  });
});
