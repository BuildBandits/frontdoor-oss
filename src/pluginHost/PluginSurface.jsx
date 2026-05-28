import { Fragment } from 'react';
import { useAuthStore } from '../stores/authStore';
import { resolveRenderableEntry, usePluginRegistry } from './registry';
import { usePluginRuntimeApi } from './PluginHostProvider';

function isVisibleForRole(entry, role) {
  if (Array.isArray(entry.roles) && entry.roles.length > 0) {
    return entry.roles.includes(role);
  }

  switch (entry.access) {
    case 'public':
      return true;
    case 'authenticated':
      return true;
    case 'admin':
      return ['owner', 'admin', 'admin_readonly'].includes(role);
    case 'adminEditor':
      return ['owner', 'admin'].includes(role);
    case 'owner':
      return role === 'owner';
    default:
      return true;
  }
}

function surfaceWrapperClass(variant) {
  switch (variant) {
    case 'nav':
      return 'flex flex-wrap items-center gap-2';
    case 'mobile-nav':
      return 'flex flex-nowrap gap-2 overflow-x-auto pb-1 -mx-1 px-1';
    case 'menu':
      return 'space-y-1';
    case 'toolbar':
      return 'flex flex-wrap items-center gap-2';
    case 'cards':
      return 'grid gap-3 md:grid-cols-2 xl:grid-cols-3';
    default:
      return 'space-y-3';
  }
}

export default function PluginSurface({
  surface,
  variant = 'stack',
  className = '',
  emptyFallback = null,
}) {
  const snapshot = usePluginRegistry();
  const { user } = useAuthStore();
  const pluginRuntimeApi = usePluginRuntimeApi();
  if (pluginRuntimeApi?.pluginsEnabled !== true) {
    return emptyFallback;
  }
  const entries = snapshot.surfaces[surface] || [];
  const visibleEntries = entries.filter((entry) => isVisibleForRole(entry, user?.role || 'user'));

  if (visibleEntries.length === 0) {
    return emptyFallback;
  }

  const wrapperClassName = `${surfaceWrapperClass(variant)} ${className}`.trim();

  return (
    <div className={wrapperClassName} data-plugin-surface={surface}>
      {visibleEntries.map((entry) => {
        const node = resolveRenderableEntry(entry, {
          ...(pluginRuntimeApi || {}),
          getCurrentUser: () => user || null,
          surfaceVariant: variant,
        });

        return (
          <Fragment key={`${entry.pluginId}:${entry.id}`}>
            {node}
          </Fragment>
        );
      })}
    </div>
  );
}
