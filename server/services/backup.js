import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import Database from 'better-sqlite3';
import db from '../db.js';
import { getAppTimeZone } from '../config.js';
import { AVATAR_CACHE_DIR } from './avatars.js';
import { BRANDING_ASSET_DIR } from './branding.js';
import { APP_ICON_CACHE_DIR } from './appIcons.js';
import { PLUGIN_ASSET_DIR } from './plugins.js';
import { UserFacingError } from './errors.js';
import {
  assertValidPassphrase,
  createEncryptStream,
  decryptBackup,
  encryptBackup,
  encryptionFormat,
  isEncryptedBackup,
} from './backupCrypto.js';
import { BACKUP_FORMAT_V2, detectBackupFile, readBackupV2, readNdjsonFileSync, writeBackupV2 } from './backupFormat.js';

export { assertValidPassphrase, isEncryptedBackup };

const BACKUP_VERSION = 1;
const BACKUP_PROGRESS_STAGES = ['database', 'app-icons', 'branding', 'avatars', 'plugins'];

// Tables left out when an export is made with excludeLogs.
const LOG_TABLES = ['access_logs', 'rbac_audit_logs'];
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || null;
  } catch {
    return null;
  }
})();

function resolveBackupBuckets({
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
} = {}) {
  return [
    { key: 'app-icons', dir: appIconDir },
    { key: 'branding', dir: brandingDir },
    { key: 'avatars', dir: avatarCacheDir },
    { key: 'plugins', dir: pluginAssetDir },
  ];
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function formatBackupFileStamp(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: getAppTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(parsed);

  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}-${pick('minute')}-${pick('second')}`;
}

function listTables(dbHandle) {
  return dbHandle.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
}

function listTableColumns(dbHandle, tableName) {
  return dbHandle.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((column) => column.name);
}

function readTableSnapshot(dbHandle, tableName) {
  const columns = listTableColumns(dbHandle, tableName);
  const rows = dbHandle.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all();
  return {
    name: tableName,
    columns,
    rows,
  };
}

// Schema SQL as created on the source installation: startup migrations decide
// what to rebuild by inspecting it, so it is needed to reproduce the source DB.
function readSchema(dbHandle) {
  return dbHandle.prepare(`
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name
  `).all().map((row) => ({ type: row.type, name: row.name, tableName: row.tableName, sql: row.sql }));
}

function collectDatabaseSnapshot(dbHandle = db, { excludeTables = [] } = {}) {
  const tables = listTables(dbHandle)
    .filter((tableName) => !excludeTables.includes(tableName))
    .map((tableName) => readTableSnapshot(dbHandle, tableName));
  return { tables, schema: readSchema(dbHandle) };
}

function readSqliteVersion(dbHandle) {
  try {
    return dbHandle.prepare('SELECT sqlite_version() AS version').get()?.version || null;
  } catch {
    return null;
  }
}

function collectAppMetadata(dbHandle) {
  const sqlite = readSqliteVersion(dbHandle);
  return {
    version: APP_VERSION,
    commit: process.env.COMMIT_SHA || process.env.VITE_COMMIT_SHA || null,
    node: process.version,
    sqlite,
  };
}

function emitBackupProgress(onProgress, stage, progress, completedStages = []) {
  if (typeof onProgress !== 'function') {
    return;
  }

  onProgress({
    stage,
    progress,
    completedStages,
  });
}

async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkFiles(rootDir, absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const buffer = await fsp.readFile(absolutePath);
    results.push({
      path: path.relative(rootDir, absolutePath).split(path.sep).join('/'),
      data: buffer.toString('base64'),
      size: buffer.length,
    });
  }

  return results;
}

async function collectBucketSnapshot(bucket) {
  const files = await walkFiles(bucket.dir);
  return {
    key: bucket.key,
    files,
  };
}

export async function buildBackupSnapshot({
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
  excludeLogs = false,
  onProgress,
} = {}) {
  const excludedTables = excludeLogs ? [...LOG_TABLES] : [];
  const database = collectDatabaseSnapshot(dbHandle, { excludeTables: excludedTables });
  const buckets = [];
  const bucketDefinitions = resolveBackupBuckets({ appIconDir, brandingDir, avatarCacheDir, pluginAssetDir });
  emitBackupProgress(onProgress, 'database', 25, ['database']);

  for (let index = 0; index < bucketDefinitions.length; index += 1) {
    const bucket = bucketDefinitions[index];
    buckets.push(await collectBucketSnapshot(bucket));
    emitBackupProgress(
      onProgress,
      bucket.key,
      25 + ((index + 1) / bucketDefinitions.length) * 75,
      BACKUP_PROGRESS_STAGES.slice(0, index + 2),
    );
  }

  const summary = {
    tableCount: database.tables.length,
    rowCount: database.tables.reduce((total, table) => total + table.rows.length, 0),
    fileCount: buckets.reduce((total, bucket) => total + bucket.files.length, 0),
    fileBytes: buckets.reduce((total, bucket) => total + bucket.files.reduce((bytes, file) => bytes + file.size, 0), 0),
  };

  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: collectAppMetadata(dbHandle),
    options: { excludedTables },
    database,
    buckets,
    summary,
  };
}

export async function createBackupArchive({
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
  excludeLogs = false,
  passphrase = null,
  onProgress,
} = {}) {
  if (passphrase) assertValidPassphrase(passphrase);
  const snapshot = await buildBackupSnapshot({ dbHandle, appIconDir, brandingDir, avatarCacheDir, pluginAssetDir, excludeLogs, onProgress });
  const json = `${JSON.stringify(snapshot)}\n`;
  const gzipped = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  const archive = passphrase ? encryptBackup(gzipped, passphrase) : gzipped;
  const stamp = formatBackupFileStamp(snapshot.createdAt) || snapshot.createdAt.replace(/[:.]/g, '-');

  return {
    archive,
    snapshot,
    fileName: `frontdoor-backup-${stamp}.json.gz${passphrase ? '.enc' : ''}`,
  };
}

function normalizeBackupSnapshot(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new UserFacingError('Invalid backup file', { code: 'backup_invalid' });
  }

  if (payload.version !== BACKUP_VERSION) {
    throw new UserFacingError(`Unsupported backup version: ${payload.version ?? 'missing'}`, { code: 'backup_version_unsupported' });
  }

  if (!payload.database || !Array.isArray(payload.database.tables)) {
    throw new UserFacingError('Backup database payload is missing', { code: 'backup_invalid' });
  }

  if (!Array.isArray(payload.buckets)) {
    throw new UserFacingError('Backup files payload is missing', { code: 'backup_invalid' });
  }

  return payload;
}

function deleteTableRows(dbHandle, tableName) {
  dbHandle.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run();
}

function resetSequenceIfPresent(dbHandle, tableName) {
  const hasSequence = dbHandle.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'sqlite_sequence'
  `).get();

  if (!hasSequence) {
    return;
  }

  dbHandle.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(tableName);
}

