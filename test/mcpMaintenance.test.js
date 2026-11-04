import test from 'node:test';
import assert from 'node:assert/strict';

const { default: db } = await import('../server/db.js');
const { purgeExpiredMcpCredentials } = await import('../server/services/mcp/maintenance.js');

test('the sweep removes expired codes and tokens and old revoked grants only', () => {
  db.exec(`
    INSERT INTO users (id, email, display_name, role, is_active) VALUES ('p-user', 'p@mcp.test', 'P', 'user', 1);
    INSERT INTO mcp_clients (id, kind, client_id, name, created_by) VALUES ('pc', 'cimd', 'https://p.example/m.json', 'P', 'p-user');
    INSERT INTO mcp_grants (id, user_id, client_id, client_name, scope, revoked_at) VALUES
      ('live', 'p-user', 'https://p.example/m.json', 'P', 'frontdoor.read', NULL),
      ('recently-revoked', 'p-user', 'https://p.example/m.json', 'P', 'frontdoor.read', datetime('now', '-1 day')),
      ('long-revoked', 'p-user', 'https://p.example/m.json', 'P', 'frontdoor.read', datetime('now', '-120 days'));
    INSERT INTO mcp_auth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at) VALUES
      ('code-old', 'live', 'https://p.example/cb', 'x', 'r', datetime('now', '-1 minute')),
      ('code-new', 'live', 'https://p.example/cb', 'x', 'r', datetime('now', '+1 minute'));
    INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at, absolute_expires_at) VALUES
      ('t-expired', 'live', 'access', 'f', 'r', datetime('now', '-1 minute'), NULL),
      ('t-valid', 'live', 'access', 'f', 'r', datetime('now', '+5 minutes'), NULL),
      ('t-past-absolute', 'live', 'refresh', 'f', 'r', datetime('now', '+5 days'), datetime('now', '-1 minute')),
      ('t-on-long-revoked', 'long-revoked', 'refresh', 'g', 'r', datetime('now', '+5 days'), NULL);
  `);

  const result = purgeExpiredMcpCredentials(db, { retentionDays: 90 });
  assert.deepEqual(result, { codesRemoved: 1, tokensRemoved: 2, grantsRemoved: 1 });
  assert.deepEqual(db.prepare('SELECT code_hash FROM mcp_auth_codes').all().map((r) => r.code_hash), ['code-new']);
  assert.deepEqual(db.prepare('SELECT token_hash FROM mcp_tokens ORDER BY token_hash').all().map((r) => r.token_hash), ['t-valid']);
  assert.deepEqual(db.prepare('SELECT id FROM mcp_grants ORDER BY id').all().map((r) => r.id), ['live', 'recently-revoked']);
});
