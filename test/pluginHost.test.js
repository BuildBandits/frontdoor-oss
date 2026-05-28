import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PLUGIN_SURFACES } from '../src/pluginHost/constants.js';
import {
  clearPluginRegistry,
  getPluginRoutes,
  getPluginSnapshot,
  getPluginSurfaces,
  registerPlugin,
} from '../src/pluginHost/registry.js';

describe('plugin host registry', () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  it('registers plugin actions, routes and surfaces', async () => {
    await registerPlugin({
      manifest: {
        id: 'ticket-plugin',
        name: 'Ticket Plugin',
        version: '1.0.0',
      },
      register(api) {
        api.registerAction({
          id: 'create-ticket',
          label: 'Create Ticket',
          surface: PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU,
          href: 'https://tickets.example.com',
        });
        api.registerSurface({
          id: 'ticket-banner',
          surface: PLUGIN_SURFACES.HOME_HERO_AFTER,
          render: () => 'ticket-banner',
        });
        api.registerRoute({
          id: 'ticket-route',
          path: '/plugins/tickets',
          label: 'Tickets',
        });
      },
    });

    const snapshot = getPluginSnapshot();
    assert.equal(snapshot.plugins.length, 1);
    assert.equal(snapshot.plugins[0].status, 'ready');
    assert.equal(getPluginSurfaces(PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU, { role: 'user' }).length, 1);
    assert.equal(getPluginSurfaces(PLUGIN_SURFACES.HOME_HERO_AFTER, { role: 'user' }).length, 1);
    assert.equal(getPluginRoutes({ role: 'user' }).length, 1);
  });

  it('hides plugin entries when the role does not match', async () => {
    await registerPlugin({
      manifest: {
        id: 'owner-only-plugin',
        name: 'Owner Only',
        version: '1.0.0',
      },
      register(api) {
        api.registerAction({
          id: 'owner-action',
          label: 'Owner Action',
          surface: PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU,
          roles: ['owner'],
        });
        api.registerRoute({
          id: 'owner-route',
          path: '/plugins/owner',
          label: 'Owner route',
          roles: ['owner'],
        });
      },
    });

    assert.equal(getPluginSurfaces(PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU, { role: 'admin' }).length, 0);
    assert.equal(getPluginSurfaces(PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU, { role: 'owner' }).length, 1);
    assert.equal(getPluginRoutes({ role: 'admin' }).length, 0);
    assert.equal(getPluginRoutes({ role: 'owner' }).length, 1);
  });
});

