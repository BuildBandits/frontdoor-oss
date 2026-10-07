// Minimal streaming ustar writer and reader for Frontdoor backups. Only regular
// files are supported; paths longer than 100 bytes use a PAX extended header.
// The output is a standard tar stream, so archives can be inspected with `tar`.
import { Readable } from 'stream';

const BLOCK = 512;

function encodeOctal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function buildHeader({ name, size, type = '0', mtime }) {
  const header = Buffer.alloc(BLOCK, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(encodeOctal(0o644, 8), 100, 8, 'ascii');
  header.write(encodeOctal(0, 8), 108, 8, 'ascii');
  header.write(encodeOctal(0, 8), 116, 8, 'ascii');
  header.write(encodeOctal(size, 12), 124, 12, 'ascii');
  header.write(encodeOctal(Math.floor((mtime ?? Date.now()) / 1000), 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function padding(size) {
  const rest = size % BLOCK;
  return rest === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - rest, 0);
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length += 1;
  return `${length}${body}`;
}

// Yields the header blocks for one entry (with a PAX header when the name is long).
export function entryHeader(name, size, mtime) {
  if (Buffer.byteLength(name) <= 100) return buildHeader({ name, size, mtime });
  const pax = Buffer.from(paxRecord('path', name), 'utf8');
  return Buffer.concat([
    buildHeader({ name: 'PaxHeader', size: pax.length, type: 'x', mtime }),
    pax,
    padding(pax.length),
    buildHeader({ name: name.slice(0, 100), size, mtime }),
  ]);
}

export function entryPadding(size) {
  return padding(size);
}

export const END_OF_ARCHIVE = Buffer.alloc(BLOCK * 2, 0);

function parseOctal(buffer, offset, length) {
  const text = buffer.toString('ascii', offset, offset + length).replace(/\0.*$/, '').trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function parseString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.toString('utf8', offset, end === -1 || end > offset + length ? offset + length : end);
}

function parsePax(buffer) {
  const values = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(buffer.toString('ascii', offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = buffer.toString('utf8', space + 1, offset + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) values[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return values;
}

// Reads a tar stream and calls onEntry({ name, size }, contentStream) for every
// regular file, waiting for the returned promise before reading on. The content
// stream must be fully consumed by onEntry.
export async function readTar(source, onEntry) {
  const iterator = source[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let ended = false;

  async function fill(minimum) {
    while (pending.length < minimum && !ended) {
      const { value, done } = await iterator.next();
      if (done) ended = true;
      else pending = pending.length === 0 ? Buffer.from(value) : Buffer.concat([pending, value]);
    }
    return pending.length >= minimum;
  }

  async function take(length) {
    if (!(await fill(length))) throw new Error('Unexpected end of backup archive');
    const chunk = pending.subarray(0, length);
    pending = pending.subarray(length);
    return chunk;
  }

  let paxPath = null;
  for (;;) {
    if (!(await fill(BLOCK))) throw new Error('Unexpected end of backup archive');
    const header = await take(BLOCK);
    if (header.every((byte) => byte === 0)) return;

    const size = parseOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const padded = size + ((BLOCK - (size % BLOCK)) % BLOCK);

    if (type === 'x') {
      const data = await take(padded);
      paxPath = parsePax(data.subarray(0, size)).path || null;
      continue;
    }

    const name = paxPath || parseString(header, 0, 100);
    paxPath = null;

    if (type !== '0' && type !== '\0') {
      await take(padded);
      continue;
    }

    // Stream the entry content in chunks so large files never sit in memory at once.
    let remaining = size;
    const content = Readable.from((async function* chunks() {
      while (remaining > 0) {
        if (pending.length === 0 && !(await fill(1))) throw new Error('Unexpected end of backup archive');
        const piece = pending.subarray(0, Math.min(remaining, pending.length));
        pending = pending.subarray(piece.length);
        remaining -= piece.length;
        yield piece;
      }
    })());

    await onEntry({ name, size }, content);
    // Drain anything the handler did not read, then skip the padding.
    for await (const chunk of content) void chunk;
    await take(padded - size);
  }
}
