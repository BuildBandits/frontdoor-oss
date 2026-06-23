import { useEffect, useState } from 'react';
import api from '../services/api';
import {
  DEFAULT_COLOR_SCHEME,
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
  const [brandingScheme, setBrandingScheme] = useState(DEFAULT_COLOR_SCHEME);

  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (cancelled) return;
        setBrandingScheme(normalizeColorScheme(res.data?.branding?.defaultColorScheme));
      })
      .catch(() => {
        if (cancelled) return;
        setBrandingScheme(DEFAULT_COLOR_SCHEME);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onBrandingUpdated = (event) => {
      setBrandingScheme(normalizeColorScheme(event.detail?.defaultColorScheme));
    };
    window.addEventListener('frontdoor:branding-updated', onBrandingUpdated);
    return () => window.removeEventListener('frontdoor:branding-updated', onBrandingUpdated);
  }, []);

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
