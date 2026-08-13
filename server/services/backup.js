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

function collectDatabaseSnapshot(dbHandle = db) {
  const tables = listTables(dbHandle).map((tableName) => readTableSnapshot(dbHandle, tableName));
  return { tables };
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

  deleteTableRows(dbHandle, tableSnapshot.name);
  resetSequenceIfPresent(dbHandle, tableSnapshot.name);

  if (insertColumns.length === 0) {
    return 0;
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

  return inserted;
}

async function clearBucketDirectory(bucketDir) {
  await fsp.mkdir(bucketDir, { recursive: true });
  const entries = await fsp.readdir(bucketDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map((entry) => fsp.rm(path.join(bucketDir, entry.name), { recursive: true, force: true })));
}

async function restoreBucketFiles(bucket, files) {
  for (const file of files || []) {
    if (typeof file.path !== 'string' || !file.path || file.path.includes('..') || path.isAbsolute(file.path)) {
      throw new UserFacingError(`Invalid backup file path in bucket ${bucket.key}`);
    }
  }

  await clearBucketDirectory(bucket.dir);

  let restored = 0;
  for (const file of files || []) {
    const absolutePath = path.join(bucket.dir, file.path.replaceAll('/', path.sep));
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o750 });
    await fsp.writeFile(
      absolutePath,
      Buffer.from(file.data || '', 'base64'),
      bucket.key === 'plugins' ? { mode: 0o440 } : undefined
    );
    if (bucket.key === 'plugins') {
      await fsp.chmod(absolutePath, 0o440);
    }
    restored += 1;
  }

  return restored;
}

export async function restoreBackupArchive(buffer, {
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
  avatarCacheDir = AVATAR_CACHE_DIR,
  pluginAssetDir = PLUGIN_ASSET_DIR,
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
  const dbTables = new Map(snapshot.database.tables.map((table) => [table.name, table]));

  for (const bucket of snapshot.buckets) {
    for (const file of bucket.files || []) {
      if (typeof file.path !== 'string' || !file.path || file.path.includes('..') || path.isAbsolute(file.path)) {
        throw new UserFacingError(`Invalid backup file path in bucket ${bucket.key}`);
      }
    }
  }

  const restoreOrder = listTables(dbHandle).filter((tableName) => dbTables.has(tableName));
  const restoreCounts = { tables: 0, rows: 0, files: 0 };
  const restoreBuckets = resolveBackupBuckets({ appIconDir, brandingDir, avatarCacheDir, pluginAssetDir });

  dbHandle.exec('PRAGMA foreign_keys = OFF');
  try {
    dbHandle.exec('BEGIN IMMEDIATE');
    try {
      for (const tableName of restoreOrder) {
        restoreCounts.rows += restoreTableSnapshot(dbHandle, dbTables.get(tableName));
        restoreCounts.tables += 1;
      }
      dbHandle.exec('COMMIT');
    } catch (error) {
      dbHandle.exec('ROLLBACK');
      throw error;
    }
  } finally {
    dbHandle.exec('PRAGMA foreign_keys = ON');
  }

  for (const bucket of restoreBuckets) {
    const sourceBucket = snapshot.buckets.find((entry) => entry.key === bucket.key);
    if (!sourceBucket) {
      continue;
    }
    restoreCounts.files += await restoreBucketFiles(bucket, sourceBucket.files);
  }

  return {
    snapshot,
    restoredTables: restoreCounts.tables,
    restoredRows: restoreCounts.rows,
    restoredFiles: restoreCounts.files,
  };
}

export { BACKUP_VERSION, resolveBackupBuckets };
