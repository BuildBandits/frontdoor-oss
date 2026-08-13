import api from '../services/api';
import { addPluginLoadError, loadPluginBundle, setPluginBootstrapState } from './registry';

function inferPluginIdFromUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    const fileName = parsed.pathname.split('/').filter(Boolean).pop() || 'plugin';
    return fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase() || 'plugin';
  } catch {
    return 'plugin';
  }
}

async function loadModuleFromUrl(url) {
  const parsed = new URL(url, window.location.origin);
  if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/plugins/files/')) {
    throw new Error('Plugin modules must use an authenticated same-origin artifact URL');
  }
  const module = await import(/* @vite-ignore */ parsed.href);
  const defaultExport = module.default;
  return {
    manifest: module.manifest
      || (defaultExport && typeof defaultExport === 'object' ? defaultExport.manifest : null)
      || {},
    register: module.register
      || (defaultExport && typeof defaultExport === 'object' ? defaultExport.register : null)
      || (typeof defaultExport === 'function' ? defaultExport : null),
    onUnload: module.onUnload
      || (defaultExport && typeof defaultExport === 'object' ? defaultExport.onUnload : null)
      || null,
  };
}

async function loadServerPlugins(runtimeApi) {
  try {
    const response = await api.get('/plugins/runtime');
    const plugins = Array.isArray(response.data?.plugins) ? response.data.plugins : [];

    for (const pluginDefinition of plugins) {
      try {
        if (!pluginDefinition.entry) {
          throw new Error(`Plugin ${pluginDefinition.id || pluginDefinition.manifest?.id || 'unknown'} is missing an entry URL`);
        }

        const pluginModule = await loadModuleFromUrl(pluginDefinition.entry);
        await loadPluginBundle({
          manifest: pluginDefinition.manifest || {},
          register: pluginModule.register,
          onUnload: pluginModule.onUnload,
        }, runtimeApi, {
          id: pluginDefinition.manifest?.id || pluginDefinition.id || inferPluginIdFromUrl(pluginDefinition.entry),
          name: pluginDefinition.manifest?.name || pluginDefinition.name || inferPluginIdFromUrl(pluginDefinition.entry),
          source: pluginDefinition.source || 'server',
          entry: pluginDefinition.entry,
        });
      } catch (error) {
        addPluginLoadError({
          source: pluginDefinition.source || pluginDefinition.entry || pluginDefinition.id || 'server',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    addPluginLoadError({
      source: '/api/plugins/runtime',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function bootstrapPlugins(runtimeApi = {}) {
  if (runtimeApi.pluginsEnabled !== true) {
    setPluginBootstrapState({ bootstrapping: false, bootstrapped: false });
    return;
  }

  if (window.__frontdoorPluginBootstrapPromise) {
    return window.__frontdoorPluginBootstrapPromise;
  }

  const promise = (async () => {
    setPluginBootstrapState({ bootstrapping: true });

    await loadServerPlugins(runtimeApi);

    if (
      import.meta.env.DEV
      && String(import.meta.env.VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN || '').toLowerCase() === 'true'
    ) {
      try {
        const samplePlugin = await import('../plugins/examples/ticketPlugin');
        await loadPluginBundle(samplePlugin, runtimeApi, {
          id: samplePlugin.manifest?.id || 'ticket-plugin',
          name: samplePlugin.manifest?.name || 'Ticket Plugin',
          source: 'builtin',
        });
      } catch (error) {
        addPluginLoadError({
          source: 'builtin:ticket-plugin',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setPluginBootstrapState({ bootstrapping: false, bootstrapped: true });
  })();

  window.__frontdoorPluginBootstrapPromise = promise;
  return promise;
}
