import { useEffect, useState } from 'react';
import api from '../services/api';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  resolveAppLanguage,
} from '../i18n';

function applyDocumentLanguage(language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = normalizeLanguage(language);
}

// Keeps the <html lang> attribute in sync with the language the UI is actually
// rendered in, so screen readers (JAWS, NVDA, VoiceOver) pick the correct speech
// synthesis voice. Without this the attribute stays on the static index.html value
// while the content switches language — a WCAG 3.1.1 violation.
export function useDocumentLanguage(preferredLanguage) {
  const [brandingLanguage, setBrandingLanguage] = useState(DEFAULT_LANGUAGE);

  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (cancelled) return;
        setBrandingLanguage(normalizeLanguage(res.data?.branding?.defaultLanguage));
      })
      .catch(() => {
        if (cancelled) return;
        setBrandingLanguage(DEFAULT_LANGUAGE);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onBrandingUpdated = (event) => {
      setBrandingLanguage(normalizeLanguage(event.detail?.defaultLanguage));
    };
    window.addEventListener('frontdoor:branding-updated', onBrandingUpdated);
    return () => window.removeEventListener('frontdoor:branding-updated', onBrandingUpdated);
  }, []);

  const effective = resolveAppLanguage(preferredLanguage, brandingLanguage);

  useEffect(() => {
    applyDocumentLanguage(effective);
  }, [effective]);

  return { effective, brandingLanguage };
}