function restoreTableSnapshot(dbHandle, tableSnapshot) {
  const currentColumns = new Set(listTableColumns(dbHandle, tableSnapshot.name));
  const insertColumns = tableSnapshot.columns.filter((column) => currentColumns.has(column));
  const droppedColumns = tableSnapshot.columns.filter((column) => !currentColumns.has(column));

  deleteTableRows(dbHandle, tableSnapshot.name);
  resetSequenceIfPresent(dbHandle, tableSnapshot.name);

  if (insertColumns.length === 0) {
    return { inserted: 0, droppedColumns };
  }

  const insertSql = `
    INSERT INTO ${quoteIdentifier(tableSnapshot.name)} (${insertColumns.map(quoteIdentifier).join(', ')})
    VALUES (${insertColumns.map(() => '?').join(', ')})
  `;
  const stmt = dbHandle.prepare(insertSql);
  let inserted = 0;

  for (const row of tableSnapshot.rows || []) {
    stmt.run(...insertColumns.map((column) => (Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null)));
    inserted += 1;
  }

  return { inserted, droppedColumns };
}

function parseAppVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)([a-z]*)/i.exec(String(value || '').trim());
  if (!match) return null;
  return { parts: match.slice(1, 4).map(Number), suffix: match[4].toLowerCase() };
}

