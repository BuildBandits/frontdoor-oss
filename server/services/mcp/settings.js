import { randomToken } from './crypto.js';

export function getMcpSettings(db) {
  const row = db.prepare("SELECT enabled, pseudonym_key, updated_by, updated_at FROM mcp_settings WHERE id = 'default'").get();
  return {
    enabled: row?.enabled === 1,
    hasPseudonymKey: Boolean(row?.pseudonym_key),
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || null,
  };
}

export function isMcpEnabled(db) {
  return db.prepare("SELECT enabled FROM mcp_settings WHERE id = 'default'").get()?.enabled === 1;
}

// The key is created on first enable and only ever read server side.
export function getPseudonymKey(db) {
  return db.prepare("SELECT pseudonym_key FROM mcp_settings WHERE id = 'default'").get()?.pseudonym_key || null;
}

export function setMcpEnabled(db, { enabled, actorId }) {
  db.prepare(`
    UPDATE mcp_settings
    SET enabled = ?, pseudonym_key = COALESCE(pseudonym_key, ?), updated_by = ?, updated_at = datetime('now')
    WHERE id = 'default'
  `).run(enabled ? 1 : 0, randomToken(), actorId);
  return getMcpSettings(db);
}

export function revokeGrants(db, { where, params = [], reason }) {
  return db.transaction(() => {
    const grantIds = db.prepare(`SELECT id FROM mcp_grants WHERE revoked_at IS NULL AND ${where}`).all(...params).map((row) => row.id);
    for (const grantId of grantIds) {
      db.prepare("UPDATE mcp_grants SET revoked_at = datetime('now'), revoke_reason = ? WHERE id = ?").run(reason, grantId);
      db.prepare('DELETE FROM mcp_tokens WHERE grant_id = ?').run(grantId);
      db.prepare('DELETE FROM mcp_auth_codes WHERE grant_id = ?').run(grantId);
    }
    return grantIds.length;
  })();
}

// Every connection is cut at once and pseudonyms already handed out stop
// matching anything: the key rotates.
export function killSwitch(db, { actorId }) {
  return db.transaction(() => {
    const grantsRevoked = revokeGrants(db, { where: '1 = 1', reason: 'kill_switch' });
    db.prepare('DELETE FROM mcp_tokens').run();
    db.prepare('DELETE FROM mcp_auth_codes').run();
    db.prepare('DELETE FROM mcp_authorization_requests').run();
    db.prepare("UPDATE mcp_settings SET pseudonym_key = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 'default'").run(randomToken(), actorId);
    return { grantsRevoked };
  })();
}
