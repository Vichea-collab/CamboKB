import { beforeEach, describe, expect, it } from 'vitest';
import { useLang } from './i18n';
import { categoryName, dictionaries, t } from './strings';

/** Same keys, same list lengths, no empty text: what the type checker cannot see inside arrays. */
function compare(en: unknown, km: unknown, path: string, problems: string[]) {
  if (typeof en === 'function') {
    if (typeof km !== 'function') problems.push(`${path}: km is not a function`);
  } else if (Array.isArray(en)) {
    if (!Array.isArray(km) || km.length !== en.length) problems.push(`${path}: list length differs`);
    else en.forEach((e, i) => compare(e, km[i], `${path}[${i}]`, problems));
  } else if (en && typeof en === 'object') {
    const k = (km ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(en)) {
      if (!(key in k)) problems.push(`${path}.${key}: missing in km`);
      else compare((en as Record<string, unknown>)[key], k[key], `${path}.${key}`, problems);
    }
    for (const key of Object.keys(k)) if (!(key in en)) problems.push(`${path}.${key}: only in km`);
  } else if (typeof km !== 'string' || km.trim() === '') problems.push(`${path}: km text is empty`);
}

describe('translations', () => {
  beforeEach(() => {
    localStorage.clear();
    useLang.getState().setLang('en');
  });

  it('English and Khmer have the same shape', () => {
    const problems: string[] = [];
    compare(dictionaries.en, dictionaries.km, 't', problems);
    expect(problems).toEqual([]);
  });

  it('keeps placeholders and brand terms in the Khmer text of functions', () => {
    expect(dictionaries.km.product.added('Mouse')).toContain('Mouse');
    expect(dictionaries.km.home.count(3)).toContain('3');
    expect(dictionaries.km.nav.cartLabel(2)).toContain('2');
  });

  it('follows the chosen language', () => {
    expect(t.product.addToCart).toBe('Add to cart');
    useLang.getState().setLang('km');
    expect(t.product.addToCart).toBe(dictionaries.km.product.addToCart);
    expect(t.product.addToCart).not.toBe('Add to cart');
    expect(document.documentElement.lang).toBe('km');
  });

  it('remembers the choice', () => {
    useLang.getState().setLang('km');
    expect(localStorage.getItem('cambo.lang')).toBe('km');
  });

  it('translates known categories and leaves unknown ones as stored', () => {
    useLang.getState().setLang('km');
    expect(categoryName('mice', 'Mice')).toBe(dictionaries.km.categories.mice);
    expect(categoryName('new-thing', 'New thing')).toBe('New thing');
  });
});