// Compares Frontdoor versions such as 1.2.8, 1.2.8c and 1.3.0. Returns 0 when
// either side is missing or unparseable, so unknown versions never block a restore.
export function compareAppVersions(left, right) {
  const a = parseAppVersion(left);
  const b = parseAppVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (a.suffix === b.suffix) return 0;
  return a.suffix > b.suffix ? 1 : -1;
}

function assertSafeBucketPaths(bucketKey, files) {
  for (const file of files || []) {
    if (typeof file.path !== 'string' || !file.path || file.path.includes('..') || path.isAbsolute(file.path)) {
      throw new UserFacingError(`Invalid backup file path in bucket ${bucketKey}`, { code: 'backup_invalid_file_path' });
    }
  }
}

// Writes a bucket into a sibling staging directory, so the live directory is only
// replaced once every file has been written and the database restore committed.
async function stageBucketFiles(bucket, files, stamp) {
  const stagingDir = `${bucket.dir}.restore-${stamp}`;
  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.mkdir(stagingDir, { recursive: true });
  for (const file of files || []) {
    const absolutePath = path.join(stagingDir, file.path.replaceAll('/', path.sep));
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, Buffer.from(file.data || '', 'base64'));
  }
  return { ...bucket, stagingDir, fileCount: (files || []).length };
}

async function copyDirectoryContents(sourceDir, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  const entries = await fsp.readdir(targetDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map((entry) => fsp.rm(path.join(targetDir, entry.name), { recursive: true, force: true })));
  await fsp.cp(sourceDir, targetDir, { recursive: true });
}

async function swapStagedBucket(staged, stamp) {
  const previousDir = `${staged.dir}.restore-previous-${stamp}`;
  let movedPrevious = false;
  try {
    await fsp.mkdir(path.dirname(staged.dir), { recursive: true });
    if (fs.existsSync(staged.dir)) {
      await fsp.rename(staged.dir, previousDir);
      movedPrevious = true;
    }
    await fsp.rename(staged.stagingDir, staged.dir);
  } catch {
    // The directory may be a mount point or locked (Windows): fall back to an in-place copy.
    if (movedPrevious && !fs.existsSync(staged.dir)) {
      await fsp.rename(previousDir, staged.dir).catch(() => {});
      movedPrevious = false;
    }
    await copyDirectoryContents(staged.stagingDir, staged.dir);
    await fsp.rm(staged.stagingDir, { recursive: true, force: true });
  }
  if (movedPrevious) {
    await fsp.rm(previousDir, { recursive: true, force: true });
  }
}

function parseBackupArchive(buffer, { passphrase = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new UserFacingError('Backup file is empty', { code: 'backup_empty' });
  }
  const gzipped = isEncryptedBackup(buffer) ? decryptBackup(buffer, passphrase) : buffer;

  let parsed;
  try {
    parsed = JSON.parse(zlib.gunzipSync(gzipped).toString('utf8'));
  } catch {
    throw new UserFacingError('Backup file is not a valid gzipped JSON archive', { code: 'backup_invalid' });
  }
  const snapshot = normalizeBackupSnapshot(parsed);
  for (const bucket of snapshot.buckets) {
    assertSafeBucketPaths(bucket.key, bucket.files);
  }
  return snapshot;
}

// Describes what a restore of this archive would do, without changing anything.
export async function analyzeBackupArchive(buffer, { dbHandle = db, currentVersion = APP_VERSION, passphrase = null } = {}) {
  if (isV2Buffer(buffer)) {
    return withTempFile(buffer, (filePath) => analyzeBackupFile(filePath, { dbHandle, currentVersion, passphrase }));
  }
  const snapshot = parseBackupArchive(buffer, { passphrase });
  return buildAnalysisReport({
    dbHandle,
    currentVersion,
    createdAt: snapshot.createdAt,
    app: snapshot.app,
    archiveTables: snapshot.database.tables.map((table) => ({ name: table.name, columns: table.columns, rows: (table.rows || []).length })),
    buckets: (snapshot.buckets || []).map((bucket) => ({
      key: bucket.key,
      files: (bucket.files || []).length,
      bytes: (bucket.files || []).reduce((total, file) => total + (Number(file.size) || Buffer.byteLength(String(file.data || ''), 'base64')), 0),
    })),
  });
}

