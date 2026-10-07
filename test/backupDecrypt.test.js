import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { encryptBackup } from '../server/services/backupCrypto.js';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'backup-decrypt.mjs');

function run(args, passphrase) {
  const env = { ...process.env };
  delete env.FRONTDOOR_BACKUP_PASSPHRASE;
  if (passphrase) env.FRONTDOOR_BACKUP_PASSPHRASE = passphrase;
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
}

test('backup:decrypt restores the original bytes and refuses wrong passphrases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-decrypt-'));
  try {
    const plain = Buffer.from('SQLite format 3 test payload');
    const input = path.join(dir, 'frontdoor-database.db.enc');
    fs.writeFileSync(input, encryptBackup(plain, 'decrypt test passphrase'));

    assert.equal(run([input]).status, 2, 'missing passphrase');
    const wrong = run([input], 'not the right passphrase');
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /Wrong passphrase/);
    assert.equal(fs.existsSync(path.join(dir, 'frontdoor-database.db')), false);

    const ok = run([input], 'decrypt test passphrase');
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'frontdoor-database.db')), plain);

    // Never overwrite an existing file.
    const again = run([input], 'decrypt test passphrase');
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
