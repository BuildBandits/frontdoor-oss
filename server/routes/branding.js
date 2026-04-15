import express from 'express';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { getBrandingSettings, serveBrandingLogo, updateBrandingSettings } from '../services/branding.js';

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  res.json({ branding: getBrandingSettings() });
});

router.put('/', authenticate, isAdmin, async (req, res) => {
  try {
    const branding = await updateBrandingSettings(req.body || {});
    res.json({ message: 'Modifiche salvate', branding });
  } catch (error) {
    console.error('Branding update failed:', error.message);
    res.status(400).json({ error: error.message || 'Failed to update branding' });
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
