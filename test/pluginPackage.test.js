import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import {
  approvePluginRegistry,
  deletePluginRegistry,
  getRuntimePlugins,
  importPluginBundle,
} from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare("UPDATE branding_settings SET plugins_enabled = 0 WHERE id = 'default'").run();
});

test('imports a plugin package from one JSON payload and keeps it pending until approval', async () => {
  const packageSource = JSON.stringify({
    manifest: {
      id: 'package-plugin',
      name: 'Package Plugin',
      version: '1.0.0',
      description: 'A single-file package example for third-party installations',
      author: 'FrontDoor',
      permissions: ['actions.write', 'routes.write', 'surfaces.write'],
      roles: ['owner', 'admin'],
      backend: {
        enabled: true,
        url: 'https://plugins.example.com/webhook',
        eventSubscriptions: ['auth.login'],
      },
    },
    moduleSource: `export function register(api) {
  api.registerRoute({
    id: 'package-plugin.route',
    path: '/plugins/package-plugin',
    label: 'Package Plugin',
  });
}

export default { register };`,
  });

  try {
    const plugin = await importPluginBundle({ packageSource });
    assert.equal(plugin.approved, false);
    assert.equal(plugin.status, 'pending');
    assert.match(plugin.entry, /^\/api\/plugins\/files\/package-plugin\/1\.0\.0\//);
    assert.equal(getRuntimePlugins().length, 0);

    const approved = approvePluginRegistry('package-plugin', 'owner-1');
    assert.equal(approved?.approved, true);
    assert.equal(approved?.status, 'approved');
    assert.equal(getRuntimePlugins().length, 0);

    db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
    assert.equal(getRuntimePlugins({ role: 'owner' }).length, 1);
  } finally {
    deletePluginRegistry('package-plugin');
  }
});
