import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import { buildPluginPackageZip } from '../shared/packageZip.js';
import { importPluginBundle, getRuntimePlugins } from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
});

test('imports a plugin ZIP package through the server service', async () => {
  const archive = buildPluginPackageZip({
    manifest: {
      id: 'archive-plugin',
      name: 'Archive Plugin',
      version: '1.0.0',
      permissions: ['routes.write'],
      roles: ['admin'],
      backend: {
        enabled: false,
        url: '',
        eventSubscriptions: [],
      },
    },
    moduleSource: 'export function register(api) { api.registerRoute({ id: "archive.route", path: "/plugins/archive", label: "Archive" }); }',
  });

  const plugin = await importPluginBundle({
    packageZipBase64: Buffer.from(archive).toString('base64'),
  });

  assert.equal(plugin.approved, false);
  assert.equal(plugin.status, 'pending');
  assert.equal(plugin.entry.startsWith('/api/plugins/files/archive-plugin/1.0.0/'), true);
  assert.equal(getRuntimePlugins().length, 0);
});
