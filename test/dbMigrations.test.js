import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const dbModuleUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'db.js')).href;

function createLegacyDatabase(statements) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-migrations-'));
  const databasePath = path.join(dir, 'legacy.db');
  const legacy = new Database(databasePath);
  legacy.exec(statements);
  legacy.close();
  return { dir, databasePath };
}

// db.js runs its migrations on import, so each startup happens in a fresh process.
function startServerDatabase(databasePath) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(dbModuleUrl)});`], {
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: 'utf8',
  });
}

function columnsOf(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

test('legacy role and language migrations keep data and late-added columns', () => {
  const { dir, databasePath } = createLegacyDatabase(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      microsoft_id TEXT UNIQUE,
      role TEXT DEFAULT 'user' CHECK(role IN ('superadmin', 'admin', 'user')),
      avatar_color TEXT,
      preferred_language TEXT CHECK(preferred_language IN ('en', 'it')),
      favorite_apps TEXT,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, email, role, preferred_language, favorite_apps)
    VALUES ('u-1', 'legacy@example.com', 'superadmin', 'it', '["app-1"]');

    CREATE TABLE branding_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      hero_title_line1 TEXT NOT NULL,
      hero_title_line2 TEXT NOT NULL,
      hero_subtitle TEXT NOT NULL,
      default_language TEXT DEFAULT 'en' CHECK(default_language IN ('en', 'it')),
      logo_file_name TEXT,
      logo_content_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO branding_settings (id, hero_title_line1, hero_title_line2, hero_subtitle, default_language)
    VALUES ('default', 'Legacy', 'Title', 'Subtitle', 'it');
  `);

  try {
    const result = startServerDatabase(databasePath);
    assert.equal(result.status, 0, result.stderr);

    const db = new Database(databasePath, { readonly: true });
    try {
      const user = db.prepare('SELECT role, preferred_language, favorite_apps FROM users WHERE id = ?').get('u-1');
      assert.deepEqual(user, { role: 'owner', preferred_language: 'it', favorite_apps: '["app-1"]' });

      const branding = db.prepare("SELECT hero_title_line1, default_language FROM branding_settings WHERE id = 'default'").get();
      assert.deepEqual(branding, { hero_title_line1: 'Legacy', default_language: 'it' });

      const brandingColumns = columnsOf(db, 'branding_settings');
      for (const column of ['hero_title_line1_i18n', 'hero_title_line2_i18n', 'hero_subtitle_i18n', 'plugins_enabled']) {
        assert.ok(brandingColumns.includes(column), `branding_settings.${column} missing after migration`);
      }
      assert.ok(columnsOf(db, 'users').includes('last_activity_at'));
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing table rebuild rolls back and leaves the original table intact', () => {
  const { dir, databasePath } = createLegacyDatabase(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      target_url TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'redirect' CHECK(mode IN ('redirect', 'shared-cookie', 'legacy-mode')),
      sso_endpoint TEXT,
      sso_method TEXT,
      long_description TEXT,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO apps (id, name, slug, target_url, mode)
    VALUES ('a-1', 'Legacy app', 'legacy-app', 'https://legacy.example.com', 'legacy-mode');
  `);

  try {
    // 'legacy-mode' violates the new CHECK constraint, so the copy step fails.
    const first = startServerDatabase(databasePath);
    assert.notEqual(first.status, 0);

    const db = new Database(databasePath, { readonly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('apps', 'apps_new')").all().map((row) => row.name);
      assert.deepEqual(tables, ['apps']);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM apps').get().count, 1);
    } finally {
      db.close();
    }

    // A second start must fail the same way rather than on a leftover apps_new table.
    const second = startServerDatabase(databasePath);
    assert.notEqual(second.status, 0);
    assert.doesNotMatch(second.stderr, /apps_new already exists/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy audit table gains the impersonation target type and session column', () => {
  const { dir, databasePath } = createLegacyDatabase(`
    CREATE TABLE rbac_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('group', 'membership', 'permission', 'role', 'user_status', 'app', 'branding', 'auth', 'plugin')),
      target_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO rbac_audit_logs (actor_id, action, target_type, target_id) VALUES ('u-1', 'update', 'role', 'u-2');
  `);

  try {
    const result = startServerDatabase(databasePath);
    assert.equal(result.status, 0, result.stderr);

    const db = new Database(databasePath);
    try {
      assert.ok(columnsOf(db, 'rbac_audit_logs').includes('impersonation_session_id'));
      assert.ok(columnsOf(db, 'impersonation_sessions').includes('expiry_reason'));
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rbac_audit_logs').get().count, 1);
      db.prepare("INSERT INTO rbac_audit_logs (actor_id, action, target_type, target_id, impersonation_session_id) VALUES ('u-1', 'start', 'impersonation', 'u-2', 1)").run();
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
