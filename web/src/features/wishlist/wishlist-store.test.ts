import { beforeEach, describe, expect, it } from 'vitest';
import { useWishlist, WISHLIST_MAX } from './wishlist-store';

describe('wishlist store', () => {
  beforeEach(() => useWishlist.setState({ ids: [] }));

  it('saves newest first and removes on a second toggle', () => {
    expect(useWishlist.getState().toggle('a')).toBe(true);
    expect(useWishlist.getState().toggle('b')).toBe(true);
    expect(useWishlist.getState().ids).toEqual(['b', 'a']);
    expect(useWishlist.getState().toggle('a')).toBe(false);
    expect(useWishlist.getState().ids).toEqual(['b']);
  });

  it('keeps at most the limit, dropping the oldest', () => {
    for (let i = 0; i < WISHLIST_MAX + 3; i++) useWishlist.getState().toggle(`p${i}`);
    const { ids } = useWishlist.getState();
    expect(ids).toHaveLength(WISHLIST_MAX);
    expect(ids[0]).toBe(`p${WISHLIST_MAX + 2}`);
    expect(ids).not.toContain('p0');
  });

  it('removes several at once', () => {
    useWishlist.setState({ ids: ['a', 'b', 'c'] });
    useWishlist.getState().removeMany(['a', 'c', 'zzz']);
    expect(useWishlist.getState().ids).toEqual(['b']);
  });
});
