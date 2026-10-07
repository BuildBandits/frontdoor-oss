// Rehearses an upgrade: rebuilds the source database from a Frontdoor backup
// (or takes a raw database export), runs this version's startup migrations on a
// copy, and reports schema and row-count changes plus integrity checks.
// Everything happens in a temporary directory that is removed afterwards.
//
// Usage:
//   npm run backup:rehearse -- <backup.json.gz | backup.json.gz.enc | frontdoor.db | frontdoor.db.enc> [--json]
// Encrypted files need FRONTDOOR_BACKUP_PASSPHRASE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { decryptBackup, isEncryptedBackup } from '../server/services/backupCrypto.js';

const SQLITE_HEADER = 'SQLite format 3';
const dbModuleUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'db.js')).href;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const input = args.find((arg) => !arg.startsWith('--'));

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

if (!input) fail(2, 'Usage: npm run backup:rehearse -- <backup file or .db export> [--json]');

let buffer = fs.readFileSync(input);
if (isEncryptedBackup(buffer)) {
  const passphrase = process.env.FRONTDOOR_BACKUP_PASSPHRASE;
  if (!passphrase) fail(2, 'This file is encrypted: set FRONTDOOR_BACKUP_PASSPHRASE.');
  try {
    buffer = decryptBackup(buffer, passphrase);
  } catch (error) {
    fail(1, error.message);
  }
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function listTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}

function describe(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const schema = Object.fromEntries(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all()
      .map((row) => [`${row.type}:${row.name}`, row.sql]));
    const counts = Object.fromEntries(listTables(db).map((name) => [name, db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n]));
    return {
      schema,
      counts,
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeyViolations: db.pragma('foreign_key_check').length,
    };
  } finally {
    db.close();
  }
}

// Runs db.js (startup migrations) in a child process against dbPath, with every
// data directory pointed at the work dir so nothing outside it is touched.
function runMigrations(workDir, dbPath) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(dbModuleUrl)});`], {
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      APP_ICON_CACHE_DIR: path.join(workDir, 'app-icon-cache'),
      AVATAR_CACHE_DIR: path.join(workDir, 'avatar-cache'),
      BRANDING_ASSET_DIR: path.join(workDir, 'branding'),
      PLUGIN_ASSET_DIR: path.join(workDir, 'plugins'),
    },
    encoding: 'utf8',
  });
  const log = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 200);
  return { status: result.status, log };
}

function insertRows(db, tables) {
  const existing = new Set(listTables(db));
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const table of tables) {
      if (!existing.has(table.name) || !table.rows?.length) continue;
      const current = new Set(db.prepare(`PRAGMA table_info(${quote(table.name)})`).all().map((column) => column.name));
      const columns = table.columns.filter((column) => current.has(column));
      if (columns.length === 0) continue;
      db.prepare(`DELETE FROM ${quote(table.name)}`).run();
      const insert = db.prepare(`INSERT INTO ${quote(table.name)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of table.rows) insert.run(columns.map((column) => row[column] ?? null));
    }
  })();
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-rehearse-'));
const sourcePath = path.join(workDir, 'source.db');
const migratedPath = path.join(workDir, 'migrated.db');
let mode;
let sourceVersion = null;
const notes = [];

try {
  if (buffer.subarray(0, SQLITE_HEADER.length).toString('latin1') === SQLITE_HEADER) {
    mode = 'database-file';
    fs.writeFileSync(sourcePath, buffer);
  } else {
    let snapshot;
    try {
      snapshot = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
    } catch {
      fail(1, 'Not a Frontdoor backup, database export or encrypted file.');
    }
    sourceVersion = snapshot.app?.version || null;
    const schema = snapshot.database?.schema;
    if (Array.isArray(schema) && schema.some((entry) => entry.type === 'table')) {
      // Rebuild the source database exactly as it was: its schema, then its rows.
      mode = 'archive-schema';
      const db = new Database(sourcePath);
      try {
        for (const entry of schema.filter((item) => item.type === 'table')) db.exec(entry.sql);
        insertRows(db, snapshot.database.tables || []);
        for (const entry of schema.filter((item) => item.type !== 'table')) db.exec(entry.sql);
      } finally {
        db.close();
      }
    } else {
      // Older archives carry no schema: only the restore path can be rehearsed.
      mode = 'archive-restore';
      notes.push('The archive has no schema (created before Frontdoor 1.3.1): rehearsing a restore into the current schema instead of an in-place upgrade.');
      const created = runMigrations(workDir, sourcePath);
      if (created.status !== 0) fail(1, `Could not create the current schema:\n${created.log.join('\n')}`);
      const db = new Database(sourcePath);
      try {
        insertRows(db, snapshot.database?.tables || []);
      } finally {
        db.close();
      }
    }
  }

  const before = describe(sourcePath);
  fs.copyFileSync(sourcePath, migratedPath);
  const migration = runMigrations(workDir, migratedPath);
  const after = migration.status === 0 ? describe(migratedPath) : null;

  const schemaKeys = new Set([...Object.keys(before.schema), ...Object.keys(after?.schema || {})]);
  const schemaDiff = { added: [], removed: [], changed: [] };
  for (const key of [...schemaKeys].sort()) {
    if (!(key in before.schema)) schemaDiff.added.push(key);
    else if (!after || !(key in after.schema)) schemaDiff.removed.push(key);
    else if (before.schema[key] !== after.schema[key]) schemaDiff.changed.push(key);
  }
  const rowCountChanges = after
    ? Object.keys(before.counts).filter((name) => name in after.counts && before.counts[name] !== after.counts[name])
      .map((name) => ({ table: name, before: before.counts[name], after: after.counts[name] }))
    : [];
  const ok = migration.status === 0
    && after.integrity === 'ok'
    && rowCountChanges.every((change) => change.after >= change.before);

  const report = {
    ok,
    mode,
    sourceVersion,
    notes,
    schema: schemaDiff,
    rowCountChanges,
    before: { tables: Object.keys(before.counts).length, rows: Object.values(before.counts).reduce((a, b) => a + b, 0), integrity: before.integrity, foreignKeyViolations: before.foreignKeyViolations },
    after: after
      ? { tables: Object.keys(after.counts).length, rows: Object.values(after.counts).reduce((a, b) => a + b, 0), integrity: after.integrity, foreignKeyViolations: after.foreignKeyViolations }
      : null,
    migrationLog: migration.log,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Upgrade rehearsal (${mode})${sourceVersion ? ` from Frontdoor ${sourceVersion}` : ''}: ${ok ? 'OK' : 'PROBLEMS FOUND'}`);
    for (const note of notes) console.log(`Note: ${note}`);
    console.log(`Before: ${report.before.tables} tables, ${report.before.rows} rows, integrity ${report.before.integrity}, ${report.before.foreignKeyViolations} FK violations`);
    if (report.after) console.log(`After:  ${report.after.tables} tables, ${report.after.rows} rows, integrity ${report.after.integrity}, ${report.after.foreignKeyViolations} FK violations`);
    console.log(`Schema: ${schemaDiff.added.length} added, ${schemaDiff.removed.length} removed, ${schemaDiff.changed.length} changed${schemaDiff.changed.length ? ` (${schemaDiff.changed.join(', ')})` : ''}`);
    console.log(rowCountChanges.length ? `Row counts changed: ${rowCountChanges.map((c) => `${c.table} ${c.before} -> ${c.after}`).join(', ')}` : 'Row counts unchanged.');
    if (migration.log.length) console.log(`Migration output:\n  ${migration.log.join('\n  ')}`);
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
