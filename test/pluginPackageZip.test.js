import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildZipArchive,
  buildPluginPackageZip,
  extractPluginPackageZip,
  parseZipArchive,
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

test('rejects plugin archives with unsafe paths, ambiguous files, or too many entries', () => {
  assert.throws(
    () => parseZipArchive(buildZipArchive([{ name: '../manifest.json', data: '{}' }])),
    /unsafe or duplicate path/
  );

  assert.throws(
    () => extractPluginPackageZip(buildZipArchive([
      { name: 'one/manifest.json', data: '{}' },
      { name: 'two/manifest.json', data: '{}' },
      { name: 'module.mjs', data: 'export function register() {}' },
    ])),
    /ambiguous package files/
  );

  assert.throws(
    () => parseZipArchive(buildZipArchive(Array.from({ length: 17 }, (_, index) => ({
      name: `file-${index}.txt`,
      data: 'x',
    })))),
    /between 1 and 16 entries/
  );
});

test('rejects plugin archives with tampered bytes or oversized modules', () => {
  const archive = buildPluginPackageZip({
    manifest: { id: 'tamper-plugin', name: 'Tamper Plugin', version: '1.0.0' },
    moduleSource: 'export function register() { return "original"; }',
  });
  const tampered = Uint8Array.from(archive);
  const marker = Buffer.from('original');
  const markerOffset = Buffer.from(tampered).indexOf(marker);
  assert.notEqual(markerOffset, -1);
  tampered[markerOffset] ^= 0x01;
  assert.throws(() => extractPluginPackageZip(tampered), /checksum is invalid/);

  const oversizedModule = 'x'.repeat((1024 * 1024) + 1);
  assert.throws(
    () => extractPluginPackageZip(buildZipArchive([
      { name: 'manifest.json', data: '{"id":"large-plugin"}' },
      { name: 'module.mjs', data: oversizedModule },
    ])),
    /entry exceeds limits|module exceeds/
  );
});
