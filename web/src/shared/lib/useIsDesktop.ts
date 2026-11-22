import { useEffect, useState } from 'react';

const QUERY = '(min-width: 768px)';

/** True on screens at least 768px wide (the Tailwind `md` size). Without matchMedia (old browsers, tests) it is false. */
export function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}
