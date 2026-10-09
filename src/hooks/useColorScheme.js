import { useEffect } from 'react';
import { useBranding } from '../stores/brandingStore';
import {
  normalizeColorScheme,
  resolveAppColorScheme,
} from '../../shared/colorSchemes.js';

const DARK_CLASS = 'dark';

function applyDarkClass(isDark) {
  const root = document.documentElement;
  if (isDark) root.classList.add(DARK_CLASS);
  else root.classList.remove(DARK_CLASS);
}

function prefersDarkSystem() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function isDarkScheme(effective) {
  if (effective === 'dark') return true;
  if (effective === 'light') return false;
  return prefersDarkSystem();
}

export function useColorScheme(preferredColorScheme) {
  const brandingScheme = normalizeColorScheme(useBranding()?.defaultColorScheme);

  const effective = resolveAppColorScheme(preferredColorScheme, brandingScheme);

  useEffect(() => {
    applyDarkClass(isDarkScheme(effective));

    if (effective !== 'auto' || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => applyDarkClass(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [effective]);

  return { effective, brandingScheme };
}
