// Housekeeping for MCP credentials. Timestamps are stored in SQLite's
// datetime('now') format (UTC), so comparisons stay inside SQL.

// Expired codes and tokens are useless and only kept until the next sweep.
// Revoked grants are kept for the log retention period (they explain audit
// rows and the user's "connected assistants" history), then removed with
// everything that hangs off them.
export function purgeExpiredMcpCredentials(db, { retentionDays = 90 } = {}) {
  const days = Number.isFinite(retentionDays) ? Math.min(90, Math.max(0, Math.floor(retentionDays))) : 90;
  return db.transaction(() => ({
    codesRemoved: db.prepare("DELETE FROM mcp_auth_codes WHERE expires_at < datetime('now')").run().changes,
    tokensRemoved: db.prepare("DELETE FROM mcp_tokens WHERE expires_at < datetime('now') OR (absolute_expires_at IS NOT NULL AND absolute_expires_at < datetime('now'))").run().changes,
    grantsRemoved: db.prepare("DELETE FROM mcp_grants WHERE revoked_at IS NOT NULL AND revoked_at < datetime('now', ?)").run(`-${days} days`).changes,
  }))();
}
