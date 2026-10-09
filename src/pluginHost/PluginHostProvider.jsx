import { createContext, useContext, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useBranding, useBrandingStore } from '../stores/brandingStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import { bootstrapPlugins } from './bootstrap';
import { clearPluginRegistry } from './registry';

export const PluginRuntimeContext = createContext(null);

export function usePluginRuntimeApi() {
  return useContext(PluginRuntimeContext);
}

export default function PluginHostProvider({ children }) {
  const navigate = useNavigate();
  const branding = useBranding();
  // Only the server's answer enables plugins, never the copy cached in the browser.
  const brandingLoaded = useBrandingStore((state) => state.loaded);
  const pluginsEnabled = brandingLoaded && branding?.pluginsEnabled === true;

  // Plugins can listen for branding changes.
  useEffect(() => {
    if (!branding) return;
    window.dispatchEvent(new CustomEvent('frontdoor:plugin-branding-updated', { detail: branding }));
  }, [branding]);

  const runtimeApi = useMemo(() => ({
    apiVersion: 1,
    pluginsEnabled,
    getCurrentUser: () => useAuthStore.getState().user || null,
    getBranding: () => useBrandingStore.getState().branding,
    getLanguage: () => resolveAppLanguage(
      useAuthStore.getState().user?.preferredLanguage,
      useBrandingStore.getState().branding?.defaultLanguage
    ),
    getUiStrings: () => getUiStrings(
      resolveAppLanguage(
        useAuthStore.getState().user?.preferredLanguage,
        useBrandingStore.getState().branding?.defaultLanguage
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
