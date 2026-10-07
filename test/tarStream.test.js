import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

import { END_OF_ARCHIVE, entryHeader, entryPadding, readTar } from '../server/services/tarStream.js';

function buildTar(entries) {
  const parts = [];
  for (const { name, data } of entries) {
    parts.push(entryHeader(name, data.length, 0), data, entryPadding(data.length));
  }
  parts.push(END_OF_ARCHIVE);
  return Buffer.concat(parts);
}

async function readAll(buffer, chunkSize = 300) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) chunks.push(buffer.subarray(offset, offset + chunkSize));
  const entries = [];
  await readTar(Readable.from(chunks), async (header, content) => {
    const parts = [];
    for await (const part of content) parts.push(part);
    entries.push({ name: header.name, size: header.size, data: Buffer.concat(parts) });
  });
  return entries;
}

test('round-trips entries, including empty files, binary data and long paths', async () => {
  const longName = `files/plugins/${'nested-folder/'.repeat(10)}plugin.mjs`;
  assert.ok(Buffer.byteLength(longName) > 100);
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"format":2}') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'files/avatars/a.png', data: Buffer.from(Array.from({ length: 1500 }, (_, i) => i % 256)) },
    { name: longName, data: Buffer.from('export default {};') },
  ];

  const read = await readAll(buildTar(entries));
  assert.deepEqual(read.map((entry) => entry.name), entries.map((entry) => entry.name));
  for (let i = 0; i < entries.length; i += 1) assert.deepEqual(read[i].data, entries[i].data);
});

test('handlers may skip an entry without reading it', async () => {
  const tar = buildTar([{ name: 'skip.bin', data: Buffer.alloc(2000, 7) }, { name: 'next.txt', data: Buffer.from('ok') }]);
  const names = [];
  await readTar(Readable.from([tar]), async (header, content) => {
    names.push(header.name);
    if (header.name === 'next.txt') {
      const parts = [];
      for await (const part of content) parts.push(part);
      assert.equal(Buffer.concat(parts).toString(), 'ok');
    }
  });
  assert.deepEqual(names, ['skip.bin', 'next.txt']);
});

test('rejects truncated archives', async () => {
  const tar = buildTar([{ name: 'a.txt', data: Buffer.alloc(1000, 1) }]);
  await assert.rejects(readAll(tar.subarray(0, 700)), /Unexpected end/);
});

test('produces archives that the system tar can list', (t) => {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('tar not available');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-tar-'));
  try {
    const file = path.join(dir, 'test.tar');
    fs.writeFileSync(file, buildTar([{ name: 'manifest.json', data: Buffer.from('{}') }, { name: 'files/branding/logo.svg', data: Buffer.from('<svg/>') }]));
    // Relative path: GNU tar on Windows reads "C:" as a remote host.
    const listed = spawnSync('tar', ['-tf', path.basename(file)], { cwd: dir, encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split(/\r?\n/), ['manifest.json', 'files/branding/logo.svg']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
