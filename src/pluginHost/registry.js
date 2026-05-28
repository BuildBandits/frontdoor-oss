import { createElement, isValidElement, useSyncExternalStore } from 'react';
import { ADMIN_ROLE_SETS, PLUGIN_ACCESS, PLUGIN_SURFACES } from './constants.js';
import {
  createPluginAction,
  createPluginRoute,
  createPluginSurface,
  normalizePluginDefinition,
} from './sdk.js';

const subscribers = new Set();

const state = {
  plugins: new Map(),
  surfaces: new Map(),
  routes: new Map(),
  loadErrors: [],
  loadedSources: new Set(),
  bootstrapped: false,
  bootstrapping: false,
};

let snapshot = buildSnapshot();

function cloneEntry(entry) {
  return {
    ...entry,
    roles: Array.isArray(entry.roles) ? [...entry.roles] : entry.roles,
    permissions: Array.isArray(entry.permissions) ? [...entry.permissions] : entry.permissions,
  };
}

function cloneMapOfArrays(map) {
  return Object.fromEntries(
    Array.from(map.entries()).map(([key, entries]) => [
      key,
      entries.map((entry) => cloneEntry(entry)),
    ])
  );
}

function sortEntries(entries = []) {
  return [...entries].sort((left, right) => {
    const orderDelta = (left.order ?? 100) - (right.order ?? 100);
    if (orderDelta !== 0) return orderDelta;
    return String(left.label || left.id || '').localeCompare(String(right.label || right.id || ''));
  });
}

function buildSnapshot() {
  return {
    plugins: Array.from(state.plugins.values())
      .map((plugin) => ({
        ...plugin,
        roles: Array.isArray(plugin.roles) ? [...plugin.roles] : plugin.roles,
        permissions: Array.isArray(plugin.permissions) ? [...plugin.permissions] : plugin.permissions,
        surfaces: [...plugin.surfaces],
        actions: [...plugin.actions],
        routes: [...plugin.routes],
      }))
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
    surfaces: cloneMapOfArrays(state.surfaces),
    routes: Array.from(state.routes.values())
      .map((route) => ({
        ...route,
        roles: Array.isArray(route.roles) ? [...route.roles] : route.roles,
      }))
      .sort((left, right) => String(left.label || left.id || left.path).localeCompare(String(right.label || right.id || right.path))),
    loadErrors: state.loadErrors.map((error) => ({ ...error })),
    loadedSources: Array.from(state.loadedSources.values()),
    bootstrapped: state.bootstrapped,
    bootstrapping: state.bootstrapping,
  };
}

function emitChange() {
  snapshot = buildSnapshot();
  subscribers.forEach((listener) => listener());
}

function upsertSurfaceEntry(pluginId, entry) {
  const normalized = {
    id: String(entry.id || `${pluginId}:${entry.surface}:${entry.label || 'entry'}`),
    pluginId,
    surface: entry.surface,
    kind: entry.kind || 'surface',
    label: entry.label || '',
    description: entry.description || '',
    order: Number.isFinite(entry.order) ? entry.order : 100,
    access: entry.access || PLUGIN_ACCESS.AUTHENTICATED,
    roles: Array.isArray(entry.roles) ? [...entry.roles] : entry.roles || null,
    icon: entry.icon || null,
    href: entry.href || '',
    target: entry.target || '_self',
    title: entry.title || '',
    variant: entry.variant || 'default',
    onClick: typeof entry.onClick === 'function' ? entry.onClick : null,
    render: typeof entry.render === 'function' ? entry.render : null,
    element: entry.element || null,
    hideLabel: entry.hideLabel === true,
    disabled: entry.disabled === true,
  };

  const existing = state.surfaces.get(normalized.surface) || [];
  const next = existing.filter((item) => !(item.pluginId === pluginId && item.id === normalized.id));
  next.push(normalized);
  state.surfaces.set(normalized.surface, sortEntries(next));
  const plugin = state.plugins.get(pluginId);
  if (plugin) {
    const isAction = normalized.kind === 'action';
    if (isAction) {
      plugin.actions = Array.from(new Set([...plugin.actions, normalized.id]));
    } else {
      plugin.surfaces = Array.from(new Set([...plugin.surfaces, normalized.id]));
    }
  }
}

function upsertRouteEntry(pluginId, entry) {
  const normalized = {
    id: String(entry.id || `${pluginId}:${entry.path}`),
    pluginId,
    path: String(entry.path || '').trim(),
    label: entry.label || '',
    description: entry.description || '',
    order: Number.isFinite(entry.order) ? entry.order : 100,
    access: entry.access || PLUGIN_ACCESS.AUTHENTICATED,
    roles: Array.isArray(entry.roles) ? [...entry.roles] : entry.roles || null,
    layout: entry.layout || 'app',
    nav: entry.nav || null,
    element: entry.element || null,
    render: typeof entry.render === 'function' ? entry.render : null,
  };

  if (!normalized.path) {
    throw new Error(`Plugin route "${normalized.id}" is missing a path`);
  }

  state.routes.set(normalized.id, normalized);
  const plugin = state.plugins.get(pluginId);
  if (plugin) {
    plugin.routes = Array.from(new Set([...plugin.routes, normalized.id]));
  }
}

