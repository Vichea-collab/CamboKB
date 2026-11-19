import { create } from 'zustand';

export type Lang = 'en' | 'km';

const KEY = 'cambo.lang';

/** Saved choice first; otherwise Khmer for browsers set to Khmer, English for everyone else. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'km') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('km')
    ? 'km'
    : 'en';
}

const applyToDocument = (lang: Lang) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
};

type LangState = { lang: Lang; setLang: (lang: Lang) => void };

export const useLang = create<LangState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* the choice just won't be remembered */
    }
    applyToDocument(lang);
    set({ lang });
  },
}));

applyToDocument(useLang.getState().lang);

/**
 * Read outside React (dictionary lookups, date formatting). The admin area is English-only for now,
 * so it ignores the shop language and a Khmer choice never leaks into it half-translated.
 */
export const currentLang = (): Lang =>
  typeof location !== 'undefined' && location.pathname.startsWith('/admin')
    ? 'en'
    : useLang.getState().lang;

/** BCP 47 locale for Intl, with Latin digits so prices and dates read the same in both languages. */
export const intlLocale = (): string => (currentLang() === 'km' ? 'km-KH-u-nu-latn' : 'en-GB');
