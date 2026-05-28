import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPluginPackageZip,
  extractPluginPackageZip,
} from '../shared/packageZip.js';

test('roundtrips plugin packages through ZIP archives', () => {
  const archive = buildPluginPackageZip({
    manifest: {
      id: 'zip-plugin',
      name: 'Zip Plugin',
      version: '2.0.0',
      permissions: ['actions.write'],
      roles: ['owner'],
    },
    moduleSource: 'export function register(api) { return api; }',
  });

  const parsed = extractPluginPackageZip(archive);
  assert.equal(parsed.manifest.id, 'zip-plugin');
  assert.equal(parsed.manifest.version, '2.0.0');
  assert.equal(parsed.moduleSource.includes('register(api)'), true);
});