function removePluginEntries(pluginId) {
  for (const [surface, entries] of state.surfaces.entries()) {
    const next = entries.filter((entry) => entry.pluginId !== pluginId);
    if (next.length > 0) {
      state.surfaces.set(surface, next);
    } else {
      state.surfaces.delete(surface);
    }
  }

  for (const [routeId, route] of state.routes.entries()) {
    if (route.pluginId === pluginId) {
      state.routes.delete(routeId);
    }
  }
}

function canUseAccess(access, roles) {
  if (Array.isArray(roles) && roles.length > 0) return true;
  return access === PLUGIN_ACCESS.AUTHENTICATED;
}

function renderIcon(icon) {
  if (!icon) return null;
  if (typeof icon === 'string') {
    return createElement('span', { className: 'text-base leading-none' }, icon);
  }
  if (isValidElement(icon)) {
    return icon;
  }
  if (typeof icon === 'function') {
    return createElement(icon, { className: 'h-4 w-4 shrink-0' });
  }
  return null;
}

function getUserRole(user) {
  return user?.role || 'user';
}

function isEntryVisible(entry, user) {
  if (!entry) return false;
  const role = getUserRole(user);

  if (Array.isArray(entry.roles) && entry.roles.length > 0) {
    return entry.roles.includes(role);
  }

  switch (entry.access) {
    case PLUGIN_ACCESS.PUBLIC:
      return true;
    case PLUGIN_ACCESS.AUTHENTICATED:
      return Boolean(user);
    case PLUGIN_ACCESS.ADMIN:
      return ADMIN_ROLE_SETS.viewer.includes(role);
    case PLUGIN_ACCESS.ADMIN_EDITOR:
      return ADMIN_ROLE_SETS.editor.includes(role);
    case PLUGIN_ACCESS.OWNER:
      return role === 'owner';
    default:
      return Boolean(user);
  }
}

function buildPluginApi(pluginId, runtimeApi = {}) {
  return {
    apiVersion: runtimeApi.apiVersion || 1,
    pluginId,
    surfaceVariant: runtimeApi.surfaceVariant || null,
    getCurrentUser: () => runtimeApi.getCurrentUser?.() || null,
    getBranding: () => runtimeApi.getBranding?.() || null,
    getLanguage: () => runtimeApi.getLanguage?.() || 'en',
    getUiStrings: () => runtimeApi.getUiStrings?.() || null,
    navigate: (...args) => runtimeApi.navigate?.(...args),
    notify: (payload) => runtimeApi.notify?.(payload),
    openExternalUrl: (url, target = '_blank') => runtimeApi.openExternalUrl?.(url, target),
    registerAction: (action) => registerAction(pluginId, action),
    registerSurface: (surface) => registerSurface(pluginId, surface),
    registerRoute: (route) => registerRoute(pluginId, route),
    registerNavigationItem: (item) => registerNavigationItem(pluginId, item),
  };
}

function registerAction(pluginId, action) {
  const normalized = createPluginAction(action);
  if (!normalized.surface) {
    normalized.surface = PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU;
    normalized.variant = 'menu';
  } else if (!normalized.variant && normalized.surface === PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU) {
    normalized.variant = 'menu';
  }
  upsertSurfaceEntry(pluginId, normalized);
  emitChange();
  return normalized.id;
}

function registerSurface(pluginId, surface) {
  const normalized = createPluginSurface(surface);
  if (!normalized.surface) {
    throw new Error('Plugin surface requires a surface id');
  }
  upsertSurfaceEntry(pluginId, normalized);
  emitChange();
  return normalized.id;
}

function registerNavigationItem(pluginId, item) {
  const normalized = createPluginAction({
    ...item,
    surface: item.surface || PLUGIN_SURFACES.LAYOUT_NAV_DESKTOP,
    variant: item.variant || 'nav',
  });
  upsertSurfaceEntry(pluginId, normalized);
  emitChange();
  return normalized.id;
}

function registerRoute(pluginId, route) {
  const normalized = createPluginRoute(route);
  upsertRouteEntry(pluginId, normalized);
  emitChange();
  return normalized.id;
}

export function subscribePluginRegistry(listener) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function getPluginSnapshot() {
  return snapshot;
}

export function usePluginRegistry(selector = (value) => value) {
  return useSyncExternalStore(
    subscribePluginRegistry,
    () => selector(snapshot),
    () => selector(snapshot)
  );
}

export function getPluginSurfaces(surface, user = null) {
  const entries = snapshot.surfaces[surface] || [];
  return entries.filter((entry) => isEntryVisible(entry, user));
}

