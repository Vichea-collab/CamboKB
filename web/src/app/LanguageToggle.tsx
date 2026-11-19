import { Fragment, type ReactNode } from 'react';
import { useLang } from '../shared/lib/i18n';
import { t } from '../shared/lib/strings';

/** One button that shows the language you would switch to: "ខ្មែរ" in English, "EN" in Khmer. */
export function LanguageToggle() {
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  const next = lang === 'en' ? 'km' : 'en';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      className="btn-icon !w-auto min-w-10 px-3 text-[13px] font-bold"
      aria-label={t.lang.switchLabel}
      // The label is in the language you would switch to, so it is read with that language's voice.
      lang={next}
    >
      {t.lang.button}
    </button>
  );
}

/**
 * Strings are read from `t` while rendering, so changing language remounts the tree under this
 * boundary. Cart, session and the URL live outside it and are kept; only unsaved form input is lost.
 */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const lang = useLang((s) => s.lang);
  return <Fragment key={lang}>{children}</Fragment>;
}
