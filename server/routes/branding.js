import express from 'express';
import { authenticate, isSuperAdmin } from '../middleware/auth.js';
import { logRbacAudit } from '../db.js';
import { clearAvatarCache } from '../services/avatars.js';
import { getBrandingSettings, serveBrandingLogo, updateBrandingSettings } from '../services/branding.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ branding: getBrandingSettings() });
});

router.put('/', authenticate, isSuperAdmin, async (req, res) => {
  try {
    const branding = await updateBrandingSettings(req.body || {});
    logRbacAudit(req.user.id, 'update', 'branding', 'default', {
      heroTitleLine1: branding.heroTitleLine1,
      heroTitleLine2: branding.heroTitleLine2,
      showHomeHero: branding.showHomeHero,
      logRetentionDays: branding.logRetentionDays,
      hideLoginPage: branding.hideLoginPage,
      showAppModeBadges: branding.showAppModeBadges,
      showSharedCookieMode: branding.showSharedCookieMode,
      showRedirectSsoMode: branding.showRedirectSsoMode,
      showEntraAppMode: branding.showEntraAppMode,
    });
    res.json({ message: 'Modifiche salvate', branding });
  } catch (error) {
    console.error('Branding update failed:', error.message);
    res.status(400).json({ error: error.message || 'Failed to update branding' });
  }
});

router.post('/avatars/refresh', authenticate, isSuperAdmin, async (req, res) => {
  try {
    const result = await clearAvatarCache();
    logRbacAudit(req.user.id, 'refresh', 'branding', 'avatar-cache', {
      removedFiles: result.removed,
      scope: 'avatars',
    });
    res.json({
      message: 'Cache avatar svuotata',
      ...result,
    });
  } catch (error) {
    console.error('Avatar cache refresh failed:', error.message);
    res.status(500).json({ error: 'Failed to refresh avatar cache' });
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
