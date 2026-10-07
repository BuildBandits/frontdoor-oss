import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

// The SPA keeps the window scroll position across route changes, so a link
// clicked low on one page opened the next page already scrolled down.
// Links with a #hash keep their own scrolling (e.g. Customization sections),
// and back/forward navigation is left alone.
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (hash || navigationType === 'POP') return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);

  return null;
}
