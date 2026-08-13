import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import db from '../server/db.js';
import {
  approvePluginRegistry,
  deletePluginRegistry,
  getPluginRegistryById,
  getRuntimePlugins,
  importPluginBundle,
  PLUGIN_ASSET_DIR,
  readVerifiedPluginArtifact,
} from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare("UPDATE branding_settings SET plugins_enabled = 0 WHERE id = 'default'").run();
});

test('binds approval to immutable artifact and security metadata digests', async () => {
  try {
    const installed = await importPluginBundle({
      manifest: {
        id: 'integrity-plugin',
        name: 'Integrity Plugin',
        version: '1.0.0',
        permissions: ['routes.write'],
        roles: ['owner'],
      },
      moduleSource: 'export function register(api) { api.registerRoute({ path: "/integrity" }); }',
    });

    assert.match(installed.artifactSha256 || '', /^[a-f0-9]{64}$/);
    assert.match(installed.contentDigest || '', /^[a-f0-9]{64}$/);
    assert.equal(installed.approved, false);

    const approved = approvePluginRegistry('integrity-plugin', 'owner-1');
    assert.equal(approved.approved, true);
    assert.equal(approved.approvedDigest, approved.contentDigest);

    const updated = await importPluginBundle({
      manifest: {
        id: 'integrity-plugin',
        name: 'Integrity Plugin renamed',
        version: '1.0.0',
        permissions: ['routes.write'],
        roles: ['owner'],
      },
    });

    assert.equal(updated.artifactSha256, installed.artifactSha256);
    assert.notEqual(updated.contentDigest, installed.contentDigest);
    assert.equal(updated.approved, false);
    assert.equal(updated.approvedDigest, null);

    db.prepare(`
      UPDATE plugin_registry
      SET approved = 1, approved_digest = 'invalid'
      WHERE id = 'integrity-plugin'
    `).run();
    assert.equal(getPluginRegistryById('integrity-plugin').approved, false);
  } finally {
    deletePluginRegistry('integrity-plugin');
  }
});

test('approval fails if the immutable artifact was tampered with or removed', async () => {
  try {
    const tampered = await importPluginBundle({
      manifest: { id: 'approval-tamper', name: 'Approval tamper', version: '1.0.0' },
      moduleSource: 'export function register() { return "original"; }',
    });
    const tamperedPath = path.join(
      PLUGIN_ASSET_DIR,
      ...new URL(tampered.entry, 'http://frontdoor.local').pathname
        .replace('/api/plugins/files/', '')
        .split('/')
    );
    await fs.chmod(tamperedPath, 0o640);
    await fs.writeFile(tamperedPath, 'export function register() { return "tampered"; }');
    assert.throws(() => approvePluginRegistry('approval-tamper', 'owner-1'), /tampered artifact/);

    const removed = await importPluginBundle({
      manifest: { id: 'approval-missing', name: 'Approval missing', version: '1.0.0' },
      moduleSource: 'export function register() {}',
    });
    const removedPath = path.join(
      PLUGIN_ASSET_DIR,
      ...new URL(removed.entry, 'http://frontdoor.local').pathname
        .replace('/api/plugins/files/', '')
        .split('/')
    );
    await fs.unlink(removedPath);
    assert.throws(() => approvePluginRegistry('approval-missing', 'owner-1'), /artifact to be present/);
  } finally {
    deletePluginRegistry('approval-tamper');
    deletePluginRegistry('approval-missing');
  }
});

test('rejects remote entries, unknown capabilities, role bypass and artifact tampering', async () => {
  await assert.rejects(
    importPluginBundle({
      id: 'remote-plugin',
      name: 'Remote Plugin',
      entry: 'https://plugins.example.com/plugin.mjs',
    }),
    /Remote plugin entries are not supported/
  );

  await assert.rejects(
    importPluginBundle({
      manifest: {
        id: 'unknown-role',
        name: 'Unknown role',
        version: '1.0.0',
        roles: ['superadmin'],
      },
      moduleSource: 'export function register() {}',
    }),
    /Unsupported plugin role/
  );

  await assert.rejects(
    importPluginBundle({
      manifest: { id: 'oversized-module', name: 'Oversized module', version: '1.0.0' },
      moduleSource: 'x'.repeat((1024 * 1024) + 1),
    }),
    /module exceeds the 1 MiB size limit/
  );

  await assert.rejects(
    importPluginBundle({
      manifest: {
        id: 'unknown-capability',
        name: 'Unknown Capability',
        permissions: ['frontdoor.everything'],
      },
      moduleSource: 'export function register() {}',
    }),
    /Unsupported plugin permission/
  );

  try {
    const plugin = await importPluginBundle({
      manifest: {
        id: 'role-plugin',
        name: 'Role Plugin',
        version: '1.0.0',
        roles: ['owner'],
      },
      moduleSource: 'export function register() {}',
    });
    approvePluginRegistry(plugin.id, 'owner-1');
    db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();

    assert.equal(getRuntimePlugins({ role: 'owner' }).length, 1);
    assert.equal(getRuntimePlugins({ role: 'admin' }).length, 0);
    assert.equal(getRuntimePlugins({ role: 'user' }).length, 0);
    assert.equal(getRuntimePlugins(null).length, 0);

    const requestPath = new URL(plugin.entry, 'https://frontdoor.invalid').pathname
      .replace('/api/plugins/files', '');
    const verified = await readVerifiedPluginArtifact(requestPath, { role: 'owner' });
    assert.match(verified.toString('utf8'), /register/);

    const relativeEntry = plugin.entry.replace('/api/plugins/files/', '');
    const filePath = path.join(PLUGIN_ASSET_DIR, ...relativeEntry.split('/'));
    await fs.chmod(filePath, 0o640);
    await fs.writeFile(filePath, 'export function register() { throw new Error("tampered"); }', 'utf8');

    assert.equal(await readVerifiedPluginArtifact(requestPath, { role: 'owner' }), null);
  } finally {
    deletePluginRegistry('role-plugin');
    deletePluginRegistry('unknown-capability');
  }
});
