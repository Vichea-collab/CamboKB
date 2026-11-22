import { Heart } from 'lucide-react';
import { t } from '../../shared/lib/strings';
import { useUi } from '../../shared/lib/ui-store';
import { useWishlist } from './wishlist-store';

/**
 * The heart. `card` is a round button laid over a product photo; `page` is a button with a label.
 * Keeps no state of its own: a pressed button means the product is on the wishlist.
 */
export function WishlistButton({
  product,
  variant = 'card',
  className = '',
}: {
  product: { id: string; name: string };
  variant?: 'card' | 'page';
  className?: string;
}) {
  const saved = useWishlist((s) => s.ids.includes(product.id));
  const toggle = useWishlist((s) => s.toggle);
  const showToast = useUi((s) => s.showToast);
  const onClick = () => {
    if (toggle(product.id)) showToast(t.wishlist.addedToast(product.name));
  };
  const heart = (
    <Heart
      className={`size-5 transition-colors ${saved ? 'fill-current text-danger' : ''}`}
      strokeWidth={2.2}
      aria-hidden
    />
  );
  if (variant === 'page') {
    return (
      <button
        type="button"
        aria-pressed={saved}
        onClick={onClick}
        className={`btn-ghost min-h-11 gap-2 px-4 ${className}`}
      >
        {heart}
        {saved ? t.wishlist.saved : t.wishlist.save}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? t.wishlist.remove(product.name) : t.wishlist.add(product.name)}
      onClick={onClick}
      className={`grid size-10 place-items-center rounded-full bg-bg/80 text-ink ring-1 ring-line backdrop-blur-sm transition hover:bg-bg focus-visible:outline-offset-2 ${className}`}
    >
      {heart}
    </button>
  );
}
