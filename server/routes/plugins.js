import express from 'express';
import { authenticate, isAdminViewer, isAdminEditor, isOwner } from '../middleware/auth.js';
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
  upsertPluginRegistry,
} from '../services/plugins.js';

const router = express.Router();

router.get('/runtime', (_req, res) => {
  if (!isPluginSystemEnabled()) {
    return res.json({ plugins: [] });
  }
  res.json({ plugins: buildRuntimePluginPayload() });
});

router.use((req, res, next) => {
  if (isPluginSystemEnabled()) {
    return next();
  }

  return res.status(404).json({ error: 'Plugin system is disabled', code: 'plugin_system_disabled' });
});

router.get('/', authenticate, isAdminViewer, (_req, res) => {
  res.json({ plugins: getPluginRegistry(true) });
});

router.get('/:id', authenticate, isAdminViewer, (req, res) => {
  const plugin = getPluginRegistryById(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found', code: 'plugin_not_found' });
  }
  return res.json({ plugin });
});

router.post('/', authenticate, isAdminEditor, (req, res) => {
  try {
    const plugin = upsertPluginRegistry(req.body || {});
    return res.status(201).json({ plugin });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create plugin',
      code: error?.code || 'failed_to_create_plugin',
    });
  }
});

router.post('/import', authenticate, isAdminEditor, async (req, res) => {
  try {
    const plugin = await importPluginBundle(req.body || {});
    return res.status(201).json({ plugin });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to import plugin',
      code: error?.code || 'failed_to_import_plugin',
    });
  }
});

router.put('/:id', authenticate, isAdminEditor, async (req, res) => {
  try {
    const plugin = await importPluginBundle({
      ...req.body,
      id: req.params.id,
    });
    return res.json({ plugin });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update plugin',
      code: error?.code || 'failed_to_update_plugin',
    });
  }
});

router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  const removed = deletePluginRegistry(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Plugin not found', code: 'plugin_not_found' });
  }
  return res.json({ deleted: true });
});

router.post('/:id/test-event/:eventName', authenticate, isAdminEditor, async (req, res) => {
  const plugin = getPluginRegistryById(req.params.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found', code: 'plugin_not_found' });
  }

  const summary = await dispatchPluginEvent(req.params.eventName, req.body?.payload || {}, {
    actorId: req.user.id,
    targetPluginId: plugin.id,
    testMode: true,
  });

  return res.json({ pluginId: plugin.id, summary });
});

router.post('/:id/approve', authenticate, isOwner, (req, res) => {
  const plugin = approvePluginRegistry(req.params.id, req.user.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found', code: 'plugin_not_found' });
  }
  return res.json({ plugin });
});

router.post('/:id/revoke', authenticate, isOwner, (req, res) => {
  const plugin = revokePluginApproval(req.params.id, req.user.id);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found', code: 'plugin_not_found' });
  }
  return res.json({ plugin });
});

export default router;
