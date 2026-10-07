import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createDecryptStream, createEncryptStream, encryptionFormat } from '../server/services/backupCrypto.js';

async function encryptToFile(file, data, passphrase) {
  const chunks = [];
  for (let offset = 0; offset < data.length; offset += 4096) chunks.push(data.subarray(offset, offset + 4096));
  await pipeline(Readable.from(chunks), createEncryptStream(passphrase), fs.createWriteStream(file));
}

async function readStream(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

test('streamed encryption round-trips and detects wrong passphrases and tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-stream-crypto-'));
  try {
    const data = Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 7) % 256));
    const file = path.join(dir, 'archive.enc');
    await encryptToFile(file, data, 'stream passphrase 123');

    const head = fs.readFileSync(file).subarray(0, 8);
    assert.equal(encryptionFormat(head), 2);

    assert.deepEqual(await readStream(await createDecryptStream(file, 'stream passphrase 123')), data);

    await assert.rejects(readStream(await createDecryptStream(file, 'another passphrase!!')), (error) => error.code === 'backup_passphrase_invalid');
    await assert.rejects(createDecryptStream(file, null), (error) => error.code === 'backup_passphrase_required');

    const tampered = fs.readFileSync(file);
    tampered[100] ^= 0xff;
    fs.writeFileSync(file, tampered);
    await assert.rejects(readStream(await createDecryptStream(file, 'stream passphrase 123')), (error) => error.code === 'backup_passphrase_invalid');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty input still produces a valid encrypted file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-stream-crypto-empty-'));
  try {
    const file = path.join(dir, 'empty.enc');
    await encryptToFile(file, Buffer.alloc(0), 'stream passphrase 123');
    assert.equal((await readStream(await createDecryptStream(file, 'stream passphrase 123'))).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
