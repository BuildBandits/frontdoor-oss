import { createElement } from 'react';
import { definePlugin, definePluginManifest } from '../../pluginHost/sdk.js';
import { PLUGIN_ACCESS, PLUGIN_SURFACES } from '../../pluginHost/constants.js';

export const manifest = definePluginManifest({
  id: 'ticket-plugin',
  name: 'Ticket Plugin',
  version: '1.1.0',
  description: 'A realistic support plugin with quick actions, a ticket hub, settings, and admin surfaces.',
  author: 'FrontDoor',
  permissions: ['actions.write', 'routes.write', 'surfaces.write'],
  roles: ['owner', 'admin'],
});

function TicketCenterPage({ pluginApi }) {
  const user = pluginApi.getCurrentUser();

  return createElement(
    'div',
    { className: 'mx-auto max-w-4xl rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xs' },
    createElement('div', { className: 'flex flex-col gap-4 md:flex-row md:items-start md:justify-between' },
      createElement('div', null,
        createElement('div', { className: 'inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/35 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300' }, 'Ticket Plugin'),
        createElement('h1', { className: 'mt-3 text-2xl font-extrabold text-dark dark:text-gray-100' }, 'Ticket Center'),
        createElement('p', { className: 'mt-2 text-sm text-gray-500 dark:text-gray-400' }, 'A reference plugin that exercises actions, surfaces, routes, and runtime APIs.')
      ),
      createElement('button', {
        type: 'button',
        className: 'inline-flex items-center justify-center rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800',
        onClick: () => pluginApi.notify({
          type: 'success',
          message: `Ticket flow opened for ${user?.displayName || user?.email || 'current user'}`,
        }),
      }, 'Open ticket flow')
    ),
    createElement('div', { className: 'mt-6 grid gap-4 md:grid-cols-3' },
      createElement('div', { className: 'rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4' },
        createElement('div', { className: 'text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500' }, 'Current user'),
        createElement('div', { className: 'mt-1 font-semibold text-dark dark:text-gray-100' }, user?.displayName || user?.email || 'Anonymous')
      ),
      createElement('div', { className: 'rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4' },
        createElement('div', { className: 'text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500' }, 'Language'),
        createElement('div', { className: 'mt-1 font-semibold text-dark dark:text-gray-100' }, pluginApi.getLanguage())
      ),
      createElement('div', { className: 'rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4' },
        createElement('div', { className: 'text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500' }, 'Branding title'),
        createElement('div', { className: 'mt-1 font-semibold text-dark dark:text-gray-100' }, pluginApi.getBranding()?.heroTitleLine1 || 'FrontDoor')
      )
    )
  );
}

function TicketSettingsPage({ pluginApi }) {
  const user = pluginApi.getCurrentUser();

  return createElement(
    'div',
    { className: 'mx-auto max-w-4xl rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xs' },
    createElement('div', { className: 'flex flex-col gap-4 md:flex-row md:items-start md:justify-between' },
      createElement('div', null,
        createElement('div', { className: 'inline-flex items-center rounded-full bg-sky-50 dark:bg-sky-950/35 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300' }, 'Ticket Plugin'),
        createElement('h1', { className: 'mt-3 text-2xl font-extrabold text-dark dark:text-gray-100' }, 'Ticket settings'),
        createElement('p', { className: 'mt-2 text-sm text-gray-500 dark:text-gray-400' }, 'This page simulates a third-party settings experience with runtime APIs and account-aware state.')
      ),
      createElement('button', {
        type: 'button',
        className: 'inline-flex items-center justify-center rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800',
        onClick: () => pluginApi.notify({
          type: 'info',
          message: 'Ticket plugin settings saved',
        }),
      }, 'Save settings')
    ),
    createElement('div', { className: 'mt-6 grid gap-4 md:grid-cols-3' },
      createElement('div', { className: 'rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4' },
        createElement('div', { className: 'text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500' }, 'Current user'),
        createElement('div', { className: 'mt-1 font-semibold text-dark dark:text-gray-100' }, user?.displayName || user?.email || 'Anonymous')
      ),
      createElement('div', { className: 'rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4' },
        createElement('div', { className: 'text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500' }, 'Plugin API'),
        createElement('div', { className: 'mt-1 font-semibold text-dark dark:text-gray-100' }, `v${pluginApi.apiVersion}`)
      ),
      createElement('div', { className: 'rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4' },
        createElement('div', { className: 'text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500' }, 'Support channel'),
        createElement('div', { className: 'mt-1 font-semibold text-dark dark:text-gray-100' }, 'ticket-plugin')
      )
    ),
    createElement('div', { className: 'mt-6 rounded-2xl border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/20 p-5 text-sky-900 dark:text-sky-100' },
      createElement('div', { className: 'text-sm font-semibold' }, 'What this page demonstrates'),
      createElement('ul', { className: 'mt-3 space-y-2 text-sm text-sky-800/90 dark:text-sky-100/80' },
        createElement('li', null, 'a settings route controlled entirely by the plugin'),
        createElement('li', null, 'owner/admin visibility rules'),
        createElement('li', null, 'plugin runtime APIs for notifications and navigation')
      )
    )
  );
}

