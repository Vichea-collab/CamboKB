import { useEffect } from 'react';
import { t } from './strings';

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${t.brand.name}` : t.brand.name;
  }, [title]);
}
