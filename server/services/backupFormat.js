// Backup format v2: a gzipped tar stream (optionally encrypted) containing
//   manifest.json                  format, app, options, tables (columns, rows), buckets (files, bytes)
//   schema.json                    sqlite_master SQL of the source database
//   database/<table>.ndjson        one JSON object per row
//   files/<bucket>/<relative path> raw file contents
// Nothing here imports the database, so CLI scripts can use it too.
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createDecryptStream, createEncryptStream, encryptionFormat } from './backupCrypto.js';
import { UserFacingError } from './errors.js';
import { END_OF_ARCHIVE, entryHeader, entryPadding, readTar } from './tarStream.js';

export const BACKUP_FORMAT_V2 = 2;
const TABLE_NAME_RE = /^[A-Za-z0-9_]+$/;
const BUCKET_KEY_RE = /^[a-z0-9-]+$/;

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

export function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !path.posix.isAbsolute(value)
    && !/^[A-Za-z]:/.test(value)
    && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkFiles(rootDir, absolutePath));
    } else if (entry.isFile()) {
      const { size } = await fsp.stat(absolutePath);
      results.push({ absolutePath, path: path.relative(rootDir, absolutePath).split(path.sep).join('/'), size });
    }
  }
  return results;
}

// Writes one table as NDJSON to a temp file, reading rows one at a time.
async function writeTableFile(dbHandle, tableName, filePath) {
  const columns = dbHandle.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((column) => column.name);
  const out = fs.createWriteStream(filePath);
  let rows = 0;
  for (const row of dbHandle.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).iterate()) {
    const line = `${JSON.stringify(row)}\n`;
    if (!out.write(line)) await new Promise((resolve) => out.once('drain', resolve));
    rows += 1;
  }
  await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  const { size } = await fsp.stat(filePath);
  return { name: tableName, columns, rows, size };
}

async function* tarEntries(entries) {
  for (const entry of entries) {
    yield entryHeader(entry.name, entry.size);
    if (entry.data) {
      yield entry.data;
    } else {
      for await (const chunk of fs.createReadStream(entry.filePath)) yield chunk;
    }
    yield entryPadding(entry.size);
    entry.onDone?.();
  }
  yield END_OF_ARCHIVE;
}

/**
 * Writes a v2 backup to outputPath.
 * @returns {Promise<{ manifest: object }>}
 */
export async function writeBackupV2({
  dbHandle,
  tables,
  schema,
  buckets,
  app,
  options,
  createdAt = new Date().toISOString(),
  outputPath,
  passphrase = null,
  onProgress,
}) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'frontdoor-backup-write-'));
  try {
    const tableFiles = [];
    for (const tableName of tables) {
      tableFiles.push({ ...await writeTableFile(dbHandle, tableName, path.join(workDir, `${tableName}.ndjson`)), filePath: path.join(workDir, `${tableName}.ndjson`) });
    }
    onProgress?.('database');

    const bucketFiles = [];
    for (const bucket of buckets) {
      bucketFiles.push({ key: bucket.key, files: await walkFiles(bucket.dir) });
    }

    const manifest = {
      format: BACKUP_FORMAT_V2,
      createdAt,
      app,
      options,
      tables: tableFiles.map(({ name, columns, rows }) => ({ name, columns, rows })),
      buckets: bucketFiles.map(({ key, files }) => ({ key, files: files.length, bytes: files.reduce((total, file) => total + file.size, 0) })),
    };
    manifest.summary = {
      tableCount: manifest.tables.length,
      rowCount: manifest.tables.reduce((total, table) => total + table.rows, 0),
      fileCount: manifest.buckets.reduce((total, bucket) => total + bucket.files, 0),
      fileBytes: manifest.buckets.reduce((total, bucket) => total + bucket.bytes, 0),
    };

    const manifestData = Buffer.from(JSON.stringify(manifest), 'utf8');
    const schemaData = Buffer.from(JSON.stringify(schema), 'utf8');
    const entries = [
      { name: 'manifest.json', size: manifestData.length, data: manifestData },
      { name: 'schema.json', size: schemaData.length, data: schemaData },
      ...tableFiles.map((table) => ({ name: `database/${table.name}.ndjson`, size: table.size, filePath: table.filePath })),
    ];
    for (const bucket of bucketFiles) {
      bucket.files.forEach((file, index) => {
        entries.push({
          name: `files/${bucket.key}/${file.path}`,
          size: file.size,
          filePath: file.absolutePath,
          onDone: index === bucket.files.length - 1 ? () => onProgress?.(bucket.key) : undefined,
        });
      });
      if (bucket.files.length === 0) entries.push({ name: '', skip: true, onDone: () => onProgress?.(bucket.key) });
    }

    const streams = [
      Readable.from(tarEntries(entries.filter((entry) => !entry.skip))),
      zlib.createGzip({ level: 6 }),
    ];
    if (passphrase) streams.push(createEncryptStream(passphrase));
    await pipeline(...streams, fs.createWriteStream(outputPath));
    // Buckets without files never produced an entry: report them as done too.
    for (const entry of entries.filter((item) => item.skip)) entry.onDone();
    return { manifest };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

async function readHead(filePath, length) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Identifies a backup file: { format: 1 | 2, encrypted: boolean }.
 * Encrypted v1 files use the in-memory scheme; streamed encryption is always v2.
 */
export async function detectBackupFile(filePath) {
  const head = await readHead(filePath, 64);
  const encryption = encryptionFormat(head);
  if (encryption === 1) return { format: 1, encrypted: true };
  if (encryption === 2) return { format: 2, encrypted: true };
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
    // Gzip: v1 is JSON, v2 is a tar whose first entry is manifest.json.
    const first = await new Promise((resolve) => {
      const gunzip = zlib.createGunzip();
      const chunks = [];
      let total = 0;
      const source = fs.createReadStream(filePath, { start: 0, end: 64 * 1024 });
      const done = () => {
        source.destroy();
        gunzip.destroy();
        resolve(Buffer.concat(chunks));
      };
      gunzip.on('data', (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= 16) done();
      });
      gunzip.on('error', done);
      gunzip.on('end', done);
      source.pipe(gunzip);
    });
    if (first.subarray(0, 13).toString('utf8') === 'manifest.json') return { format: 2, encrypted: false };
    if (first.toString('utf8').trimStart().startsWith('{')) return { format: 1, encrypted: false };
  }
  throw new UserFacingError('Backup file is not a valid Frontdoor backup', { code: 'backup_invalid' });
}

