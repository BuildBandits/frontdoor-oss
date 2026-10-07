import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import db from '../db.js';
import { getAppTimeZone } from '../config.js';
import { AVATAR_CACHE_DIR } from './avatars.js';
import { BRANDING_ASSET_DIR } from './branding.js';
import { APP_ICON_CACHE_DIR } from './appIcons.js';
import { PLUGIN_ASSET_DIR } from './plugins.js';
import { UserFacingError } from './errors.js';

const BACKUP_VERSION = 1;
const BACKUP_PROGRESS_STAGES = ['database', 'app-icons', 'branding', 'avatars', 'plugins'];

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

function collectDatabaseSnapshot(dbHandle = db) {
  const tables = listTables(dbHandle).map((tableName) => readTableSnapshot(dbHandle, tableName));
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
  onProgress,
} = {}) {
  const database = collectDatabaseSnapshot(dbHandle);
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
  onProgress,
} = {}) {
  const snapshot = await buildBackupSnapshot({ dbHandle, appIconDir, brandingDir, avatarCacheDir, pluginAssetDir, onProgress });
  const json = `${JSON.stringify(snapshot)}\n`;
  const archive = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });

  return {
    archive,
    snapshot,
    fileName: `frontdoor-backup-${formatBackupFileStamp(snapshot.createdAt) || snapshot.createdAt.replace(/[:.]/g, '-')}.json.gz`,
  };
}

function normalizeBackupSnapshot(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new UserFacingError('Invalid backup file');
  }

  if (payload.version !== BACKUP_VERSION) {
    throw new UserFacingError(`Unsupported backup version: ${payload.version ?? 'missing'}`);
  }

  if (!payload.database || !Array.isArray(payload.database.tables)) {
    throw new UserFacingError('Backup database payload is missing');
  }

  if (!Array.isArray(payload.buckets)) {
    throw new UserFacingError('Backup files payload is missing');
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
      throw new UserFacingError(`Invalid backup file path in bucket ${bucketKey}`);
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
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new UserFacingError('Backup file is empty');
  }

  let parsed;
  try {
    const json = zlib.gunzipSync(buffer).toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new UserFacingError('Backup file is not a valid gzipped JSON archive');
  }
  const snapshot = normalizeBackupSnapshot(parsed);
  const sourceVersion = snapshot.app?.version || null;

  if (!allowNewerVersion && compareAppVersions(sourceVersion, currentVersion) > 0) {
    throw new UserFacingError(
      `This backup was created by Frontdoor ${sourceVersion}, which is newer than the installed ${currentVersion}.`,
      { statusCode: 409, code: 'backup_from_newer_version', details: { sourceVersion, currentVersion } },
    );
  }

  for (const bucket of snapshot.buckets) {
    assertSafeBucketPaths(bucket.key, bucket.files);
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

export { BACKUP_PROGRESS_STAGES, BACKUP_VERSION, resolveBackupBuckets };
