import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { createBackupArchive } = await import('../server/services/backup.js');

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'backup-rehearse.mjs');

function parseReport(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function rehearse(file, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, file, '--json'], {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  return { ...result, report: parseReport(result.stdout) };
}

test('backup:rehearse runs the current migrations against an archive and reports no changes for a current backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-rehearse-'));
  try {
    const { archive } = await createBackupArchive({ passphrase: 'rehearsal passphrase' });
    const file = path.join(dir, 'current.json.gz.enc');
    fs.writeFileSync(file, archive);

    assert.equal(rehearse(file).status, 2, 'encrypted archive without passphrase');

    const { status, stderr, report } = rehearse(file, { FRONTDOOR_BACKUP_PASSPHRASE: 'rehearsal passphrase' });
    assert.equal(status, 0, stderr);
    assert.equal(report.mode, 'archive-schema');
    assert.deepEqual(report.schema, { added: [], removed: [], changed: [] });
    assert.deepEqual(report.rowCountChanges, []);
    assert.equal(report.after.integrity, 'ok');
    assert.equal(report.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backup:rehearse shows the table rebuild a legacy schema would trigger, without losing rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-rehearse-legacy-'));
  try {
    const { snapshot } = await createBackupArchive();
    // Pretend the source installation still had the old apps.mode CHECK constraint.
    const appsSchema = snapshot.database.schema.find((entry) => entry.type === 'table' && entry.name === 'apps');
    appsSchema.sql = appsSchema.sql.replace(/'internal-link',\s*/, '');
    assert.doesNotMatch(appsSchema.sql, /internal-link/);
    const file = path.join(dir, 'legacy.json.gz');
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(snapshot))));

    const { status, stderr, report } = rehearse(file);
    assert.equal(status, 0, stderr);
    assert.ok(report.schema.changed.includes('table:apps'), JSON.stringify(report.schema));
    assert.deepEqual(report.rowCountChanges, []);
    assert.equal(report.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backup:rehearse accepts a raw database file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-rehearse-db-'));
  try {
    const { exportDatabaseFile } = await import('../server/services/backup.js');
    const { buffer } = await exportDatabaseFile();
    const file = path.join(dir, 'frontdoor.db');
    fs.writeFileSync(file, buffer);

    const { status, stderr, report } = rehearse(file);
    assert.equal(status, 0, stderr);
    assert.equal(report.mode, 'database-file');
    assert.equal(report.ok, true);
    assert.deepEqual(fs.readdirSync(dir), ['frontdoor.db']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
