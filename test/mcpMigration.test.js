// The MCP schema is the first reversible migration: down() must remove exactly
// what up() created, leave every other table and row alone, and up() must be
// re-runnable on top of existing MCP data.
import test from 'node:test';
import assert from 'node:assert/strict';

const { default: db } = await import('../server/db.js');
const { up, down, MCP_TABLES } = await import('../server/migrations/mcp.js');

const tableNames = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
const schemaOf = (names) => db.prepare(`SELECT name, sql FROM sqlite_master WHERE tbl_name IN (${names.map(() => '?').join(', ')}) ORDER BY name`).all(...names);

function seedMcpRows() {
  db.prepare("DELETE FROM users WHERE id = 'm-user'").run();
  db.prepare("DELETE FROM mcp_clients WHERE id = 'c1'").run();
  db.prepare("INSERT INTO users (id, email, display_name, role, is_active) VALUES ('m-user', 'm@mcp.test', 'M', 'user', 1)").run();
  db.prepare("INSERT INTO mcp_clients (id, kind, client_id, name, redirect_uris, created_by) VALUES ('c1', 'cimd', 'https://client.example/meta.json', 'Client', '[\"https://client.example/cb\"]', 'm-user')").run();
  db.prepare("INSERT INTO mcp_grants (id, user_id, client_id, client_name, scope) VALUES ('g1', 'm-user', 'https://client.example/meta.json', 'Client', 'frontdoor.read')").run();
  db.prepare("INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at) VALUES ('h1', 'g1', 'access', 'f1', 'http://localhost/mcp', datetime('now', '+10 minutes'))").run();
}

test('startup creates the MCP tables with the MCP switched off', () => {
  for (const table of MCP_TABLES) assert.ok(tableNames().includes(table), table);
  assert.deepEqual(db.prepare('SELECT id, enabled FROM mcp_settings').all(), [{ id: 'default', enabled: 0 }]);
});

test('deleting a user removes their grants and tokens', () => {
  seedMcpRows();
  db.prepare("DELETE FROM users WHERE id = 'm-user'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_grants').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').get().n, 0);
});

test('a registered client needs a secret hash and a CIMD client must not have one', () => {
  assert.throws(() => db.prepare("INSERT INTO mcp_clients (id, kind, client_id, name, created_by) VALUES ('c2', 'registered', 'fd-x', 'X', 'o')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO mcp_clients (id, kind, client_id, name, secret_hash, created_by) VALUES ('c3', 'cimd', 'https://x.example/m', 'X', 'h', 'o')").run(), /CHECK/);
});

test('down() removes only the MCP schema and up() restores it, repeatably', () => {
  seedMcpRows();
  const otherTables = tableNames().filter((name) => !MCP_TABLES.includes(name));
  const otherSchema = schemaOf(otherTables);
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const mcpSchema = schemaOf(MCP_TABLES);

  down(db);
  assert.deepEqual(tableNames(), otherTables);
  assert.deepEqual(schemaOf(otherTables), otherSchema);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, userCount);
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  down(db); // idempotent
  up(db);
  assert.deepEqual(schemaOf(MCP_TABLES), mcpSchema);
  assert.equal(db.prepare('SELECT enabled FROM mcp_settings').get().enabled, 0);

  seedMcpRows();
  up(db); // re-running on existing data keeps it
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').get().n, 1);
});
