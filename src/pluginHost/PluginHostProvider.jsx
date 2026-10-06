import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import { bootstrapPlugins } from './bootstrap';
import { clearPluginRegistry } from './registry';

export const PluginRuntimeContext = createContext(null);

export function usePluginRuntimeApi() {
  return useContext(PluginRuntimeContext);
}

export default function PluginHostProvider({ children }) {
  const navigate = useNavigate();
  const brandingRef = useRef(null);
  const [pluginsEnabled, setPluginsEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api.get('/branding')
      .then((res) => {
        if (!cancelled) {
          brandingRef.current = res.data?.branding || null;
          setPluginsEnabled(brandingRef.current?.pluginsEnabled === true);
          window.dispatchEvent(new CustomEvent('frontdoor:plugin-branding-updated', {
            detail: brandingRef.current,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          brandingRef.current = null;
          setPluginsEnabled(false);
        }
      });

    const onBrandingUpdated = (event) => {
      brandingRef.current = event.detail || null;
      setPluginsEnabled(brandingRef.current?.pluginsEnabled === true);
    };

    window.addEventListener('frontdoor:branding-updated', onBrandingUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('frontdoor:branding-updated', onBrandingUpdated);
    };
  }, []);

  const runtimeApi = useMemo(() => ({
    apiVersion: 1,
    pluginsEnabled,
    getCurrentUser: () => useAuthStore.getState().user || null,
    getBranding: () => brandingRef.current,
    getLanguage: () => resolveAppLanguage(
      useAuthStore.getState().user?.preferredLanguage,
      brandingRef.current?.defaultLanguage
    ),
    getUiStrings: () => getUiStrings(
      resolveAppLanguage(
        useAuthStore.getState().user?.preferredLanguage,
        brandingRef.current?.defaultLanguage
      )
    ),
    navigate: (to, options = {}) => navigate(to, options),
    notify: (payload) => {
      window.dispatchEvent(new CustomEvent('frontdoor:plugin-notify', { detail: payload }));
    },
    openExternalUrl: (url, target = '_blank') => {
      window.open(url, target, 'noopener,noreferrer');
    },
  }), [navigate, pluginsEnabled]);

  useEffect(() => {
    if (!runtimeApi.pluginsEnabled) {
      clearPluginRegistry();
      delete window.__frontdoorPluginBootstrapPromise;
      return undefined;
    }

    void bootstrapPlugins(runtimeApi);
  }, [runtimeApi]);

  return (
    <PluginRuntimeContext.Provider value={runtimeApi}>
      {children}
    </PluginRuntimeContext.Provider>
  );
}
