import express from 'express';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import {
  canImpersonate, clearImpersonationCookie, endSession, normalizeReason, setImpersonationCookie, startSession,
} from '../services/impersonation.js';

const router = express.Router();
const MAX_USER_AGENT_LENGTH = 300;

// Start acting as a regular user (read-only). Nested starts are refused by the
// read-only guard in authenticate before this handler runs.
router.post('/', authenticate, (req, res) => {
  if (!canImpersonate(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions', code: 'insufficient_permissions' });
  }

  const reason = normalizeReason(req.body.reason);
  if (!reason) {
    return res.status(400).json({ error: 'A reason of 1 to 500 characters is required', code: 'impersonation_reason_required' });
  }

  const userId = typeof req.body.userId === 'string' ? req.body.userId : null;
  const target = userId ? db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(userId) : null;
  if (!target) {
    return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
  }
  if (target.id === req.user.id || target.role !== 'user' || target.is_active !== 1) {
    return res.status(403).json({ error: 'This user cannot be impersonated', code: 'impersonation_target_not_allowed' });
  }

  const { id, expiresAtMs } = startSession({
    adminId: req.user.id,
    targetUserId: target.id,
    reason,
    ipAddress: req.ip || null,
    userAgent: (req.get('user-agent') || '').slice(0, MAX_USER_AGENT_LENGTH) || null,
    adminTokenExpMs: req.authTokenExpMs,
  });
  setImpersonationCookie(res, id, expiresAtMs);
  res.status(201).json({ sessionId: id, expiresAt: new Date(expiresAtMs).toISOString() });
});

router.post('/stop', authenticate, (req, res) => {
  if (req.impersonation) endSession(req.impersonation.sessionId, 'manual');
  clearImpersonationCookie(res);
  res.json({ ok: true });
});

export default router;