function timestampForFileName(iso = new Date().toISOString()) {
  return formatBackupFileStamp(iso) || iso.replace(/[:.]/g, '-');
}

// Consistent copy of the live SQLite file (VACUUM INTO works while the app is
// running), for exact upgrade rehearsals and forensic copies. Written to
// outputPath as a stream (encrypted with the streamed scheme when a passphrase is set).
export async function writeDatabaseFile({ dbHandle = db, passphrase = null, outputPath }) {
  if (passphrase) assertValidPassphrase(passphrase);
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'frontdoor-db-export-'));
  const target = path.join(workDir, 'frontdoor.db');
  try {
    dbHandle.prepare('VACUUM INTO ?').run(target);
    if (passphrase) {
      await pipeline(fs.createReadStream(target), createEncryptStream(passphrase), fs.createWriteStream(outputPath));
    } else {
      await fsp.copyFile(target, outputPath);
    }
    return { fileName: `frontdoor-database-${timestampForFileName()}.db${passphrase ? '.enc' : ''}` };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

// Buffer variant of writeDatabaseFile, for callers that need the bytes in memory.
export async function exportDatabaseFile({ dbHandle = db, passphrase = null } = {}) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'frontdoor-db-export-out-'));
  try {
    const outputPath = path.join(workDir, 'export');
    const { fileName } = await writeDatabaseFile({ dbHandle, passphrase, outputPath });
    return { buffer: await fsp.readFile(outputPath), fileName };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

function verifyDatabase(dbHandle) {
  const integrityRows = dbHandle.prepare('PRAGMA integrity_check').all();
  const integrity = integrityRows.map((row) => Object.values(row)[0]).join('; ') || 'unknown';
  const foreignKeyViolations = dbHandle.prepare('PRAGMA foreign_key_check').all().length;
  return { integrity, foreignKeyViolations };
}

export async function restoreBackupArchive(buffer, {
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
  currentVersion = APP_VERSION,
  allowNewerVersion = false,
  passphrase = null,
} = {}) {
  if (isV2Buffer(buffer)) {
    return withTempFile(buffer, (filePath) => restoreBackupFile(filePath, {
      dbHandle, appIconDir, brandingDir, avatarCacheDir, pluginAssetDir, currentVersion, allowNewerVersion, passphrase,
    }));
  }
  const snapshot = parseBackupArchive(buffer, { passphrase });
  const sourceVersion = snapshot.app?.version || null;

  if (!allowNewerVersion && compareAppVersions(sourceVersion, currentVersion) > 0) {
    throw new UserFacingError(
      `This backup was created by Frontdoor ${sourceVersion}, which is newer than the installed ${currentVersion}.`,
      { statusCode: 409, code: 'backup_from_newer_version', details: { sourceVersion, currentVersion } },
    );
  }

  const dbTables = new Map(snapshot.database.tables.map((table) => [table.name, table]));
  const currentTables = listTables(dbHandle);
  const restoreOrder = currentTables.filter((tableName) => dbTables.has(tableName));
  const ignoredTables = [...dbTables.keys()].filter((tableName) => !currentTables.includes(tableName)).sort();
  const tablesNotInArchive = currentTables.filter((tableName) => !dbTables.has(tableName));
  const restoreCounts = { tables: 0, rows: 0, files: 0 };
  const droppedColumns = {};
  const stamp = `${Date.now()}-${process.pid}`;

  // 1. Stage every bucket first: a failure here leaves database and files untouched.
  const staged = [];
  try {
    for (const bucket of resolveBackupBuckets({ appIconDir, brandingDir, avatarCacheDir, pluginAssetDir })) {
      const sourceBucket = snapshot.buckets.find((entry) => entry.key === bucket.key);
      if (!sourceBucket) continue; // Older archives: leave folders they do not contain untouched.
      staged.push(await stageBucketFiles(bucket, sourceBucket.files, stamp));
    }
  } catch (error) {
    await Promise.all(staged.map((entry) => fsp.rm(entry.stagingDir, { recursive: true, force: true })));
    for (const bucket of resolveBackupBuckets({ appIconDir, brandingDir, avatarCacheDir, pluginAssetDir })) {
      await fsp.rm(`${bucket.dir}.restore-${stamp}`, { recursive: true, force: true });
    }
    throw error;
  }

  // 2. Replace the database rows in a single transaction.
  dbHandle.exec('PRAGMA foreign_keys = OFF');
  try {
    dbHandle.exec('BEGIN IMMEDIATE');
    try {
      for (const tableName of restoreOrder) {
        const { inserted, droppedColumns: dropped } = restoreTableSnapshot(dbHandle, dbTables.get(tableName));
        restoreCounts.rows += inserted;
        restoreCounts.tables += 1;
        if (dropped.length > 0) droppedColumns[tableName] = dropped;
      }
      dbHandle.exec('COMMIT');
    } catch (error) {
      dbHandle.exec('ROLLBACK');
      await Promise.all(staged.map((entry) => fsp.rm(entry.stagingDir, { recursive: true, force: true })));
      throw error;
    }
  } finally {
    dbHandle.exec('PRAGMA foreign_keys = ON');
  }

  // 3. Swap the staged folders in.
  for (const entry of staged) {
    await swapStagedBucket(entry, stamp);
    restoreCounts.files += entry.fileCount;
  }

  return {
    snapshot,
    sourceVersion,
    restoredTables: restoreCounts.tables,
    restoredRows: restoreCounts.rows,
    restoredFiles: restoreCounts.files,
    droppedColumns,
    ignoredTables,
    tablesNotInArchive,
    verification: verifyDatabase(dbHandle),
  };
}

// --- Format v2 (streaming, file based) ---------------------------------------

// True when an in-memory buffer holds a v2 archive (plain or stream-encrypted).
function isV2Buffer(buffer) {
  if (encryptionFormat(buffer) === 2) return true;
  if (!(buffer?.[0] === 0x1f && buffer?.[1] === 0x8b)) return false;
  try {
    const head = zlib.gunzipSync(buffer.subarray(0, 4096), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    return head.subarray(0, 13).toString('utf8') === 'manifest.json';
  } catch {
    return false;
  }
}

async function withTempFile(buffer, run) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'frontdoor-backup-buffer-'));
  try {
    const filePath = path.join(workDir, 'archive');
    await fsp.writeFile(filePath, buffer);
    return await run(filePath);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

function buildAnalysisReport({ dbHandle, currentVersion, createdAt, app, archiveTables, buckets }) {
  const currentTables = listTables(dbHandle);
  const tables = archiveTables
    .filter((table) => currentTables.includes(table.name))
    .map((table) => {
      const currentColumns = new Set(listTableColumns(dbHandle, table.name));
      return {
        name: table.name,
        rows: table.rows,
        droppedColumns: (table.columns || []).filter((column) => !currentColumns.has(column)),
      };
    });
  const ignoredTables = archiveTables.map((table) => table.name).filter((name) => !currentTables.includes(name)).sort();
  const tablesNotInArchive = currentTables.filter((name) => !archiveTables.some((table) => table.name === name));
  const sourceVersion = app?.version || null;
  const newerThanCurrent = compareAppVersions(sourceVersion, currentVersion) > 0;

  const warnings = [];
  if (newerThanCurrent) warnings.push('newer_version');
  if (tables.some((table) => table.droppedColumns.length > 0)) warnings.push('dropped_columns');
  if (ignoredTables.length > 0) warnings.push('ignored_tables');

  return {
    createdAt: createdAt || null,
    sourceVersion,
    sourceCommit: app?.commit || null,
    currentVersion,
    newerThanCurrent,
    tables,
    totalRows: tables.reduce((total, table) => total + table.rows, 0),
    ignoredTables,
    tablesNotInArchive,
    buckets,
    warnings,
  };
}

/**
 * Runs fn with a read-only connection holding one read transaction, so every table
 * comes from the same point in time and the shared connection stays free for writes
 * while rows are streamed (WAL readers never block writers). In-memory databases
 * cannot be reopened and are read through the given handle.
 */
async function withReadSnapshot(dbHandle, fn) {
  const file = dbHandle.name;
  if (!file || file === ':memory:' || dbHandle.memory) return fn(dbHandle);
  const snapshot = new Database(file, { readonly: true, fileMustExist: true });
  try {
    snapshot.pragma('busy_timeout = 5000');
    snapshot.exec('BEGIN');
    // The snapshot starts with the first read.
    snapshot.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    try {
      return await fn(snapshot);
    } finally {
      snapshot.exec('COMMIT');
    }
  } finally {
    snapshot.close();
  }
}

/**
 * Writes a backup in format v2 to outputPath, streaming rows and files.
 */
export async function createBackupFile({
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
  excludeLogs = false,
  passphrase = null,
  outputPath,
  onProgress,
} = {}) {
  if (passphrase) assertValidPassphrase(passphrase);
  const excludedTables = excludeLogs ? [...LOG_TABLES] : [];
  const createdAt = new Date().toISOString();
  const completed = [];
  const { manifest } = await withReadSnapshot(dbHandle, (source) => writeBackupV2({
    dbHandle: source,
    tables: listTables(source).filter((tableName) => !excludedTables.includes(tableName)),
    schema: readSchema(source),
    buckets: resolveBackupBuckets({ appIconDir, brandingDir, avatarCacheDir, pluginAssetDir }),
    app: collectAppMetadata(source),
    options: { excludedTables },
    createdAt,
    outputPath,
    passphrase,
    onProgress: (stage) => {
      completed.push(stage);
      emitBackupProgress(onProgress, stage, Math.round((completed.length / BACKUP_PROGRESS_STAGES.length) * 100), [...completed]);
    },
  }));
  return {
    manifest,
    summary: manifest.summary,
    version: BACKUP_FORMAT_V2,
    fileName: `frontdoor-backup-${timestampForFileName(createdAt)}.tar.gz${passphrase ? '.enc' : ''}`,
  };
}

/**
 * Describes a backup file (v1 or v2) without changing anything.
 */
export async function analyzeBackupFile(filePath, { dbHandle = db, currentVersion = APP_VERSION, passphrase = null } = {}) {
  const { format } = await detectBackupFile(filePath);
  if (format === 1) {
    return analyzeBackupArchive(await fsp.readFile(filePath), { dbHandle, currentVersion, passphrase });
  }
  const rowCounts = {};
  const manifest = await readBackupV2(filePath, {
    passphrase,
    onTable: async (name, rows) => {
      let count = 0;
      for await (const row of rows) {
        void row;
        count += 1;
      }
      rowCounts[name] = count;
    },
  });
  return buildAnalysisReport({
    dbHandle,
    currentVersion,
    createdAt: manifest.createdAt,
    app: manifest.app,
    archiveTables: (manifest.tables || []).map((table) => ({ name: table.name, columns: table.columns, rows: rowCounts[table.name] ?? 0 })),
    buckets: (manifest.buckets || []).map((bucket) => ({ key: bucket.key, files: bucket.files, bytes: bucket.bytes })),
  });
}

/**
 * Restores a backup file (v1 or v2). v2 archives are streamed: files go
 * straight into staging folders and rows into temporary NDJSON files, then the
 * database is replaced in one synchronous transaction and the folders swapped.
 */
export async function restoreBackupFile(filePath, {
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
  currentVersion = APP_VERSION,
  allowNewerVersion = false,
  passphrase = null,
} = {}) {
  const dirs = { appIconDir, brandingDir, avatarCacheDir, pluginAssetDir };
  const { format } = await detectBackupFile(filePath);
  if (format === 1) {
    const { snapshot: _snapshot, ...result } = await restoreBackupArchive(await fsp.readFile(filePath), {
      dbHandle, ...dirs, currentVersion, allowNewerVersion, passphrase,
    });
    return result;
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'frontdoor-restore-'));
  const bucketByKey = new Map(resolveBackupBuckets(dirs).map((bucket) => [bucket.key, bucket]));
  const staged = new Map();
  const tableFiles = new Map();
  let sourceVersion = null;

  const cleanupStaging = () => Promise.all([...staged.values()].map((entry) => fsp.rm(entry.stagingDir, { recursive: true, force: true })));

  let manifest;
  try {
    manifest = await readBackupV2(filePath, {
      passphrase,
      onManifest: async (value) => {
        sourceVersion = value.app?.version || null;
        if (!allowNewerVersion && compareAppVersions(sourceVersion, currentVersion) > 0) {
          throw new UserFacingError(
            `This backup was created by Frontdoor ${sourceVersion}, which is newer than the installed ${currentVersion}.`,
            { statusCode: 409, code: 'backup_from_newer_version', details: { sourceVersion, currentVersion } },
          );
        }
        // Folders present in the archive are replaced (even if empty); others stay untouched.
        for (const archived of value.buckets || []) {
          const bucket = bucketByKey.get(archived.key);
          if (!bucket) continue;
          const stagingDir = `${bucket.dir}.restore-${stamp}`;
          await fsp.rm(stagingDir, { recursive: true, force: true });
          await fsp.mkdir(stagingDir, { recursive: true });
          staged.set(archived.key, { ...bucket, stagingDir, fileCount: 0 });
        }
      },
      onTable: async (name, rows) => {
        const tableFile = path.join(workDir, `${name}.ndjson`);
        const out = fs.createWriteStream(tableFile);
        for await (const row of rows) {
          if (!out.write(`${JSON.stringify(row)}\n`)) await new Promise((resolve) => out.once('drain', resolve));
        }
        await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
        tableFiles.set(name, tableFile);
      },
      onFile: async (bucketKey, relativePath, size, content) => {
        const entry = staged.get(bucketKey);
        if (!entry) return;
        const target = path.join(entry.stagingDir, ...relativePath.split('/'));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await pipeline(content, fs.createWriteStream(target));
        entry.fileCount += 1;
      },
    });
  } catch (error) {
    await cleanupStaging();
    await fsp.rm(workDir, { recursive: true, force: true });
    throw error;
  }

  const archiveTables = manifest.tables || [];
  const currentTables = listTables(dbHandle);
  const restoreOrder = currentTables.filter((tableName) => archiveTables.some((table) => table.name === tableName));
  const ignoredTables = archiveTables.map((table) => table.name).filter((name) => !currentTables.includes(name)).sort();
  const tablesNotInArchive = currentTables.filter((name) => !archiveTables.some((table) => table.name === name));
  const droppedColumns = {};
  const counts = { tables: 0, rows: 0, files: 0 };

  try {
    dbHandle.exec('PRAGMA foreign_keys = OFF');
    try {
      dbHandle.exec('BEGIN IMMEDIATE');
      try {
        for (const tableName of restoreOrder) {
          const table = archiveTables.find((entry) => entry.name === tableName);
          const currentColumns = new Set(listTableColumns(dbHandle, tableName));
          const insertColumns = (table.columns || []).filter((column) => currentColumns.has(column));
          const dropped = (table.columns || []).filter((column) => !currentColumns.has(column));
          if (dropped.length > 0) droppedColumns[tableName] = dropped;

          deleteTableRows(dbHandle, tableName);
          resetSequenceIfPresent(dbHandle, tableName);
          counts.tables += 1;
          const tableFile = tableFiles.get(tableName);
          if (insertColumns.length === 0 || !tableFile) continue;

          const stmt = dbHandle.prepare(`
            INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns.map(quoteIdentifier).join(', ')})
            VALUES (${insertColumns.map(() => '?').join(', ')})
          `);
          // Synchronous reads: the open transaction never yields to other requests.
          for (const row of readNdjsonFileSync(tableFile)) {
            stmt.run(...insertColumns.map((column) => (Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null)));
            counts.rows += 1;
          }
        }
        dbHandle.exec('COMMIT');
      } catch (error) {
        dbHandle.exec('ROLLBACK');
        throw error;
      }
    } finally {
      dbHandle.exec('PRAGMA foreign_keys = ON');
    }
  } catch (error) {
    await cleanupStaging();
    await fsp.rm(workDir, { recursive: true, force: true });
    throw error;
  }

  for (const entry of staged.values()) {
    await swapStagedBucket(entry, stamp);
    counts.files += entry.fileCount;
  }
  await fsp.rm(workDir, { recursive: true, force: true });

  return {
    sourceVersion,
    restoredTables: counts.tables,
    restoredRows: counts.rows,
    restoredFiles: counts.files,
    droppedColumns,
    ignoredTables,
    tablesNotInArchive,
    verification: verifyDatabase(dbHandle),
  };
}

export { BACKUP_PROGRESS_STAGES, BACKUP_VERSION, resolveBackupBuckets };
