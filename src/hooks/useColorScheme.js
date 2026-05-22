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

// Applies the effective color scheme on document.documentElement.
// Listens to the system prefers-color-scheme media query when effective === 'auto',
// and to the `frontdoor:branding-updated` window event so the Customization page
// can broadcast a new tenant default without a reload.
//
// Dark mode is a beta feature gated by the `enableDarkModeBeta` tenant setting.
// When the flag is off, both the tenant default and the user override are
// ignored and the effective scheme is forced to 'light' — so accidentally
// stored preferences (or a tenant default leftover from when the flag was on)
// cannot affect users until an admin re-enables the feature.
export function useColorScheme(preferredColorScheme) {
  const [brandingScheme, setBrandingScheme] = useState(DEFAULT_COLOR_SCHEME);
  const [betaEnabled, setBetaEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (cancelled) return;
        setBrandingScheme(normalizeColorScheme(res.data?.branding?.defaultColorScheme));
        setBetaEnabled(res.data?.branding?.enableDarkModeBeta === true);
      })
      .catch(() => {
        if (cancelled) return;
        setBrandingScheme(DEFAULT_COLOR_SCHEME);
        setBetaEnabled(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onBrandingUpdated = (event) => {
      setBrandingScheme(normalizeColorScheme(event.detail?.defaultColorScheme));
      setBetaEnabled(event.detail?.enableDarkModeBeta === true);
    };
    window.addEventListener('frontdoor:branding-updated', onBrandingUpdated);
    return () => window.removeEventListener('frontdoor:branding-updated', onBrandingUpdated);
  }, []);

  const effective = betaEnabled
    ? resolveAppColorScheme(preferredColorScheme, brandingScheme)
    : 'light';

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

  return { effective, brandingScheme, betaEnabled };
}
