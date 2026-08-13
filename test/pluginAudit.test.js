import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import {
  approvePluginRegistry,
  importPluginBundle,
  revokePluginApproval,
} from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare('DELETE FROM rbac_audit_logs').run();
});

test('logs plugin approval and revocation in the RBAC audit trail', async () => {
  await importPluginBundle({
    manifest: {
      id: 'audit-plugin',
      name: 'Audit Plugin',
      version: '1.0.0',
    },
    moduleSource: 'export function register() {}',
  });

  approvePluginRegistry('audit-plugin', 'owner-1');
  revokePluginApproval('audit-plugin', 'owner-1');

  const rows = db.prepare(`
    SELECT action, target_type, target_id, details
    FROM rbac_audit_logs
    WHERE target_type = 'plugin'
    ORDER BY id
  `).all();

  assert.equal(rows.length, 3);
  assert.equal(rows[0].action, 'import');
  assert.equal(rows[0].target_id, 'audit-plugin');
  assert.equal(rows[1].action, 'approve');
  assert.equal(rows[1].target_id, 'audit-plugin');
  assert.equal(rows[2].action, 'revoke');
  assert.equal(rows[2].target_id, 'audit-plugin');
  assert.match(rows[1].details || '', /"approved":true/);
  assert.match(rows[2].details || '', /"approved":false/);
});
