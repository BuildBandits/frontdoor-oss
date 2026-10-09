import { useEffect } from 'react';
import { create } from 'zustand';
import api from '../services/api';
import { normalizeLanguage } from '../i18n';
import { normalizeTimeZone } from '../../shared/timeZones.js';

const STORAGE_KEY = 'frontdoor_branding';

// The last branding seen in this browser (public settings only), so the first paint
// already uses the default language and color scheme instead of switching later.
function readCachedBranding() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return cached && typeof cached === 'object' ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedBranding(branding) {
  try {
    if (branding) localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the store still works for this page load.
  }
}

let pendingLoad = null;

export const useBrandingStore = create((set, get) => ({
  branding: readCachedBranding(),
  // True once the server answered (or Customization saved); false while only the cache is known.
  loaded: false,
  // True when the last request failed (the cached branding or the defaults stay in use).
  failed: false,

  // One request per page load, shared by every component that needs branding.
  // `force` refetches (for example after another tab changed it).
  load: ({ force = false } = {}) => {
    if (!force && get().loaded) return Promise.resolve(get().branding);
    if (!force && pendingLoad) return pendingLoad;
    const request = api.get('/branding')
      .then((res) => {
        if (pendingLoad === request) get().setBranding(res.data?.branding || null);
        return get().branding;
      })
      // Keep the cached branding (or the built-in defaults) when the request fails;
      // `loaded` stays false, so the next component that needs branding tries again.
      .catch(() => {
        if (pendingLoad === request) set({ failed: true });
        return get().branding;
      })
      .finally(() => {
        if (pendingLoad === request) pendingLoad = null;
      });
    pendingLoad = request;
    return request;
  },

  // Called with the saved settings after Customization updates them.
  setBranding: (branding) => {
    pendingLoad = null; // an older response still in flight must not overwrite this
    writeCachedBranding(branding);
    set({ branding, loaded: true, failed: false });
  },
}));

function useLoadBranding() {
  const load = useBrandingStore((state) => state.load);
  useEffect(() => {
    void load();
  }, [load]);
}

/** Public branding settings, loaded once and shared; null until known. */
export function useBranding() {
  useLoadBranding();
  return useBrandingStore((state) => state.branding);
}

/** Default UI language from branding ('en' until known). */
export function useBrandingLanguage() {
  useLoadBranding();
  return useBrandingStore((state) => normalizeLanguage(state.branding?.defaultLanguage));
}

/** Default time zone from branding ('UTC' until known). */
export function useBrandingTimeZone() {
  useLoadBranding();
  return useBrandingStore((state) => normalizeTimeZone(state.branding?.defaultTimeZone, 'UTC'));
}
