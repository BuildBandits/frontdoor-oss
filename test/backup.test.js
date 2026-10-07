import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

import { createBackupArchive, restoreBackupArchive } from '../server/services/backup.js';

function initSchema(database) {
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      target_url TEXT NOT NULL,
      icon_file_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE branding_settings (
      id TEXT PRIMARY KEY,
      hero_title_line1 TEXT,
      logo_file_name TEXT,
      logo_content_type TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE user_groups (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE user_group_members (
      user_id TEXT REFERENCES users(id),
      group_id TEXT REFERENCES user_groups(id),
      PRIMARY KEY (user_id, group_id)
    );

    CREATE TABLE app_permissions (
      app_id TEXT REFERENCES apps(id),
      group_id TEXT REFERENCES user_groups(id),
      PRIMARY KEY (app_id, group_id)
    );

    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      source_ref TEXT,
      original_name TEXT,
      stored_file_name TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      app_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, relativePath, contents) {
  const absolutePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function toPlainObject(value) {
  return Object.fromEntries(Object.entries(value || {}));
}

describe('backup service', () => {
  let sourceDb;
  let restoreDb;
  let sourceDirs;
  let restoreDirs;

  before(() => {
    sourceDb = new DatabaseSync(':memory:');
    restoreDb = new DatabaseSync(':memory:');
    initSchema(sourceDb);
    initSchema(restoreDb);

    sourceDirs = {
      appIconDir: makeTempDir('frontdoor-backup-app-icons-src-'),
      brandingDir: makeTempDir('frontdoor-backup-branding-src-'),
      avatarCacheDir: makeTempDir('frontdoor-backup-avatars-src-'),
      pluginAssetDir: makeTempDir('frontdoor-backup-plugins-src-'),
    };

    restoreDirs = {
      appIconDir: makeTempDir('frontdoor-backup-app-icons-dst-'),
      brandingDir: makeTempDir('frontdoor-backup-branding-dst-'),
      avatarCacheDir: makeTempDir('frontdoor-backup-avatars-dst-'),
      pluginAssetDir: makeTempDir('frontdoor-backup-plugins-dst-'),
    };
  });

  after(() => {
    sourceDb.close();
    restoreDb.close();
    for (const dir of [...Object.values(sourceDirs), ...Object.values(restoreDirs)]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports database rows and file contents and restores them into a fresh installation', async () => {
    sourceDb.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(
      'user-1',
      'alice@example.com',
      'Alice',
      'owner'
    );
    sourceDb.prepare('INSERT INTO apps (id, name, slug, target_url, icon_file_name) VALUES (?, ?, ?, ?, ?)').run(
      'app-1',
      'App One',
      'app-one',
      'https://app-one.example.com',
      'app-one.svg'
    );
    sourceDb.prepare('INSERT INTO branding_settings (id, hero_title_line1, logo_file_name, logo_content_type) VALUES (?, ?, ?, ?)').run(
      'default',
      'Your apps',
      'company-logo.svg',
      'image/svg+xml'
    );
    sourceDb.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').run('group-1', 'default');
    sourceDb.prepare('INSERT INTO user_group_members (user_id, group_id) VALUES (?, ?)').run('user-1', 'group-1');
    sourceDb.prepare('INSERT INTO app_permissions (app_id, group_id) VALUES (?, ?)').run('app-1', 'group-1');
    sourceDb.prepare('INSERT INTO media_assets (id, kind, source_ref, original_name, stored_file_name, content_type, size_bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'asset-1',
      'app-icon',
      'app-1',
      'app-one.svg',
      'app-one.svg',
      'image/svg+xml',
      42,
      'abc123'
    );
    sourceDb.prepare('INSERT INTO access_logs (user_id, app_id) VALUES (?, ?)').run('user-1', 'app-1');

    writeFile(sourceDirs.appIconDir, 'app-one.svg', '<svg viewBox="0 0 24 24"></svg>');
    writeFile(sourceDirs.brandingDir, 'company-logo.svg', '<svg viewBox="0 0 24 24"></svg>');
    writeFile(sourceDirs.avatarCacheDir, 'user-1.png', Buffer.from([1, 2, 3]));
    writeFile(sourceDirs.avatarCacheDir, 'user-1.json', JSON.stringify({ source: 'gravatar', fileName: 'user-1.png' }));
    writeFile(sourceDirs.pluginAssetDir, 'ticket-plugin/1.0.0/release/plugin.mjs', 'export default {};');

    const progressEvents = [];
    const { archive, snapshot } = await createBackupArchive({
      dbHandle: sourceDb,
      ...sourceDirs,
      onProgress: (event) => progressEvents.push(event),
    });

    assert.equal(snapshot.summary.tableCount > 0, true);
    assert.equal(snapshot.summary.fileCount, 5);
    assert.equal(Buffer.isBuffer(archive), true);
    assert.deepEqual(progressEvents.map((event) => event.stage), ['database', 'app-icons', 'branding', 'avatars', 'plugins']);

    const packageVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    assert.equal(snapshot.app.version, packageVersion);
    assert.equal(snapshot.app.node, process.version);
    assert.match(snapshot.app.sqlite, /^\d+\.\d+\.\d+/);
    const usersSchema = snapshot.database.schema.find((entry) => entry.type === 'table' && entry.name === 'users');
    assert.match(usersSchema.sql, /CREATE TABLE users/);
    assert.ok(snapshot.database.schema.every((entry) => !entry.name.startsWith('sqlite_')));
    assert.equal(progressEvents.at(-1)?.progress, 100);

    writeFile(restoreDirs.appIconDir, 'stale.txt', 'old');
    writeFile(restoreDirs.brandingDir, 'stale.txt', 'old');
    writeFile(restoreDirs.avatarCacheDir, 'stale.txt', 'old');
    writeFile(restoreDirs.pluginAssetDir, 'stale.txt', 'old');

    const result = await restoreBackupArchive(archive, {
      dbHandle: restoreDb,
      ...restoreDirs,
    });

    assert.equal(result.restoredTables > 0, true);
    assert.equal(result.restoredRows > 0, true);
    assert.equal(result.restoredFiles, 5);

    const restoredUser = restoreDb.prepare('SELECT email, display_name, role FROM users WHERE id = ?').get('user-1');
    assert.deepEqual(toPlainObject(restoredUser), {
      email: 'alice@example.com',
      display_name: 'Alice',
      role: 'owner',
    });

    const restoredApp = restoreDb.prepare('SELECT name, slug, icon_file_name FROM apps WHERE id = ?').get('app-1');
    assert.deepEqual(toPlainObject(restoredApp), {
      name: 'App One',
      slug: 'app-one',
      icon_file_name: 'app-one.svg',
    });

    const restoredBranding = restoreDb.prepare('SELECT hero_title_line1, logo_file_name, logo_content_type FROM branding_settings WHERE id = ?').get('default');
    assert.deepEqual(toPlainObject(restoredBranding), {
      hero_title_line1: 'Your apps',
      logo_file_name: 'company-logo.svg',
      logo_content_type: 'image/svg+xml',
    });

    assert.equal(fs.existsSync(path.join(restoreDirs.appIconDir, 'app-one.svg')), true);
    assert.equal(fs.existsSync(path.join(restoreDirs.brandingDir, 'company-logo.svg')), true);
    assert.equal(fs.existsSync(path.join(restoreDirs.avatarCacheDir, 'user-1.png')), true);
    assert.equal(fs.existsSync(path.join(restoreDirs.avatarCacheDir, 'user-1.json')), true);
    assert.equal(fs.existsSync(path.join(restoreDirs.appIconDir, 'stale.txt')), false);
    assert.equal(fs.existsSync(path.join(restoreDirs.brandingDir, 'stale.txt')), false);
    assert.equal(fs.existsSync(path.join(restoreDirs.avatarCacheDir, 'stale.txt')), false);
    assert.equal(fs.existsSync(path.join(restoreDirs.pluginAssetDir, 'ticket-plugin/1.0.0/release/plugin.mjs')), true);
    assert.equal(fs.existsSync(path.join(restoreDirs.pluginAssetDir, 'stale.txt')), false);
  });

  it('restores archives made before app metadata, schema and plugin files were exported', async () => {
    const legacy = {
      version: 1,
      createdAt: '2026-10-07T07:31:59.265Z',
      database: {
        tables: [{ name: 'users', columns: ['id', 'email', 'role'], rows: [{ id: 'legacy-1', email: 'legacy@example.com', role: 'user' }] }],
      },
      buckets: [{ key: 'avatars', files: [] }],
      summary: { tableCount: 1, rowCount: 1, fileCount: 0, fileBytes: 0 },
    };
    writeFile(restoreDirs.pluginAssetDir, 'kept.txt', 'kept');

    const result = await restoreBackupArchive(zlib.gzipSync(Buffer.from(JSON.stringify(legacy))), {
      dbHandle: restoreDb,
      ...restoreDirs,
    });

    assert.equal(result.restoredRows, 1);
    assert.equal(restoreDb.prepare('SELECT email FROM users WHERE id = ?').get('legacy-1').email, 'legacy@example.com');
    // Buckets missing from an older archive are left untouched.
    assert.equal(fs.existsSync(path.join(restoreDirs.pluginAssetDir, 'kept.txt')), true);
  });
});
