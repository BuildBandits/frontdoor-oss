import express from 'express';
import { authenticate, isAdminEditor, isAdminViewer } from '../middleware/auth.js';
import { deleteMediaAssetById, getMediaAssetById, listMediaAssets, serveMediaAsset } from '../services/mediaAssets.js';
import { findLargeAppIcons, LARGE_ICON_THRESHOLD_BYTES } from '../services/appIcons.js';
import { respondWithError } from '../services/errors.js';

const router = express.Router();

router.get('/', authenticate, isAdminViewer, (req, res) => {
  const result = listMediaAssets({
    kind: typeof req.query.kind === 'string' ? req.query.kind : null,
    query: typeof req.query.q === 'string' ? req.query.q : null,
    limit: req.query.limit,
    page: req.query.page,
  });

  res.json(result);
});

// App icons in use that are larger than the threshold (also reported at startup);
// the media library offers to shrink them in the browser.
router.get('/large-icons', authenticate, isAdminViewer, async (req, res) => {
  try {
    const icons = await findLargeAppIcons({ thresholdBytes: LARGE_ICON_THRESHOLD_BYTES });
    res.json({ icons, thresholdBytes: LARGE_ICON_THRESHOLD_BYTES });
  } catch (error) {
    console.error('Large icon check failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_check_icons' });
  }
});

router.get('/:id/file', authenticate, isAdminViewer, async (req, res) => {
  const asset = getMediaAssetById(req.params.id);
  if (!asset) {
    return res.status(404).end();
  }

  return serveMediaAsset(asset, res);
});

router.get('/:id', authenticate, isAdminViewer, (req, res) => {
  const asset = getMediaAssetById(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: 'Media asset not found', code: 'media_asset_not_found' });
  }

  return res.json({ asset });
});

router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  try {
    const removed = deleteMediaAssetById(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Media asset not found', code: 'media_asset_not_found' });
    }

    return res.json({ removed: true });
  } catch (error) {
    if (error?.statusCode === 409) {
      return res.status(409).json({
        error: error.message,
        code: 'media_asset_in_use',
        usageCount: error.usageCount || 0,
      });
    }
    throw error;
  }
});

export default router;
