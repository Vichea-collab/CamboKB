import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The bottom bar's Search tab links to `/?focus=search`. Put the cursor in the search box (which opens the
 * keyboard on a phone), and take the marker out of the address so a reload or a shared link doesn't repeat it.
 */
export function useFocusSearch<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [params, setParams] = useSearchParams();
  const wanted = params.get('focus') === 'search';
  useEffect(() => {
    if (!wanted) return;
    window.scrollTo({ top: 0 });
    ref.current?.focus();
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('focus');
        return next;
      },
      { replace: true },
    );
  }, [wanted, setParams]);
  return ref;
}
