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
  beforeEach(async () => {
    await clearPluginRegistry();
  });

  it('registers plugin actions, routes and surfaces', async () => {
    await registerPlugin({
      manifest: {
        id: 'ticket-plugin',
        name: 'Ticket Plugin',
        version: '1.0.0',
        permissions: ['actions.write', 'surfaces.write', 'routes.write', 'external-links.open'],
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
        permissions: ['actions.write', 'routes.write'],
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

  it('does not expose host APIs without the matching capability', async () => {
    let observedApi;
    await registerPlugin({
      manifest: {
        id: 'least-privilege-plugin',
        name: 'Least Privilege',
        version: '1.0.0',
        permissions: ['actions.write'],
      },
      register(api) {
        observedApi = api;
        api.registerAction({ id: 'allowed', label: 'Allowed action' });
      },
    });

    assert.equal(typeof observedApi.registerAction, 'function');
    assert.equal(observedApi.registerRoute, undefined);
    assert.equal(observedApi.getCurrentUser, undefined);
    assert.equal(observedApi.openExternalUrl, undefined);
    assert.equal(Object.isFrozen(observedApi), true);
  });

  it('runs onUnload on replacement and global clear', async () => {
    const unloadReasons = [];
    const definition = {
      manifest: {
        id: 'lifecycle-plugin',
        name: 'Lifecycle',
        permissions: [],
      },
      register() {},
      onUnload({ reason }) {
        unloadReasons.push(reason);
      },
    };

    await registerPlugin(definition);
    await registerPlugin(definition);
    await clearPluginRegistry('kill-switch');

    assert.deepEqual(unloadReasons, ['replace', 'kill-switch']);
    assert.equal(getPluginSnapshot().plugins.length, 0);
  });

  it('clears registry state even when asynchronous plugin cleanup never settles', async () => {
    await registerPlugin({
      manifest: { id: 'stuck-cleanup', name: 'Stuck cleanup', permissions: [] },
      register() {},
      onUnload() {
        return new Promise(() => {});
      },
    });

    const startedAt = Date.now();
    const cleanup = clearPluginRegistry('kill-switch');
    assert.equal(getPluginSnapshot().plugins.length, 0);
    await cleanup;
    assert.equal(Date.now() - startedAt < 1_500, true);
    assert.match(getPluginSnapshot().loadErrors[0]?.message || '', /cleanup exceeded/);
  });

  it('rejects core-route collisions, unsafe links and cross-plugin route collisions', async () => {
    const coreCollision = await registerPlugin({
      manifest: {
        id: 'core-collision',
        name: 'Core Collision',
        permissions: ['routes.write'],
      },
      register(api) {
        api.registerRoute({ id: 'admin', path: '/admin', label: 'Fake admin' });
      },
    });
    assert.equal(coreCollision.status, 'error');
    assert.match(coreCollision.error, /below \/plugins\//);

    const unsafeLink = await registerPlugin({
      manifest: {
        id: 'unsafe-link',
        name: 'Unsafe Link',
        permissions: ['actions.write', 'external-links.open'],
      },
      register(api) {
        api.registerAction({ id: 'unsafe', label: 'Unsafe', href: 'javascript:alert(1)' });
      },
    });
    assert.equal(unsafeLink.status, 'error');
    assert.match(unsafeLink.error, /must use HTTPS/);

    const first = await registerPlugin({
      manifest: { id: 'first-route', name: 'First', permissions: ['routes.write'] },
      register(api) {
        api.registerRoute({ id: 'shared', path: '/plugins/shared', label: 'Shared' });
      },
    });
    const second = await registerPlugin({
      manifest: { id: 'second-route', name: 'Second', permissions: ['routes.write'] },
      register(api) {
        api.registerRoute({ id: 'shared', path: '/plugins/shared', label: 'Shared' });
      },
    });
    assert.equal(first.status, 'ready');
    assert.equal(second.status, 'error');
    assert.match(second.error, /already registered/);
  });

  it('does not treat an anonymous visitor as the user role and returns immutable host snapshots', async () => {
    let currentUser;
    await registerPlugin({
      manifest: {
        id: 'snapshot-plugin',
        name: 'Snapshot Plugin',
        permissions: ['actions.write', 'user.read'],
      },
      register(api) {
        currentUser = api.getCurrentUser();
        api.registerAction({ id: 'user-only', label: 'User only', roles: ['user'] });
      },
    }, {
      getCurrentUser: () => ({ id: 'user-1', role: 'user', profile: { locale: 'it' } }),
    });

    assert.equal(getPluginSurfaces(PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU, null).length, 0);
    assert.equal(getPluginSurfaces(PLUGIN_SURFACES.LAYOUT_ACCOUNT_MENU, { role: 'user' }).length, 1);
    assert.equal(Object.isFrozen(currentUser), true);
    assert.equal(Object.isFrozen(currentUser.profile), true);
  });
});
