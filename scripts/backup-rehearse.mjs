// Rehearses an upgrade: rebuilds the source database from a Frontdoor backup
// (or takes a raw database export), runs this version's startup migrations on a
// copy, and reports schema and row-count changes plus integrity checks.
// Everything happens in a temporary directory that is removed afterwards.
//
// Usage:
//   npm run backup:rehearse -- <backup (.tar.gz / .json.gz) | database export (.db)>[.enc] [--json]
// Encrypted files need FRONTDOOR_BACKUP_PASSPHRASE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createDecryptStream, decryptBackup, encryptionFormat } from '../server/services/backupCrypto.js';
import { detectBackupFile, readBackupV2, readNdjsonFileSync } from '../server/services/backupFormat.js';

const SQLITE_HEADER = 'SQLite format 3';
const dbModuleUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'db.js')).href;

class UsageError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const input = args.find((arg) => !arg.startsWith('--'));

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function readHead(filePath, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytes = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytes);
  } finally {
    fs.closeSync(fd);
  }
}

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

function insertRows(db, tableName, columns, rows) {
  const current = new Set(db.prepare(`PRAGMA table_info(${quote(tableName)})`).all().map((column) => column.name));
  const usable = columns.filter((column) => current.has(column));
  if (usable.length === 0) return;
  const insert = db.prepare(`INSERT INTO ${quote(tableName)} (${usable.map(quote).join(', ')}) VALUES (${usable.map(() => '?').join(', ')})`);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${quote(tableName)}`).run();
    for (const row of rows) insert.run(usable.map((column) => row[column] ?? null));
  })();
}

async function decryptToFile(source, target) {
  const passphrase = process.env.FRONTDOOR_BACKUP_PASSPHRASE;
  if (!passphrase) throw new UsageError('This file is encrypted: set FRONTDOOR_BACKUP_PASSPHRASE.', 2);
  try {
    if (encryptionFormat(readHead(source, 8)) === 1) {
      fs.writeFileSync(target, decryptBackup(fs.readFileSync(source), passphrase));
    } else {
      await pipeline(await createDecryptStream(source, passphrase), fs.createWriteStream(target));
    }
  } catch (error) {
    throw new UsageError(error.message, 1);
  }
}

// Builds source.db from a v2 archive: schema first, then each table, then indexes.
async function buildFromV2(archivePath, sourcePath, workDir) {
  const db = new Database(sourcePath);
  let schema = [];
  let sourceVersion = null;
  const columnsByTable = new Map();
  try {
    await readBackupV2(archivePath, {
      onManifest: (manifest) => {
        sourceVersion = manifest.app?.version || null;
        for (const table of manifest.tables || []) columnsByTable.set(table.name, table.columns || []);
      },
      onSchema: (value) => {
        schema = Array.isArray(value) ? value : [];
        for (const entry of schema.filter((item) => item.type === 'table')) db.exec(entry.sql);
      },
      onTable: async (name, rows) => {
        if (!listTables(db).includes(name)) {
          for await (const row of rows) void row;
          return;
        }
        const tableFile = path.join(workDir, `${name}.ndjson`);
        const out = fs.createWriteStream(tableFile);
        for await (const row of rows) {
          if (!out.write(`${JSON.stringify(row)}\n`)) await new Promise((resolve) => out.once('drain', resolve));
        }
        await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
        db.pragma('foreign_keys = OFF');
        insertRows(db, name, columnsByTable.get(name) || [], readNdjsonFileSync(tableFile));
        fs.rmSync(tableFile, { force: true });
      },
    });
    for (const entry of schema.filter((item) => item.type !== 'table')) db.exec(entry.sql);
    return sourceVersion;
  } finally {
    db.close();
  }
}

async function main() {
  if (!input) throw new UsageError('Usage: npm run backup:rehearse -- <backup file or .db export> [--json]', 2);
  if (!fs.existsSync(input)) throw new UsageError(`${input} does not exist.`, 2);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-rehearse-'));
  try {
    let plainPath = input;
    if (encryptionFormat(readHead(input, 8))) {
      plainPath = path.join(workDir, 'decrypted');
      await decryptToFile(input, plainPath);
    }

    const sourcePath = path.join(workDir, 'source.db');
    const migratedPath = path.join(workDir, 'migrated.db');
    const notes = [];
    let mode;
    let sourceVersion = null;

    if (readHead(plainPath, SQLITE_HEADER.length).toString('latin1') === SQLITE_HEADER) {
      mode = 'database-file';
      fs.copyFileSync(plainPath, sourcePath);
    } else {
      let format;
      try {
        ({ format } = await detectBackupFile(plainPath));
      } catch {
        throw new UsageError('Not a Frontdoor backup, database export or encrypted file.', 1);
      }

      if (format === 2) {
        mode = 'archive-schema';
        sourceVersion = await buildFromV2(plainPath, sourcePath, workDir);
      } else {
        const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(plainPath)).toString('utf8'));
        sourceVersion = snapshot.app?.version || null;
        const schema = snapshot.database?.schema;
        const tables = snapshot.database?.tables || [];
        if (Array.isArray(schema) && schema.some((entry) => entry.type === 'table')) {
          // Rebuild the source database exactly as it was: its schema, then its rows.
          mode = 'archive-schema';
          const db = new Database(sourcePath);
          try {
            for (const entry of schema.filter((item) => item.type === 'table')) db.exec(entry.sql);
            db.pragma('foreign_keys = OFF');
            const existing = listTables(db);
            for (const table of tables) {
              if (existing.includes(table.name) && table.rows?.length) insertRows(db, table.name, table.columns, table.rows);
            }
            for (const entry of schema.filter((item) => item.type !== 'table')) db.exec(entry.sql);
          } finally {
            db.close();
          }
        } else {
          // Older archives carry no schema: only the restore path can be rehearsed.
          mode = 'archive-restore';
          notes.push('The archive has no schema (created before Frontdoor 1.3.1): rehearsing a restore into the current schema instead of an in-place upgrade.');
          const created = runMigrations(workDir, sourcePath);
          if (created.status !== 0) throw new UsageError(`Could not create the current schema:\n${created.log.join('\n')}`, 1);
          const db = new Database(sourcePath);
          try {
            db.pragma('foreign_keys = OFF');
            const existing = listTables(db);
            for (const table of tables) {
              if (existing.includes(table.name)) insertRows(db, table.name, table.columns, table.rows || []);
            }
          } finally {
            db.close();
          }
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

    const totals = (side) => ({
      tables: Object.keys(side.counts).length,
      rows: Object.values(side.counts).reduce((a, b) => a + b, 0),
      integrity: side.integrity,
      foreignKeyViolations: side.foreignKeyViolations,
    });
    const report = {
      ok,
      mode,
      sourceVersion,
      notes,
      schema: schemaDiff,
      rowCountChanges,
      before: totals(before),
      after: after ? totals(after) : null,
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
    return ok ? 0 : 1;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = error instanceof UsageError ? error.exitCode : 1;
}
