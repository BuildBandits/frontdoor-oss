import test, { before } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'impersonation-service-test-secret-0123456789';

const { default: db, logRbacAudit } = await import('../server/db.js');

before(() => {
  const insert = db.prepare('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, ?)');
  insert.run('svc-admin', 'admin@example.com', 'Admin One', 'admin', 1);
  insert.run('svc-user', 'user1@example.com', 'User One', 'user', 1);
});

test('logRbacAudit stores the impersonation session id', () => {
  logRbacAudit('svc-admin', 'write_blocked', 'impersonation', 'svc-user', { method: 'PUT', path: '/api/x' }, 77);
  const row = db.prepare("SELECT impersonation_session_id, details FROM rbac_audit_logs WHERE action = 'write_blocked'").get();
  assert.equal(row.impersonation_session_id, 77);
  assert.equal(JSON.parse(row.details).refs.users['svc-user'], 'User One');
});
