import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import { getBrandingSettings } from '../server/services/branding.js';
import { approvePluginRegistry, dispatchPluginEvent, getRuntimePlugins, importPluginBundle } from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare("UPDATE branding_settings SET plugins_enabled = 0 WHERE id = 'default'").run();
});

test('plugin system stays off by default and blocks runtime delivery', async () => {
  assert.equal(getBrandingSettings().pluginsEnabled, false);

  await importPluginBundle({
    manifest: {
      id: 'switch-plugin',
      name: 'Switch Plugin',
      version: '1.0.0',
    },
    moduleSource: 'export function register() {}',
    backendEnabled: true,
    backendUrl: 'https://plugins.example.com/webhook',
    eventSubscriptions: ['auth.login'],
  });

  approvePluginRegistry('switch-plugin', 'owner-1');

  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  try {
    assert.equal(getRuntimePlugins({ role: 'owner' }).length, 0);
    const summary = await dispatchPluginEvent('auth.login', { userId: 'u-1' });
    assert.equal(fetchCalls, 0);
    assert.equal(summary.attempted, 0);
    assert.equal(summary.delivered, 0);
    assert.equal(summary.failed, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
