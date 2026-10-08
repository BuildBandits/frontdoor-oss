import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { default: db } = await import('../server/db.js');
const { createBackupFile } = await import('../server/services/backup.js');

test('a backup export does not block writes and captures a single point in time', async () => {
  db.prepare('DELETE FROM access_logs').run();
  // Enough rows to make the NDJSON stream wait for drain several times.
  const insert = db.prepare('INSERT INTO access_logs (user_id, app_id, ip_address, user_agent) VALUES (NULL, NULL, ?, ?)');
  db.transaction(() => {
    for (let i = 0; i < 20000; i += 1) insert.run('10.0.0.1', `agent-${i}-${'x'.repeat(80)}`);
  })();
  const rowsBefore = db.prepare('SELECT COUNT(*) AS n FROM access_logs').get().n;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-backup-snapshot-'));
  const exporting = createBackupFile({ outputPath: path.join(dir, 'backup.tar.gz') });

  let writes = 0;
  const errors = [];
  let done = false;
  exporting.finally(() => { done = true; }).catch(() => {});
  while (!done) {
    try {
      insert.run('10.0.0.2', 'written during export');
      writes += 1;
    } catch (error) {
      errors.push(error.message);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  const { manifest } = await exporting;
  assert.deepEqual(errors, []);
  assert.ok(writes > 0, 'no write happened while the export was running');
  const exported = manifest.tables.find((table) => table.name === 'access_logs');
  assert.equal(exported.rows, rowsBefore);
});