// Reads an NDJSON file synchronously, one row at a time. Used inside database
// transactions, which must not yield to the event loop while open.
export function* readNdjsonFileSync(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let rest = Buffer.alloc(0);
    for (;;) {
      const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      rest = rest.length ? Buffer.concat([rest, chunk.subarray(0, bytesRead)]) : Buffer.from(chunk.subarray(0, bytesRead));
      let newline = rest.indexOf(0x0a);
      while (newline !== -1) {
        const line = rest.subarray(0, newline).toString('utf8');
        rest = rest.subarray(newline + 1);
        if (line) yield JSON.parse(line);
        newline = rest.indexOf(0x0a);
      }
    }
    const last = rest.toString('utf8').trim();
    if (last) yield JSON.parse(last);
  } finally {
    fs.closeSync(fd);
  }
}

// Splits a stream of NDJSON text into parsed rows.
async function* ndjsonRows(content) {
  let rest = '';
  for await (const chunk of content) {
    rest += chunk.toString('utf8');
    let newline = rest.indexOf('\n');
    while (newline !== -1) {
      const line = rest.slice(0, newline);
      rest = rest.slice(newline + 1);
      if (line) yield JSON.parse(line);
      newline = rest.indexOf('\n');
    }
  }
  if (rest.trim()) yield JSON.parse(rest);
}

/**
 * Streams a v2 backup and calls the visitor for each part, in archive order:
 *   onManifest(manifest), onSchema(schema), onTable(name, rowsAsyncIterable),
 *   onFile(bucketKey, relativePath, size, contentStream)
 * Every handler may be async. Throws UserFacingError for malformed archives and
 * backup_passphrase_* errors for encryption problems; the error for a wrong
 * passphrase or tampering only arrives at the end, so callers must not commit
 * anything before this function resolves.
 */
export async function readBackupV2(filePath, { passphrase = null, onManifest, onSchema, onTable, onFile } = {}) {
  const { format, encrypted } = await detectBackupFile(filePath);
  if (format !== 2) throw new UserFacingError('Not a v2 backup file', { code: 'backup_invalid' });
  const source = encrypted ? await createDecryptStream(filePath, passphrase) : fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  source.on('error', (error) => gunzip.destroy(error));
  source.pipe(gunzip);

  let manifest = null;
  try {
    await readTar(gunzip, async ({ name, size }, content) => {
      if (name === 'manifest.json' || name === 'schema.json') {
        const parts = [];
        for await (const part of content) parts.push(part);
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (name === 'manifest.json') {
          if (value?.format !== BACKUP_FORMAT_V2) throw new UserFacingError(`Unsupported backup format: ${value?.format ?? 'missing'}`, { code: 'backup_format_unsupported' });
          manifest = value;
          await onManifest?.(value);
        } else {
          await onSchema?.(value);
        }
        return;
      }
      if (!manifest) throw new UserFacingError('Backup manifest is missing', { code: 'backup_invalid' });

      const tableMatch = /^database\/([^/]+)\.ndjson$/.exec(name);
      if (tableMatch) {
        if (!TABLE_NAME_RE.test(tableMatch[1])) throw new UserFacingError('Invalid table name in backup', { code: 'backup_invalid' });
        await onTable?.(tableMatch[1], ndjsonRows(content));
        return;
      }

      const fileMatch = /^files\/([^/]+)\/(.+)$/.exec(name);
      if (fileMatch) {
        if (!BUCKET_KEY_RE.test(fileMatch[1]) || !isSafeRelativePath(fileMatch[2])) {
          throw new UserFacingError(`Invalid backup file path in bucket ${fileMatch[1]}`, { code: 'backup_invalid_file_path' });
        }
        await onFile?.(fileMatch[1], fileMatch[2], size, content);
      }
    });
  } catch (error) {
    if (error?.expose) throw error;
    if (encrypted && error?.code === 'backup_passphrase_invalid') throw error;
    if (error instanceof SyntaxError) throw new UserFacingError('Backup file contains invalid data', { code: 'backup_invalid' });
    if (error?.code === 'Z_DATA_ERROR' || error?.code === 'Z_BUF_ERROR' || /Unexpected end/.test(error?.message || '')) {
      throw new UserFacingError('Backup file is truncated or damaged', { code: 'backup_damaged' });
    }
    throw error;
  }
  if (!manifest) throw new UserFacingError('Backup manifest is missing', { code: 'backup_invalid' });
  return manifest;
}
