import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import { compactDatabaseStorage, getDatabaseFootprint } from '../server/services/databaseMaintenance.js';

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-db-maintenance-'));
  return path.join(dir, 'frontdoor.db');
}

test('database maintenance reports footprint and compacts freed pages', async () => {
  const databasePath = makeTempDbPath();
  const db = new Database(databasePath);

  try {
    db.exec(`
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL
      );
    `);

    const insert = db.prepare('INSERT INTO docs (body) VALUES (?)');
    const payload = 'x'.repeat(8192);
    for (let index = 0; index < 80; index += 1) {
      insert.run(`${index}-${payload}`);
    }

    db.prepare('DELETE FROM docs WHERE id <= 60').run();

    const before = await getDatabaseFootprint({ dbHandle: db, databasePath });
    assert.ok(before.bytes > 0);
    assert.ok(before.reclaimableBytes > 0);

    const result = await compactDatabaseStorage({ dbHandle: db, databasePath });
    const after = await getDatabaseFootprint({ dbHandle: db, databasePath });

    assert.ok(result.reclaimedBytes > 0);
    assert.ok(result.reclaimedPages > 0);
    assert.ok(after.bytes < before.bytes);
    assert.equal(after.freelistCount, 0);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});
