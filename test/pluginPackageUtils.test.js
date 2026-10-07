import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePluginPackage,
  buildPluginPackageFromForm,
  buildPluginPackageFromRecord,
  serializePluginPackage,
} from '../src/pluginHost/packageUtils.js';

test('builds a self-contained plugin package from form state', () => {
  const packageData = buildPluginPackageFromForm({
    id: 'package-plugin',
    name: 'Package Plugin',
    version: '1.2.3',
    description: 'A package export example',
    author: 'Frontdoor',
    homepage: 'https://example.com/plugin',
    entry: '',
    permissions: 'actions.write\nroutes.write',
    roles: 'owner\nadmin',
    backendEnabled: true,
    backendUrl: 'https://plugins.example.com/webhook',
    eventSubscriptions: 'auth.login',
    moduleSource: 'export function register(api) { return api; }',
  });

  assert.equal(packageData.manifest.id, 'package-plugin');
  assert.equal(packageData.manifest.backend.enabled, true);
  assert.equal(packageData.moduleSource.includes('register(api)'), true);

  const analysis = analyzePluginPackage(packageData);
  assert.equal(analysis.valid, true);
  assert.equal(analysis.riskLevel, 'medium');
  assert.equal(analysis.summary.moduleSource, true);
});

test('builds a plugin package from a registry record', () => {
  const packageData = buildPluginPackageFromRecord({
    id: 'record-plugin',
    name: 'Record Plugin',
    version: '1.0.0',
    description: 'Stored plugin',
    source: 'uploaded',
    entry: '/api/plugins/files/record-plugin/1.0.0/release/index.mjs',
    permissions: ['surfaces.write'],
    roles: ['owner'],
    backendEnabled: false,
    backendUrl: '',
    eventSubscriptions: [],
    manifest: {
      author: 'Frontdoor',
    },
  });

  const text = serializePluginPackage(packageData);
  assert.match(text, /"record-plugin"/);
  assert.match(text, /"entry": "\/api\/plugins\/files\/record-plugin/);
});
