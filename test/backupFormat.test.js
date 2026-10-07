import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

import { detectBackupFile, readBackupV2, writeBackupV2 } from '../server/services/backupFormat.js';
import { END_OF_ARCHIVE, entryHeader, entryPadding } from '../server/services/tarStream.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-format-'));
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, note TEXT);
    CREATE TABLE empty_table (id TEXT);
  `);
  const insert = db.prepare('INSERT INTO users (id, email, note) VALUES (?, ?, ?)');
  for (let i = 0; i < 2500; i += 1) insert.run(`u-${i}`, `user${i}@example.com`, i % 3 === 0 ? null : `line one\nline "two" ${i}`);
  const iconsDir = path.join(dir, 'icons');
  const pluginsDir = path.join(dir, 'plugins');
  const longPath = `${'deep/'.repeat(25)}plugin.mjs`;
  fs.mkdirSync(path.join(iconsDir), { recursive: true });
  fs.writeFileSync(path.join(iconsDir, 'a.svg'), '<svg/>');
  fs.mkdirSync(path.dirname(path.join(pluginsDir, longPath)), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir, longPath), Buffer.alloc(70000, 3));
  const buckets = [
    { key: 'app-icons', dir: iconsDir },
    { key: 'avatars', dir: path.join(dir, 'missing-avatars') },
    { key: 'plugins', dir: pluginsDir },
  ];
  return { dir, db, buckets, longPath };
}

async function readEverything(file, passphrase) {
  const result = { manifest: null, schema: null, tables: {}, files: {} };
  await readBackupV2(file, {
    passphrase,
    onManifest: (manifest) => { result.manifest = manifest; },
    onSchema: (schema) => { result.schema = schema; },
    onTable: async (name, rows) => {
      result.tables[name] = [];
      for await (const row of rows) result.tables[name].push(row);
    },
    onFile: async (bucket, relativePath, size, content) => {
      const parts = [];
      for await (const part of content) parts.push(part);
      result.files[`${bucket}/${relativePath}`] = Buffer.concat(parts);
    },
  });
  return result;
}

for (const passphrase of [null, 'format test passphrase']) {
  test(`v2 backups round-trip rows, files, manifest and schema (${passphrase ? 'encrypted' : 'plain'})`, async () => {
    const { dir, db, buckets, longPath } = setup();
    try {
      const file = path.join(dir, 'backup.tar.gz');
      const stages = [];
      await writeBackupV2({
        dbHandle: db,
        tables: ['users', 'empty_table'],
        schema: [{ type: 'table', name: 'users', tableName: 'users', sql: 'CREATE TABLE users (...)' }],
        buckets,
        app: { version: '1.3.1' },
        options: { excludedTables: [] },
        outputPath: file,
        passphrase,
        onProgress: (stage) => stages.push(stage),
      });

      assert.deepEqual(await detectBackupFile(file), { format: 2, encrypted: Boolean(passphrase) });
      assert.deepEqual(stages, ['database', 'app-icons', 'plugins', 'avatars']);

      const read = await readEverything(file, passphrase);
      assert.equal(read.manifest.format, 2);
      assert.equal(read.manifest.app.version, '1.3.1');
      assert.deepEqual(read.manifest.tables.map((table) => [table.name, table.rows]), [['users', 2500], ['empty_table', 0]]);
      assert.deepEqual(read.manifest.buckets, [
        { key: 'app-icons', files: 1, bytes: 6 },
        { key: 'avatars', files: 0, bytes: 0 },
        { key: 'plugins', files: 1, bytes: 70000 },
      ]);
      assert.equal(read.schema[0].name, 'users');
      assert.equal(read.tables.users.length, 2500);
      assert.deepEqual(read.tables.users[1], { id: 'u-1', email: 'user1@example.com', note: 'line one\nline "two" 1' });
      assert.equal(read.tables.users[0].note, null);
      assert.deepEqual(read.tables.empty_table, []);
      assert.equal(read.files['app-icons/a.svg'].toString(), '<svg/>');
      assert.deepEqual(read.files[`plugins/${longPath}`], Buffer.alloc(70000, 3));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a wrong passphrase fails only after the archive has been read', async () => {
  const { dir, db, buckets } = setup();
  try {
    const file = path.join(dir, 'backup.tar.gz.enc');
    await writeBackupV2({ dbHandle: db, tables: ['users'], schema: [], buckets, app: {}, options: {}, outputPath: file, passphrase: 'format test passphrase' });
    await assert.rejects(readEverything(file, 'not the passphrase!'), (error) => error.code === 'backup_passphrase_invalid');
    await assert.rejects(readEverything(file, null), (error) => error.code === 'backup_passphrase_required');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v1 archives are detected, and unsafe paths in v2 archives are rejected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-format-detect-'));
  try {
    const v1 = path.join(dir, 'v1.json.gz');
    fs.writeFileSync(v1, zlib.gzipSync(Buffer.from(JSON.stringify({ version: 1, database: { tables: [] }, buckets: [] }))));
    assert.deepEqual(await detectBackupFile(v1), { format: 1, encrypted: false });

    const manifest = Buffer.from(JSON.stringify({ format: 2, tables: [], buckets: [] }));
    const evil = Buffer.from('owned');
    const tar = Buffer.concat([
      entryHeader('manifest.json', manifest.length), manifest, entryPadding(manifest.length),
      entryHeader('files/app-icons/../../escape.txt', evil.length), evil, entryPadding(evil.length),
      END_OF_ARCHIVE,
    ]);
    const bad = path.join(dir, 'bad.tar.gz');
    fs.writeFileSync(bad, zlib.gzipSync(tar));
    await assert.rejects(readEverything(bad), /Invalid backup file path/);

    const junk = path.join(dir, 'junk.bin');
    fs.writeFileSync(junk, Buffer.from('definitely not a backup'));
    await assert.rejects(detectBackupFile(junk), /not a valid Frontdoor backup/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
