function runInTransaction(dbHandle, callback) {
  if (typeof dbHandle.transaction === 'function') {
    return dbHandle.transaction(callback)();
  }

  if (typeof dbHandle.exec !== 'function') {
    return callback();
  }

  dbHandle.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    dbHandle.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      dbHandle.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures so the original error is preserved.
    }
    throw error;
  }
}

export function transferGroupApps({ dbHandle, sourceGroupId, targetGroupId, mode }) {
  if (!dbHandle) {
    throw new Error('dbHandle is required');
  }
  if (!sourceGroupId || !targetGroupId) {
    throw new Error('sourceGroupId and targetGroupId are required');
  }

  const normalizedMode = mode === 'move' ? 'move' : 'copy';
  const sourceApps = dbHandle.prepare(`
    SELECT app_id
    FROM app_permissions
    WHERE group_id = ?
    ORDER BY app_id
  `).all(sourceGroupId).map((row) => row.app_id);

  const insert = dbHandle.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)');
  const remove = dbHandle.prepare('DELETE FROM app_permissions WHERE app_id = ? AND group_id = ?');

  const runTransfer = () => runInTransaction(dbHandle, () => {
    let added = 0;
    let removed = 0;

    for (const appId of sourceApps) {
      const insertResult = insert.run(appId, targetGroupId);
      if (insertResult.changes > 0) added += insertResult.changes;

      if (normalizedMode === 'move') {
        const removeResult = remove.run(appId, sourceGroupId);
        if (removeResult.changes > 0) removed += removeResult.changes;
      }
    }

    return { added, removed };
  });

  const { added, removed } = runTransfer();

  return {
    mode: normalizedMode,
    sourceGroupId,
    targetGroupId,
    appIds: sourceApps,
    sourceCount: sourceApps.length,
    addedCount: added,
    removedCount: removed,
  };
}
