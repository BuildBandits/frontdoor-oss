import express from 'express';
import fsp from 'fs/promises';
import { authenticate, isOwner } from '../middleware/auth.js';
import { dbPath, logRbacAudit } from '../db.js';
import { clearAvatarCache, getAvatarCacheStats } from '../services/avatars.js';
import { cleanupAppIconCache, getAppIconCacheStats } from '../services/appIcons.js';
import { getBrandingSettings, serveBrandingLogo, updateBrandingSettings } from '../services/branding.js';
import { respondWithError } from '../services/errors.js';

const router = express.Router();

async function getDatabaseFootprint() {
  const files = [
    { kind: 'database', path: dbPath },
    { kind: 'wal', path: `${dbPath}-wal` },
    { kind: 'shm', path: `${dbPath}-shm` },
  ];

  const parts = await Promise.all(files.map(async (file) => {
    try {
      const stats = await fsp.stat(file.path);
      return { kind: file.kind, bytes: stats.size };
    } catch {
      return { kind: file.kind, bytes: 0 };
    }
  }));

  const totalBytes = parts.reduce((total, part) => total + part.bytes, 0);
  return {
    bytes: totalBytes,
    dbBytes: parts.find((part) => part.kind === 'database')?.bytes || 0,
    walBytes: parts.find((part) => part.kind === 'wal')?.bytes || 0,
    shmBytes: parts.find((part) => part.kind === 'shm')?.bytes || 0,
  };
}

router.get('/', (req, res) => {
  res.json({ branding: getBrandingSettings() });
});

router.put('/', authenticate, isOwner, async (req, res) => {
  try {
    const { branding, auditDetails } = await updateBrandingSettings(req.body || {});
    logRbacAudit(req.user.id, 'update', 'branding', 'default', auditDetails);
    res.json({ branding });
  } catch (error) {
    console.error('Branding update failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_update_branding' });
  }
});

router.post('/avatars/refresh', authenticate, isOwner, async (req, res) => {
  try {
    const result = await clearAvatarCache();
    logRbacAudit(req.user.id, 'refresh', 'branding', 'avatar-cache', {
      removedFiles: result.removed,
      scope: 'avatars',
    });
    res.json(result);
  } catch (error) {
    console.error('Avatar cache refresh failed:', error.message);
    res.status(500).json({ error: 'Failed to refresh avatar cache' });
  }
});

router.get('/cache', authenticate, isOwner, async (req, res) => {
  try {
    const [database, avatarCache, appIconCache] = await Promise.all([
      getDatabaseFootprint(),
      getAvatarCacheStats(),
      getAppIconCacheStats(),
    ]);
    res.json({
      database,
      avatarCache,
      appIconCache,
      totalBytes: database.bytes + avatarCache.bytes + appIconCache.totalBytes,
    });
  } catch (error) {
    console.error('Cache stats load failed:', error.message);
    res.status(500).json({ error: 'Failed to load cache stats' });
  }
});

router.post('/app-icons/cleanup', authenticate, isOwner, async (req, res) => {
  try {
    const result = await cleanupAppIconCache();
    logRbacAudit(req.user.id, 'refresh', 'branding', 'app-icon-cache', {
      removedFiles: result.removed,
      removedBytes: result.removedBytes,
      scope: 'app-icons',
    });
    res.json(result);
  } catch (error) {
    console.error('App icon cache cleanup failed:', error.message);
    res.status(500).json({ error: 'Failed to clean app icon cache' });
  }
});

router.get('/logo', async (req, res) => {
  try {
    await serveBrandingLogo(res);
  } catch (error) {
    console.error('Branding logo serve failed:', error.message);
    res.status(404).end();
  }
});

export default router;
