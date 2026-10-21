import jwt from 'jsonwebtoken';
import db from '../db.js';
import { logRbacAudit } from '../db.js';
import {
  IMPERSONATION_COOKIE, canImpersonate, clearImpersonationCookie, endIfExpired, endSession,
  loadSession, parseSqliteDateTime, readSessionCookie,
} from '../services/impersonation.js';
import { getAppTimeZone } from '../config.js';

const loadActiveUser = (userId) => db
  .prepare(`
    SELECT id, email, display_name, role, avatar_color, home_desktop_view, preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, last_activity_at
    FROM users
    WHERE id = ? AND is_active = 1
  `)
  .get(userId);

// The impersonation session behind the cookie, when it is still valid for this admin.
// Sessions that can no longer be used are ended (and audited) here.
// The host-only cookie is still sent by sibling origins (same-site), so only requests
// from Frontdoor itself may use it; CORS session-check pages keep seeing the admin.
function isFrontdoorRequest(req) {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return origin === new URL(process.env.FRONTEND_URL).origin;
  } catch {
    return false;
  }
}

function resolveImpersonation(req, res, admin) {
  const token = req.cookies?.[IMPERSONATION_COOKIE];
  if (!token || !isFrontdoorRequest(req)) return null;

  const sessionId = readSessionCookie(token);
  const session = sessionId ? loadSession(sessionId) : null;
  if (!session || session.ended_at || session.admin_id !== admin.id || endIfExpired(session)) {
    clearImpersonationCookie(res);
    return null;
  }
  if (!canImpersonate(admin.role)) {
    endSession(session.id, 'admin_ineligible');
    clearImpersonationCookie(res);
    return null;
  }
  const target = loadActiveUser(session.target_user_id);
  if (!target || target.role !== 'user') {
    endSession(session.id, 'target_ineligible');
    clearImpersonationCookie(res);
    return null;
  }
  return { session, target };
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Impersonation is read-only: nothing is ever written as the impersonated user.
function guardImpersonationWrite(req, res, next) {
  // Router-relative paths end in '/' for root routes (POST /api/impersonation).
  const path = `${req.baseUrl}${req.path}`.replace(/\/+$/, '');
  if (READ_METHODS.has(req.method) || path === '/api/impersonation/stop') return next();
  // Home visits are telemetry, not something the user did.
  if (path === '/api/auth/home-activity') return res.status(204).end();
  logRbacAudit(req.actor.id, 'write_blocked', 'impersonation', req.user.id, { method: req.method, path }, req.impersonation.sessionId);
  if (path === '/api/impersonation') {
    return res.status(409).json({ error: 'Already acting as a user', code: 'impersonation_already_active' });
  }
  return res.status(403).json({ error: 'Read-only while acting as a user', code: 'impersonation_read_only' });
}

// JWT verification for API routes. Checks Bearer token first, then httpOnly cookie.
export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies?.frontdoor_token) {
      token = req.cookies.frontdoor_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided', code: 'not_authenticated' });
    }

    // Session tokens only: HS256, Frontdoor issuer, and no audience (tokens with an
    // audience are short-lived SSO tokens meant for a single app).
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'frontdoor',
    });
    if (decoded.aud !== undefined || !decoded.userId) {
      return res.status(401).json({ error: 'Invalid token', code: 'invalid_token' });
    }

    const user = loadActiveUser(decoded.userId);

    if (!user) {
      // The admin behind an open impersonation session can no longer be used.
      const cookie = req.cookies?.[IMPERSONATION_COOKIE];
      const sessionId = cookie && readSessionCookie(cookie);
      const session = sessionId ? loadSession(sessionId) : null;
      if (session && !session.ended_at && session.admin_id === decoded.userId) {
        endSession(session.id, 'admin_ineligible');
        clearImpersonationCookie(res);
      }
      return res.status(401).json({ error: 'User not found or inactive', code: 'user_not_found_or_inactive' });
    }

    const timeZone = getAppTimeZone();
    req.authTokenExpMs = decoded.exp ? decoded.exp * 1000 : null;
    req.actor = { ...user, timeZone };
    req.user = req.actor;
    req.impersonation = null;

    const impersonation = resolveImpersonation(req, res, user);
    if (!impersonation) return next();

    const { session, target } = impersonation;
    req.user = { ...target, timeZone };
    req.impersonation = {
      sessionId: session.id,
      actor: { id: user.id, displayName: user.display_name },
      expiresAt: new Date(parseSqliteDateTime(session.expires_at)).toISOString(),
      reason: session.reason,
    };
    return guardImpersonationWrite(req, res, next);
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'invalid_token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
    }
    return res.status(500).json({ error: 'Authentication error', code: 'authentication_error' });
  }
};

// Role-based authorization
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated', code: 'not_authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'insufficient_permissions' });
    }
    next();
  };
};

export const ROLE_OWNER = 'owner';
export const ROLE_ADMIN = 'admin';
export const ROLE_ADMIN_READONLY = 'admin_readonly';
export const ROLE_USER = 'user';

export const ADMIN_VIEWER_ROLES = [ROLE_OWNER, ROLE_ADMIN, ROLE_ADMIN_READONLY];
export const ADMIN_EDITOR_ROLES = [ROLE_OWNER, ROLE_ADMIN];

export const isOwner = authorize(ROLE_OWNER);
export const isAdminViewer = authorize(...ADMIN_VIEWER_ROLES);
export const isAdminEditor = authorize(...ADMIN_EDITOR_ROLES);
export const isAdmin = isAdminEditor;
