import express from 'express';
import { authenticate, isOwner } from '../middleware/auth.js';
import { logRbacAudit } from '../db.js';
import { clearAvatarCache, getAvatarCacheStats } from '../services/avatars.js';
import { cleanupAppIconCache, getAppIconCacheStats } from '../services/appIcons.js';
import { getBrandingSettings, serveBrandingLogo, updateBrandingSettings } from '../services/branding.js';
import { respondWithError } from '../services/errors.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ branding: getBrandingSettings() });
});

router.put('/', authenticate, isOwner, async (req, res) => {
  try {
    const { branding, auditDetails } = await updateBrandingSettings(req.body || {});
    logRbacAudit(req.user.id, 'update', 'branding', 'default', auditDetails);
    res.json({ message: 'Changes saved', branding });
  } catch (error) {
    console.error('Branding update failed:', error.message);
    respondWithError(res, error, { status: 500, message: 'Failed to update branding' });
  }
});

router.post('/avatars/refresh', authenticate, isOwner, async (req, res) => {
  try {
    const result = await clearAvatarCache();
    logRbacAudit(req.user.id, 'refresh', 'branding', 'avatar-cache', {
      removedFiles: result.removed,
      scope: 'avatars',
    });
    res.json({
      message: 'Avatar cache cleared',
      ...result,
    });
  } catch (error) {
    console.error('Avatar cache refresh failed:', error.message);
    res.status(500).json({ error: 'Failed to refresh avatar cache' });
  }
});

router.get('/cache', authenticate, isOwner, async (req, res) => {
  try {
    const [avatarCache, appIconCache] = await Promise.all([
      getAvatarCacheStats(),
      getAppIconCacheStats(),
    ]);
    res.json({ avatarCache, appIconCache });
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
    res.json({
      message: 'App icon cache cleaned',
      ...result,
    });
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
