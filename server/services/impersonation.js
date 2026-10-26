// Admin impersonation sessions: an admin sees Frontdoor as a regular user, read-only.
// The session lives in the database (so its end is always audited) and the browser
// only holds a signed, host-only cookie with its id. The shared frontdoor_token cookie
// is never touched, so satellite apps keep seeing the admin's real identity.
import jwt from 'jsonwebtoken';
import db, { logRbacAudit } from '../db.js';
import { getImpersonationTimeoutMinutes } from '../config.js';

export const IMPERSONATION_COOKIE = 'frontdoor_impersonation';
const COOKIE_AUDIENCE = 'frontdoor-impersonation';
const REASON_MAX_LENGTH = 500;
const IMPERSONATOR_ROLES = new Set(['owner', 'admin', 'admin_readonly']);

// SQLite datetime('now') format, always UTC.
function toSqliteDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseSqliteDateTime(value) {
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

export function canImpersonate(role) {
  return IMPERSONATOR_ROLES.has(role);
}

export function normalizeReason(value) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= REASON_MAX_LENGTH ? reason : null;
}

export function startSession({ adminId, targetUserId, reason, ipAddress = null, userAgent = null, adminTokenExpMs = null, now = Date.now() }) {
  const timeoutAt = now + getImpersonationTimeoutMinutes() * 60 * 1000;
  const cappedByToken = Number.isFinite(adminTokenExpMs) && adminTokenExpMs < timeoutAt;
  const expiresAtMs = cappedByToken ? adminTokenExpMs : timeoutAt;
  const expiresAt = toSqliteDateTime(expiresAtMs);

  const { id } = db.prepare(`
    INSERT INTO impersonation_sessions (admin_id, target_user_id, reason, ip_address, user_agent, started_at, expires_at, expiry_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(adminId, targetUserId, reason, ipAddress, userAgent, toSqliteDateTime(now), expiresAt, cappedByToken ? 'session_expired' : 'timeout');

  logRbacAudit(adminId, 'start', 'impersonation', targetUserId, { reason, ipAddress, userAgent, expiresAt }, id);
  return { id, expiresAtMs };
}

export function loadSession(sessionId) {
  return db.prepare('SELECT * FROM impersonation_sessions WHERE id = ?').get(sessionId) || null;
}

/** Ends an open session and audits it; returns false when it had already ended. */
export function endSession(sessionId, endReason, endedAtMs = Date.now()) {
  const session = db.prepare(`
    UPDATE impersonation_sessions SET ended_at = ?, end_reason = ?
    WHERE id = ? AND ended_at IS NULL
    RETURNING *
  `).get(toSqliteDateTime(endedAtMs), endReason, sessionId);
  if (!session) return false;

  const durationSeconds = Math.max(0, Math.round((endedAtMs - parseSqliteDateTime(session.started_at)) / 1000));
  logRbacAudit(session.admin_id, 'end', 'impersonation', session.target_user_id, { endReason, durationSeconds }, session.id);
  return true;
}

/** Ends the session at its expiry time when that has passed. */
export function endIfExpired(session, now = Date.now()) {
  const expiresAtMs = parseSqliteDateTime(session.expires_at);
  if (expiresAtMs > now) return false;
  endSession(session.id, session.expiry_reason, expiresAtMs);
  return true;
}

export function sweepExpiredSessions(now = Date.now()) {
  const expired = db.prepare('SELECT * FROM impersonation_sessions WHERE ended_at IS NULL AND expires_at <= ?').all(toSqliteDateTime(now));
  for (const session of expired) endIfExpired(session, now);
  return expired.length;
}

const jwtIssuer = () => process.env.JWT_ISSUER || 'frontdoor';

export function signSessionCookie(sessionId, expiresAtMs) {
  return jwt.sign({ sid: sessionId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: jwtIssuer(),
    audience: COOKIE_AUDIENCE,
    expiresIn: Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000)),
  });
}

export function readSessionCookie(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: jwtIssuer(), audience: COOKIE_AUDIENCE });
    return Number.isInteger(decoded.sid) ? decoded.sid : null;
  } catch {
    return null;
  }
}

// Host-only on purpose (no `domain`): subdomain satellites must never receive it.
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
});

export function setImpersonationCookie(res, sessionId, expiresAtMs) {
  res.cookie(IMPERSONATION_COOKIE, signSessionCookie(sessionId, expiresAtMs), {
    ...cookieOptions(),
    maxAge: Math.max(0, expiresAtMs - Date.now()),
  });
}

export function clearImpersonationCookie(res) {
  res.clearCookie(IMPERSONATION_COOKIE, cookieOptions());
}
