// MCP tokens and authorization codes are credentials: a backup must not carry
// them, and a restore must not leave any behind, so an old archive can never
// revive a token revoked after it was taken. Grants and clients are kept.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createBackupArchive, createBackupFile, restoreBackupArchive, restoreBackupFile } from '../server/services/backup.js';
import { up as applyMcpSchema } from '../server/migrations/mcp.js';

const makeTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const emptyDirs = () => ({
  appIconDir: makeTempDir('fd-mcp-icons-'),
  brandingDir: makeTempDir('fd-mcp-branding-'),
  avatarCacheDir: makeTempDir('fd-mcp-avatars-'),
  pluginAssetDir: makeTempDir('fd-mcp-plugins-'),
});

function makeDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT DEFAULT 'user', is_active INTEGER DEFAULT 1)");
  applyMcpSchema(database);
  return database;
}

function seed(database, tokenHash) {
  database.exec("INSERT OR IGNORE INTO users (id, email) VALUES ('u1', 'u1@mcp.test')");
  database.exec("INSERT OR IGNORE INTO mcp_clients (id, kind, client_id, name, created_by) VALUES ('c1', 'cimd', 'https://client.example/m.json', 'Client', 'u1')");
  database.exec("INSERT OR IGNORE INTO mcp_grants (id, user_id, client_id, client_name, scope) VALUES ('g1', 'u1', 'https://client.example/m.json', 'Client', 'frontdoor.read')");
  database.prepare("INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at) VALUES (?, 'g1', 'refresh', 'f1', 'https://fd.example/mcp', datetime('now', '+30 days'))").run(tokenHash);
  database.prepare("INSERT INTO mcp_auth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at) VALUES (?, 'g1', 'https://client.example/cb', 'x', 'https://fd.example/mcp', datetime('now', '+1 minute'))").run(`code-${tokenHash}`);
}

const count = (database, table) => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

describe('MCP credentials in backups', () => {
  it('JSON archive: tokens and codes are left out, and a restore leaves none behind', async () => {
    const source = makeDb();
    const target = makeDb();
    seed(source, 'archived-token');
    seed(target, 'current-token');
    const dirs = emptyDirs();

    const { archive, snapshot } = await createBackupArchive({ dbHandle: source, ...dirs });
    const archived = snapshot.database.tables.map((table) => table.name);
    assert.ok(!archived.includes('mcp_tokens') && !archived.includes('mcp_auth_codes'));
    assert.ok(archived.includes('mcp_grants') && archived.includes('mcp_clients'));

    await restoreBackupArchive(archive, { dbHandle: target, ...dirs });
    assert.equal(count(target, 'mcp_tokens'), 0);
    assert.equal(count(target, 'mcp_auth_codes'), 0);
    assert.equal(count(target, 'mcp_grants'), 1);
  });

  it('v2 file archive: same guarantees', async () => {
    const source = makeDb();
    const target = makeDb();
    seed(source, 'archived-token');
    seed(target, 'current-token');
    const dirs = emptyDirs();
    const outputPath = path.join(makeTempDir('fd-mcp-archive-'), 'backup.tar.gz');

    await createBackupFile({ dbHandle: source, ...dirs, outputPath });
    await restoreBackupFile(outputPath, { dbHandle: target, ...dirs });
    assert.equal(count(target, 'mcp_tokens'), 0);
    assert.equal(count(target, 'mcp_auth_codes'), 0);
    assert.equal(count(target, 'mcp_grants'), 1);
  });
});
