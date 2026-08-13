import express from 'express';
import { authenticate, isAdminViewer, isAdminEditor, isOwner } from '../middleware/auth.js';
import { logRbacAudit } from '../db.js';
import { isPluginSystemEnabled } from '../services/branding.js';
import {
  buildRuntimePluginPayload,
  approvePluginRegistry,
  deletePluginRegistry,
  dispatchPluginEvent,
  importPluginBundle,
  getPluginRegistry,
  getPluginRegistryById,
  revokePluginApproval,
} from '../services/plugins.js';

const router = express.Router();

router.get('/runtime', authenticate, (req, res) => {
  if (!isPluginSystemEnabled()) {
    return res.json({ plugins: [] });
  }
  const plugins = buildRuntimePluginPayload(req.user);
  for (const plugin of plugins) {
    logRbacAudit(req.user.id, 'runtime_authorized', 'plugin', plugin.manifest?.id || null, {
      contentDigest: plugin.contentDigest,
    });
  }
  res.json({ plugins });
});

router.get('/', authenticate, isAdminViewer, (_req, res) => {
  res.json({ plugins: getPluginRegistry(true) });
});

router.get('/:id', authenticate, isAdminViewer, (req, res) => {
  const plugin = getPluginRegistryById(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }
  return res.json({ plugin });
});

router.post('/', authenticate, isAdminEditor, async (req, res) => {
  try {
    const plugin = await importPluginBundle({ ...(req.body || {}), actorId: req.user.id });
    return res.status(201).json({ plugin });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create plugin' });
  }
});

router.post('/import', authenticate, isAdminEditor, async (req, res) => {
  try {
    const plugin = await importPluginBundle({ ...(req.body || {}), actorId: req.user.id });
    return res.status(201).json({ plugin });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to import plugin' });
  }
});

router.put('/:id', authenticate, isAdminEditor, async (req, res) => {
  try {
    const plugin = await importPluginBundle({
      ...req.body,
      id: req.params.id,
      actorId: req.user.id,
    });
    return res.json({ plugin });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update plugin' });
  }
});

router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  const removed = deletePluginRegistry(req.params.id, req.user.id);
  if (!removed) {
    return res.status(404).json({ error: 'Plugin not found' });
  }
  return res.json({ deleted: true });
});

router.post('/:id/test-event/:eventName', authenticate, isAdminEditor, async (req, res) => {
  const plugin = getPluginRegistryById(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  try {
    const summary = await dispatchPluginEvent(req.params.eventName, req.body?.payload || {}, {
      actorId: req.user.id,
      targetPluginId: plugin.id,
      testMode: true,
    });
    return res.json({ pluginId: plugin.id, summary });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to dispatch plugin event',
    });
  }
});

router.post('/:id/approve', authenticate, isOwner, (req, res) => {
  try {
    const plugin = approvePluginRegistry(req.params.id, req.user.id);
    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    return res.json({ plugin });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to approve plugin' });
  }
});

router.post('/:id/revoke', authenticate, isOwner, (req, res) => {
  const plugin = revokePluginApproval(req.params.id, req.user.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }
  return res.json({ plugin });
});

export default router;
