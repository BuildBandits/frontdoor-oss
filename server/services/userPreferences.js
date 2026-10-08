// Collects user preference changes and writes only the columns whose value
// actually differs from the stored row, so saving unchanged preferences does not
// move updated_at or the list timestamps used to reconcile client caches.

export function createPreferenceUpdate() {
  const columns = new Map();

  return {
    /**
     * Queue a column value. `touch` names a timestamp column that follows it:
     * set to now when the value changes to non-null, cleared when it becomes null.
     */
    set(column, value, { touch = null } = {}) {
      columns.set(column, { value: value ?? null, touch });
    },

    get size() {
      return columns.size;
    },

    /** Write the changed columns; returns how many preference columns changed. */
    apply(dbHandle, userId) {
      const current = dbHandle.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!current) return 0;

      const assignments = [];
      const values = [];
      for (const [column, { value, touch }] of columns) {
        if ((current[column] ?? null) === value) continue;
        assignments.push(`${column} = ?`);
        values.push(value);
        if (touch) assignments.push(value === null ? `${touch} = NULL` : `${touch} = datetime('now')`);
      }
      if (values.length === 0) return 0;

      dbHandle.prepare(`UPDATE users SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, userId);
      return values.length;
    },
  };
}
