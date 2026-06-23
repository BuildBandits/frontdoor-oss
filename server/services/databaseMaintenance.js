import fsp from 'fs/promises';
import db, { dbPath } from '../db.js';

async function readFileSize(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

export async function getDatabaseFootprint({ dbHandle = db, databasePath = dbPath } = {}) {
  const [dbBytes, walBytes, shmBytes, pageSize, pageCount, freelistCount] = await Promise.all([
    readFileSize(databasePath),
    readFileSize(`${databasePath}-wal`),
    readFileSize(`${databasePath}-shm`),
    Promise.resolve(dbHandle.pragma('page_size', { simple: true })),
    Promise.resolve(dbHandle.pragma('page_count', { simple: true })),
    Promise.resolve(dbHandle.pragma('freelist_count', { simple: true })),
  ]);

  const bytes = dbBytes + walBytes + shmBytes;
  const reclaimableBytes = Math.max(0, (freelistCount || 0) * (pageSize || 0));

  return {
    bytes,
    dbBytes,
    walBytes,
    shmBytes,
    pageSize: pageSize || 0,
    pageCount: pageCount || 0,
    freelistCount: freelistCount || 0,
    reclaimableBytes,
  };
}

export async function compactDatabaseStorage({ dbHandle = db, databasePath = dbPath } = {}) {
  const before = await getDatabaseFootprint({ dbHandle, databasePath });

  dbHandle.pragma('wal_checkpoint(TRUNCATE)');
  dbHandle.exec('VACUUM');

  const after = await getDatabaseFootprint({ dbHandle, databasePath });

  return {
    before,
    after,
    reclaimedBytes: Math.max(0, before.bytes - after.bytes),
    reclaimedPages: Math.max(0, before.freelistCount - after.freelistCount),
  };
}
