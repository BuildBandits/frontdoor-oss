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

const {
  startSession, endSession, loadSession, sweepExpiredSessions,
  signSessionCookie, readSessionCookie, normalizeReason, canImpersonate,
} = await import('../server/services/impersonation.js');

const MINUTE = 60 * 1000;
const auditRows = (sessionId) => db.prepare('SELECT action, details FROM rbac_audit_logs WHERE impersonation_session_id = ? ORDER BY id').all(sessionId)
  .map((row) => ({ action: row.action, details: JSON.parse(row.details) }));

test('normalizeReason trims and enforces 1–500 characters', () => {
  assert.equal(normalizeReason('  ticket 42  '), 'ticket 42');
  assert.equal(normalizeReason('   '), null);
  assert.equal(normalizeReason('x'.repeat(501)), null);
  assert.equal(normalizeReason(42), null);
});

test('canImpersonate allows admin roles only', () => {
  assert.deepEqual(['owner', 'admin', 'admin_readonly', 'user'].map(canImpersonate), [true, true, true, false]);
});

test('startSession uses the configured timeout and logs the start', () => {
  const now = Date.UTC(2026, 9, 21, 10, 0, 0);
  const { id, expiresAtMs } = startSession({
    adminId: 'svc-admin', targetUserId: 'svc-user', reason: 'ticket 42',
    ipAddress: '192.0.2.10', userAgent: 'TestAgent', adminTokenExpMs: now + 24 * 60 * MINUTE, now,
  });
  assert.equal(expiresAtMs, now + 30 * MINUTE);
  const session = loadSession(id);
  assert.equal(session.expires_at, '2026-10-21 10:30:00');
  assert.equal(session.expiry_reason, 'timeout');
  assert.equal(session.ended_at, null);
  const [start] = auditRows(id);
  assert.equal(start.action, 'start');
  assert.equal(start.details.reason, 'ticket 42');
  assert.equal(start.details.ipAddress, '192.0.2.10');
});

test('a session never outlives the admin token', () => {
  const now = Date.UTC(2026, 9, 21, 10, 0, 0);
  const { id, expiresAtMs } = startSession({
    adminId: 'svc-admin', targetUserId: 'svc-user', reason: 'short token', adminTokenExpMs: now + 5 * MINUTE, now,
  });
  assert.equal(expiresAtMs, now + 5 * MINUTE);
  assert.equal(loadSession(id).expiry_reason, 'session_expired');
});

test('endSession runs once and records reason and duration', () => {
  const now = Date.UTC(2026, 9, 21, 11, 0, 0);
  const { id } = startSession({ adminId: 'svc-admin', targetUserId: 'svc-user', reason: 'end test', now });
  assert.equal(endSession(id, 'manual', now + 90 * 1000), true);
  assert.equal(endSession(id, 'logout', now + 120 * 1000), false);
  const session = loadSession(id);
  assert.equal(session.end_reason, 'manual');
  const end = auditRows(id).find((row) => row.action === 'end');
  assert.equal(end.details.endReason, 'manual');
  assert.equal(end.details.durationSeconds, 90);
});

test('sweepExpiredSessions closes expired sessions with their expiry reason', () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const timedOut = startSession({ adminId: 'svc-admin', targetUserId: 'svc-user', reason: 'sweep a', now }).id;
  const capped = startSession({ adminId: 'svc-admin', targetUserId: 'svc-user', reason: 'sweep b', adminTokenExpMs: now + 5 * MINUTE, now }).id;
  const open = startSession({ adminId: 'svc-admin', targetUserId: 'svc-user', reason: 'sweep c', now: now + 25 * MINUTE }).id;

  sweepExpiredSessions(now + 31 * MINUTE);

  assert.equal(loadSession(timedOut).end_reason, 'timeout');
  assert.equal(loadSession(timedOut).ended_at, '2026-10-21 12:30:00');
  assert.equal(loadSession(capped).end_reason, 'session_expired');
  assert.equal(loadSession(open).ended_at, null);
});

test('session cookies round-trip and reject tampering', () => {
  const token = signSessionCookie(123, Date.now() + 5 * MINUTE);
  assert.equal(readSessionCookie(token), 123);
  assert.equal(readSessionCookie(`${token}x`), null);
  assert.equal(readSessionCookie(undefined), null);
});
