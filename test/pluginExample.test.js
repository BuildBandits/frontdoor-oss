import test from 'node:test';
import assert from 'node:assert/strict';
import { definePluginManifest } from '../src/pluginHost/sdk.js';
import ticketPlugin, { manifest, register } from '../src/plugins/examples/ticketPlugin.js';

test('definePluginManifest keeps canonical plugin metadata', () => {
  const pluginManifest = definePluginManifest({
    id: 'sample-plugin',
    name: 'Sample Plugin',
    version: '1.0.0',
  });

  assert.equal(pluginManifest.apiVersion, 1);
  assert.equal(pluginManifest.id, 'sample-plugin');
  assert.equal(pluginManifest.name, 'Sample Plugin');
});

test('ticket plugin exports a manifest and register function', () => {
  assert.equal(manifest.id, 'ticket-plugin');
  assert.equal(manifest.name, 'Ticket Plugin');
  assert.equal(manifest.version, '1.1.0');
  assert.equal(typeof register, 'function');
  assert.equal(ticketPlugin.manifest.id, 'ticket-plugin');
  assert.equal(typeof ticketPlugin.register, 'function');
});

test('ticket plugin registers a realistic integration surface set', () => {
  const calls = {
    actions: [],
    surfaces: [],
    routes: [],
    navigation: [],
  };

  register({
    registerAction: (action) => calls.actions.push(action),
    registerSurface: (surface) => calls.surfaces.push(surface),
    registerRoute: (route) => calls.routes.push(route),
    registerNavigationItem: (item) => calls.navigation.push(item),
    getCurrentUser: () => ({ displayName: 'Giovanni', email: 'giovanni@example.com' }),
    getLanguage: () => 'en',
    getBranding: () => ({ heroTitleLine1: 'Frontdoor' }),
    notify: () => {},
    navigate: () => {},
    openExternalUrl: () => {},
  });

  assert.equal(calls.actions.length, 2);
  assert.equal(calls.routes.length, 2);
  assert.equal(calls.surfaces.length, 2);
  assert.equal(calls.navigation.length, 2);
  assert.ok(calls.actions.some((action) => action.id === 'ticket-plugin.settings-action'));
  assert.ok(calls.routes.some((route) => route.id === 'ticket-plugin.settings-route'));
});
