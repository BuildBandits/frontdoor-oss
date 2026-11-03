export function getMcpSettings(db) {
  const row = db.prepare("SELECT enabled, updated_by, updated_at FROM mcp_settings WHERE id = 'default'").get();
  return {
    enabled: row?.enabled === 1,
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || null,
  };
}

export function isMcpEnabled(db) {
  return db.prepare("SELECT enabled FROM mcp_settings WHERE id = 'default'").get()?.enabled === 1;
}

export function setMcpEnabled(db, { enabled, actorId }) {
  db.prepare(`
    UPDATE mcp_settings
    SET enabled = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = 'default'
  `).run(enabled ? 1 : 0, actorId);
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

// Every connection is cut at once: grants revoked, all credentials and
// pending requests dropped.
export function killSwitch(db, { actorId }) {
  return db.transaction(() => {
    const grantsRevoked = revokeGrants(db, { where: '1 = 1', reason: 'kill_switch' });
    db.prepare('DELETE FROM mcp_tokens').run();
    db.prepare('DELETE FROM mcp_auth_codes').run();
    db.prepare('DELETE FROM mcp_authorization_requests').run();
    db.prepare("UPDATE mcp_settings SET updated_by = ?, updated_at = datetime('now') WHERE id = 'default'").run(actorId);
    return { grantsRevoked };
  })();
}
