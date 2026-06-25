import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | Mangaba Vendas" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | Mangaba Vendas`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
