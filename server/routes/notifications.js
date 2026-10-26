import express from 'express';
import { authenticate, isAdminViewer, isAdminEditor } from '../middleware/auth.js';
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
  resolveNotificationById,
} from '../services/notifications.js';

const router = express.Router();

// Open notifications (and, on request, recently resolved ones) for admin roles
router.get('/', authenticate, isAdminViewer, (req, res) => {
  res.json({
    notifications: listNotifications(req.user.id, { includeResolved: req.query.include_resolved === '1' }),
    unreadCount: countUnreadNotifications(req.user.id),
  });
});

// Mark some or all open notifications as read for the current admin
router.post('/read', authenticate, isAdminViewer, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const marked = markNotificationsRead(req.user.id, ids);
  res.json({ marked, unreadCount: countUnreadNotifications(req.user.id) });
});

// Resolve one notification (editor roles only)
router.post('/:id/resolve', authenticate, isAdminEditor, (req, res) => {
  if (resolveNotificationById(req.params.id, req.user.id) === 0) {
    return res.status(404).json({ error: 'Notification not found or already resolved', code: 'notification_not_found' });
  }
  res.json({ resolved: true, unreadCount: countUnreadNotifications(req.user.id) });
});

export default router;
