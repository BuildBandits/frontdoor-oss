import express from 'express';
import { authenticate, isAdminEditor, isAdminViewer } from '../middleware/auth.js';
import { deleteMediaAssetById, getMediaAssetById, listMediaAssets, serveMediaAsset } from '../services/mediaAssets.js';

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
    return res.status(404).json({ error: 'Media asset not found' });
  }

  return res.json({ asset });
});

router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  try {
    const removed = deleteMediaAssetById(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Media asset not found' });
    }

    return res.json({ message: 'Media asset removed from index' });
  } catch (error) {
    if (error?.statusCode === 409) {
      return res.status(409).json({
        error: error.message,
        usageCount: error.usageCount || 0,
      });
    }
    throw error;
  }
});

export default router;
