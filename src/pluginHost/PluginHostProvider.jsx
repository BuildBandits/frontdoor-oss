import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import { bootstrapPlugins } from './bootstrap';
import { clearPluginRegistry } from './registry';
import {
  PLUGIN_LIFECYCLE_EVENT,
  PLUGIN_LIFECYCLE_STORAGE_KEY,
} from './lifecycle';

export const PluginRuntimeContext = createContext(null);

export function usePluginRuntimeApi() {
  return useContext(PluginRuntimeContext);
}

export default function PluginHostProvider({ children }) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);
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
    pluginsEnabled: pluginsEnabled && Boolean(currentUser),
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
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('External plugin URLs must use HTTPS without embedded credentials');
      }
      const safeTarget = target === '_self' ? '_self' : '_blank';
      window.open(parsed.href, safeTarget, 'noopener,noreferrer');
    },
  }), [navigate, pluginsEnabled, currentUser]);

  useEffect(() => {
    if (!runtimeApi.pluginsEnabled) {
      void clearPluginRegistry('disabled');
      delete window.__frontdoorPluginBootstrapPromise;
      return undefined;
    }

    void bootstrapPlugins(runtimeApi);
  }, [runtimeApi]);

  useEffect(() => {
    let cancelled = false;

    const applyLifecycleUpdate = async (detail = {}) => {
      if (detail.kind === 'branding') {
        try {
          const response = await api.get('/branding');
          if (!cancelled) {
            brandingRef.current = response.data?.branding || null;
            setPluginsEnabled(brandingRef.current?.pluginsEnabled === true);
          }
        } catch {
          if (!cancelled) setPluginsEnabled(false);
        }
        return;
      }

      delete window.__frontdoorPluginBootstrapPromise;
      await clearPluginRegistry(detail.reason || 'registry-updated');
      if (!cancelled && runtimeApi.pluginsEnabled) {
        await bootstrapPlugins(runtimeApi);
      }
    };

    const onLifecycleUpdate = (event) => {
      void applyLifecycleUpdate(event.detail || {});
    };
    const onStorage = (event) => {
      if (event.key !== PLUGIN_LIFECYCLE_STORAGE_KEY || !event.newValue) return;
      try {
        void applyLifecycleUpdate(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed cross-tab lifecycle messages.
      }
    };

    window.addEventListener(PLUGIN_LIFECYCLE_EVENT, onLifecycleUpdate);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(PLUGIN_LIFECYCLE_EVENT, onLifecycleUpdate);
      window.removeEventListener('storage', onStorage);
    };
  }, [runtimeApi]);

  useEffect(() => () => {
    delete window.__frontdoorPluginBootstrapPromise;
    void clearPluginRegistry('provider-unmount');
  }, []);

  return (
    <PluginRuntimeContext.Provider value={runtimeApi}>
      {children}
    </PluginRuntimeContext.Provider>
  );
}
