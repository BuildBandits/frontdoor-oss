import {
  PLUGIN_ACCESS,
  PLUGIN_API_VERSION,
  validatePluginPermissions,
  validatePluginRoles,
} from './constants.js';

export function definePlugin(plugin) {
  return {
    apiVersion: PLUGIN_API_VERSION,
    ...plugin,
  };
}

export function definePluginManifest(manifest) {
  return {
    apiVersion: PLUGIN_API_VERSION,
    ...manifest,
  };
}

export function definePluginAction(action) {
  return {
    access: PLUGIN_ACCESS.AUTHENTICATED,
    order: 100,
    kind: 'action',
    ...action,
  };
}

export function definePluginSurface(surface) {
  return {
    access: PLUGIN_ACCESS.AUTHENTICATED,
    order: 100,
    kind: 'surface',
    ...surface,
  };
}

export function definePluginRoute(route) {
  return {
    access: PLUGIN_ACCESS.AUTHENTICATED,
    layout: 'app',
    kind: 'route',
    ...route,
  };
}

export const createPlugin = definePlugin;
export const createPluginManifest = definePluginManifest;
export const createPluginAction = definePluginAction;
export const createPluginSurface = definePluginSurface;
export const createPluginRoute = definePluginRoute;

export function normalizePluginManifest(manifest, fallback = {}) {
  const source = manifest || {};
  const id = String(source.id || fallback.id || '').trim();
  if (!id) {
    throw new Error('Plugin manifest requires an id');
  }

  return {
    apiVersion: source.apiVersion || PLUGIN_API_VERSION,
    id,
    name: String(source.name || fallback.name || id),
    version: String(source.version || fallback.version || '0.0.0'),
    description: source.description || fallback.description || '',
    author: source.author || fallback.author || '',
    homepage: source.homepage || fallback.homepage || '',
    entry: source.entry || fallback.entry || '',
    permissions: validatePluginPermissions(Array.isArray(source.permissions) ? source.permissions : []),
    roles: Array.isArray(source.roles) ? validatePluginRoles(source.roles) : null,
    url: source.url || fallback.url || '',
    source: source.source || fallback.source || 'local',
  };
}

export function normalizePluginDefinition(definition, fallback = {}) {
  const source = definition || {};
  const manifest = normalizePluginManifest(source.manifest || source, fallback);

  return {
    manifest,
    register: typeof source.register === 'function'
      ? source.register
      : typeof source.default === 'function'
        ? source.default
        : typeof fallback.register === 'function'
          ? fallback.register
          : null,
    onUnload: typeof source.onUnload === 'function'
      ? source.onUnload
      : typeof fallback.onUnload === 'function'
        ? fallback.onUnload
        : null,
  };
}