function registerTicketPlugin(api) {
  api.registerAction({
    id: 'ticket-plugin.account-action',
    label: 'Open ticket center',
    description: 'Quick access to the ticket example plugin',
    surface: PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU,
    variant: 'menu',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    order: 25,
    onClick: () => {
      api.navigate('/plugins/ticket-center');
      api.notify({ type: 'info', message: 'Ticket center opened' });
    },
  });

  api.registerAction({
    id: 'ticket-plugin.settings-action',
    label: 'Ticket settings',
    description: 'Configure the support workflow',
    surface: PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU,
    variant: 'menu',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    order: 26,
    onClick: () => {
      api.navigate('/plugins/ticket-center/settings');
      api.notify({ type: 'info', message: 'Ticket settings opened' });
    },
  });

  api.registerNavigationItem({
    id: 'ticket-plugin.nav',
    label: 'Tickets',
    href: '/plugins/ticket-center',
    surface: PLUGIN_SURFACES.LAYOUT_NAV_DESKTOP,
    variant: 'nav',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    order: 75,
  });

  api.registerNavigationItem({
    id: 'ticket-plugin.nav-mobile',
    label: 'Tickets',
    href: '/plugins/ticket-center',
    surface: PLUGIN_SURFACES.LAYOUT_NAV_MOBILE,
    variant: 'nav',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    order: 75,
  });

  api.registerSurface({
    id: 'ticket-plugin.home-banner',
    surface: PLUGIN_SURFACES.HOME_HERO_AFTER,
    variant: 'stack',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    order: 60,
    render: (pluginApi) => createElement(
      'section',
      { className: 'rounded-3xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-5 text-amber-900 dark:text-amber-100' },
      createElement('div', { className: 'text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300' }, 'Example plugin'),
      createElement('h2', { className: 'mt-2 text-lg font-bold' }, 'Ticket plugin is active'),
      createElement('p', { className: 'mt-2 text-sm text-amber-800/90 dark:text-amber-100/80' }, `Loaded for ${pluginApi.getCurrentUser()?.displayName || 'the current session'}.`)
    ),
  });

  api.registerSurface({
    id: 'ticket-plugin.admin-callout',
    surface: PLUGIN_SURFACES.ADMIN_PAGE_TOP,
    variant: 'stack',
    access: PLUGIN_ACCESS.ADMIN_EDITOR,
    roles: ['owner', 'admin'],
    order: 40,
    render: (pluginApi) => createElement(
      'section',
      { className: 'rounded-3xl border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/20 p-5 text-sky-900 dark:text-sky-100' },
      createElement('div', { className: 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between' },
        createElement('div', null,
          createElement('div', { className: 'text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300' }, 'Support integration'),
          createElement('h2', { className: 'mt-1 text-lg font-bold' }, 'Ticket Plugin admin surface'),
          createElement('p', { className: 'mt-2 text-sm text-sky-800/90 dark:text-sky-100/80' }, `Configured for ${pluginApi.getCurrentUser()?.displayName || 'the current admin'}.`)
        ),
        createElement('button', {
          type: 'button',
          className: 'inline-flex items-center justify-center rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800',
          onClick: () => {
            pluginApi.navigate('/plugins/ticket-center/settings');
            pluginApi.notify({ type: 'success', message: 'Ticket plugin settings opened from admin' });
          },
        }, 'Open settings')
      )
    ),
  });

  api.registerRoute({
    id: 'ticket-plugin.route',
    path: '/plugins/ticket-center',
    label: 'Ticket Center',
    description: 'Demonstration route for a third-party plugin',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    layout: 'app',
    order: 75,
    render: (pluginApi) => createElement(TicketCenterPage, { pluginApi }),
  });

  api.registerRoute({
    id: 'ticket-plugin.settings-route',
    path: '/plugins/ticket-center/settings',
    label: 'Ticket Settings',
    description: 'Plugin settings page for support workflow configuration',
    access: PLUGIN_ACCESS.AUTHENTICATED,
    roles: ['owner', 'admin'],
    layout: 'app',
    order: 76,
    render: (pluginApi) => createElement(TicketSettingsPage, { pluginApi }),
  });
}

export const register = registerTicketPlugin;

export const plugin = definePlugin({
  manifest,
  register,
});

export default plugin;
