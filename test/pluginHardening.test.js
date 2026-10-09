import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'plugin-hardening-secret-0123456789abcdef';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { dispatchPluginEvent, upsertPluginRegistry, approvePluginRegistry } = await import('../server/services/plugins.js');
const { isPrivateAddress, isPublicDestination } = await import('../server/services/networkGuard.js');

const ADMIN_ID = 'plugin-hardening-admin';
let server;
let baseUrl;

before(async () => {
  db.prepare("INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, 'admin@plugins.test', 'Plugin Admin', 'admin', 1)").run(ADMIN_ID);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
});

const adminRequest = (path, options = {}) => fetch(`${baseUrl}${path}`, {
  ...options,
  headers: { Authorization: `Bearer ${jwt.sign({ userId: ADMIN_ID }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' })}`, 'Content-Type': 'application/json' },
});

test('admins cannot approve plugins through create or update, and changes are audited', async () => {
  const res = await adminRequest('/api/plugins', {
    method: 'POST',
    body: JSON.stringify({ id: 'sneaky-plugin', name: 'Sneaky', version: '1.0.0', entry: 'https://plugins.example.com/sneaky.mjs', approved: true }),
  });
  assert.equal(res.status, 201);
  assert.equal(db.prepare("SELECT approved FROM plugin_registry WHERE id = 'sneaky-plugin'").get().approved, 0);

  const update = await adminRequest('/api/plugins/sneaky-plugin', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Sneaky', version: '1.0.1', entry: 'https://plugins.example.com/sneaky.mjs', approved: true }),
  });
  assert.equal(update.status, 200);
  assert.equal(db.prepare("SELECT approved FROM plugin_registry WHERE id = 'sneaky-plugin'").get().approved, 0);

  const actions = db.prepare("SELECT action FROM rbac_audit_logs WHERE target_type = 'plugin' AND target_id = 'sneaky-plugin' ORDER BY id").all().map((row) => row.action);
  assert.deepEqual(actions, ['create', 'update']);
});

test('only entries of enabled, approved plugins are served, and the runtime manifest hides backend details', async () => {
  upsertPluginRegistry({ id: 'local-plugin', name: 'Local', version: '1.0.0', entry: '/api/plugins/files/local-plugin/1.0.0/r1/index.mjs', backendEnabled: true, backendUrl: 'https://hooks.example.com/in' });
  let res = await fetch(`${baseUrl}/api/plugins/files/local-plugin/1.0.0/r1/index.mjs`);
  assert.equal(res.status, 404, 'pending plugin bundle is not served');
  res = await fetch(`${baseUrl}/api/plugins/files/other/any.mjs`);
  assert.equal(res.status, 404, 'files that are not a plugin entry are not served');

  approvePluginRegistry('local-plugin', 'owner-1');
  const runtime = await (await fetch(`${baseUrl}/api/plugins/runtime`)).json();
  const manifest = runtime.plugins.find((plugin) => plugin.manifest.id === 'local-plugin')?.manifest;
  assert.ok(manifest);
  assert.equal(manifest.backend, undefined);
});

test('webhooks to private destinations are refused', async () => {
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('100.64.0.1'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('fd12::1'), true);
  assert.equal(isPrivateAddress('::ffff:192.168.1.1'), true);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.equal(await isPublicDestination('https://internal.example/', { lookup: async () => [{ address: '10.0.0.8', family: 4 }] }), false);
  assert.equal(await isPublicDestination('https://public.example/', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }), true);

  upsertPluginRegistry({ id: 'cgnat-hook', name: 'CGNAT', version: '1.0.0', entry: 'https://plugins.example.com/c.mjs', backendEnabled: true, backendUrl: 'http://100.64.0.1/hook', eventSubscriptions: ['auth.login'] });
  approvePluginRegistry('cgnat-hook', 'owner-1');
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('', { status: 200 }); };
  try {
    const summary = await dispatchPluginEvent('auth.login', {});
    assert.equal(called, false);
    assert.equal(summary.failed, 1);
    assert.equal(summary.errors[0].message, 'Backend webhook destination is not allowed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
