// Schema for the MCP server (docs/design/mcp/02-phase1-spec.md §8).
//
// Unlike the startup migrations in db.js, this one is reversible: `down()`
// removes everything `up()` creates, and test/mcpMigration.test.js runs both.
// Every object is self-contained (no column added to an existing table), so
// rolling back never needs a table rebuild and never touches other data.

export const MCP_TABLES = ['mcp_authorization_requests', 'mcp_tokens', 'mcp_auth_codes', 'mcp_grants', 'mcp_clients', 'mcp_settings'];

// Short-lived credentials: never exported in backups and purged on restore, so
// a restored archive cannot bring a revoked token back.
export const MCP_EPHEMERAL_TABLES = ['mcp_tokens', 'mcp_auth_codes', 'mcp_authorization_requests'];

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_settings (
      id TEXT PRIMARY KEY CHECK(id = 'default'),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
      pseudonym_key TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_clients (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('cimd', 'registered')),
      client_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL DEFAULT '[]',
      secret_hash TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      disabled_at TEXT,
      CHECK((kind = 'registered' AND secret_hash IS NOT NULL) OR (kind = 'cimd' AND secret_hash IS NULL))
    );

    CREATE TABLE IF NOT EXISTS mcp_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
      client_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT,
      revoke_reason TEXT CHECK(revoke_reason IN ('user', 'owner', 'client', 'kill_switch', 'refresh_reuse', 'code_replay', 'client_disabled', 'user_inactive'))
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_grants_user ON mcp_grants(user_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_grants_client ON mcp_grants(client_id);

    CREATE TABLE IF NOT EXISTS mcp_auth_codes (
      code_hash TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_expiry ON mcp_auth_codes(expires_at);

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      token_hash TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('access', 'refresh')),
      family_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      absolute_expires_at TEXT,
      rotated_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_grant ON mcp_tokens(grant_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_family ON mcp_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_expiry ON mcp_tokens(expires_at);

    -- A validated /oauth/authorize request waiting for the user's consent.
    -- Bound to the browser that started it through browser_nonce_hash.
    CREATE TABLE IF NOT EXISTS mcp_authorization_requests (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      state TEXT,
      code_challenge TEXT NOT NULL,
      resource TEXT NOT NULL,
      scope TEXT NOT NULL,
      browser_nonce_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_authorization_requests_expiry ON mcp_authorization_requests(expires_at);
  `);
  db.prepare("INSERT OR IGNORE INTO mcp_settings (id, enabled) VALUES ('default', 0)").run();
}

export function down(db) {
  db.transaction(() => {
    for (const table of MCP_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
  })();
}
