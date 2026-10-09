import { useEffect } from 'react';
import { useBrandingLanguage } from '../stores/brandingStore';
import {
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
  const brandingLanguage = useBrandingLanguage();

  const effective = resolveAppLanguage(preferredLanguage, brandingLanguage);

  useEffect(() => {
    applyDocumentLanguage(effective);
  }, [effective]);

  return { effective, brandingLanguage };
}
