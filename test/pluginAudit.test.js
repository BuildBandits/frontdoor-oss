import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import {
  approvePluginRegistry,
  revokePluginApproval,
  upsertPluginRegistry,
} from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare('DELETE FROM rbac_audit_logs').run();
});

test('logs plugin approval and revocation in the RBAC audit trail', () => {
  upsertPluginRegistry({
    id: 'audit-plugin',
    name: 'Audit Plugin',
    version: '1.0.0',
    entry: 'https://plugins.example.com/plugin.mjs',
    approved: false,
  });

  approvePluginRegistry('audit-plugin', 'owner-1');
  revokePluginApproval('audit-plugin', 'owner-1');

  const rows = db.prepare(`
    SELECT action, target_type, target_id, details
    FROM rbac_audit_logs
    WHERE target_type = 'plugin'
    ORDER BY id
  `).all();

  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, 'approve');
  assert.equal(rows[0].target_id, 'audit-plugin');
  assert.equal(rows[1].action, 'revoke');
  assert.equal(rows[1].target_id, 'audit-plugin');
  assert.match(rows[0].details || '', /"approved":true/);
  assert.match(rows[1].details || '', /"approved":false/);
});