export function getPluginRoutes(user = null) {
  return snapshot.routes.filter((route) => isEntryVisible(route, user));
}

export function getPlugins(user = null) {
  return snapshot.plugins.filter((plugin) => isEntryVisible(plugin, user));
}

export const getPluginPlugins = getPlugins;

export function setPluginBootstrapState(nextState) {
  state.bootstrapping = Boolean(nextState?.bootstrapping);
  state.bootstrapped = Boolean(nextState?.bootstrapped ?? state.bootstrapped);
  emitChange();
}

export function addPluginLoadError(error) {
  state.loadErrors = [
    ...state.loadErrors,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...error,
    },
  ];
  emitChange();
}

export function clearPluginRegistry() {
  state.plugins.clear();
  state.surfaces.clear();
  state.routes.clear();
  state.loadErrors = [];
  state.loadedSources.clear();
  state.bootstrapped = false;
  state.bootstrapping = false;
  emitChange();
}

export async function registerPlugin(pluginDefinition, runtimeApi = {}, fallback = {}) {
  const plugin = normalizePluginDefinition(pluginDefinition, fallback);
  const { manifest } = plugin;

  if (state.plugins.has(manifest.id)) {
    removePluginEntries(manifest.id);
  }

  const pluginRecord = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage,
    entry: manifest.entry,
    permissions: [...manifest.permissions],
    roles: manifest.roles ? [...manifest.roles] : null,
    source: manifest.source,
    status: 'loading',
    surfaces: [],
    actions: [],
    routes: [],
    error: null,
    registeredAt: new Date().toISOString(),
  };

  state.plugins.set(manifest.id, pluginRecord);
  emitChange();

  const api = buildPluginApi(manifest.id, runtimeApi);

  try {
    if (typeof plugin.register === 'function') {
      await plugin.register(api);
    }
    pluginRecord.status = 'ready';
    state.loadedSources.add(manifest.source || manifest.entry || manifest.id);
  } catch (error) {
    pluginRecord.status = 'error';
    pluginRecord.error = error instanceof Error ? error.message : String(error);
    addPluginLoadError({
      pluginId: manifest.id,
      source: manifest.source,
      message: pluginRecord.error,
    });
  }

  emitChange();
  return pluginRecord;
}

export function resolveRenderableEntry(entry, runtimeApi = {}) {
  const entryApi = buildPluginApi(entry.pluginId, runtimeApi);
  const surfaceVariant = runtimeApi.surfaceVariant || 'stack';

  if (typeof entry.render === 'function') {
    return entry.render(entryApi);
  }

  if (isValidElement(entry.element)) {
    return entry.element;
  }

  if (typeof entry.element === 'function') {
    return createElement(entry.element, { pluginApi: entryApi });
  }

  if (entry.href) {
    const icon = renderIcon(entry.icon);
    return createElement(
      'a',
      {
        href: entry.href,
        target: entry.target || '_self',
        rel: entry.target === '_blank' ? 'noreferrer' : undefined,
        title: entry.title || entry.description || entry.label,
        className: surfaceVariant === 'menu'
          ? 'flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-accent/10 hover:text-dark dark:hover:text-white'
          : surfaceVariant === 'nav'
            ? 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white'
            : 'flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white',
      },
      icon,
      createElement('span', { className: entry.hideLabel ? 'sr-only' : '' }, entry.label || entry.title || entry.id)
    );
  }

  const buttonType = entry.kind === 'action' ? 'button' : 'button';
  const onClick = typeof entry.onClick === 'function'
    ? () => entry.onClick(entryApi)
    : undefined;
  const icon = renderIcon(entry.icon);
  const children = [
    icon,
    createElement('span', { key: 'label', className: entry.hideLabel ? 'sr-only' : '' }, entry.label || entry.title || entry.id),
  ];

  if (entry.description && entry.variant === 'menu') {
    children.push(
      createElement('span', { key: 'desc', className: 'block text-xs font-normal text-gray-400 dark:text-gray-500' }, entry.description)
    );
  }

  return createElement(
    'button',
    {
      type: buttonType,
      onClick,
      disabled: entry.disabled,
      title: entry.title || entry.description || entry.label,
      className: surfaceVariant === 'nav' || entry.variant === 'nav'
        ? 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white'
        : surfaceVariant === 'menu' || entry.variant === 'menu'
          ? 'flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-accent/10 hover:text-dark dark:hover:text-white'
          : 'inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white',
    },
    ...children
  );
}

export async function loadPluginBundle(pluginDefinition, runtimeApi = {}, fallback = {}) {
  return registerPlugin(pluginDefinition, runtimeApi, fallback);
}

export const pluginRegistryHelpers = {
  registerAction,
  registerSurface,
  registerNavigationItem,
  registerRoute,
  isEntryVisible,
  getPluginSurfaces,
  getPluginRoutes,
  getPlugins,
  getPluginPlugins,
};
