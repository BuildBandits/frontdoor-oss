const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let crc = i;
  for (let j = 0; j < 8; j += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  CRC32_TABLE[i] = crc >>> 0;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return textEncoder.encode(String(value ?? ''));
}

function fromBytes(value) {
  return textDecoder.decode(toBytes(value));
}

function normalizeArchiveName(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function sanitizeSegment(value, fallback) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

function writeUInt16LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function createZipEntry(name, data) {
  const fileNameBytes = textEncoder.encode(normalizeArchiveName(name));
  const fileData = toBytes(data);
  const crc = crc32(fileData);
  const localHeader = new Uint8Array(30 + fileNameBytes.length);
  writeUInt32LE(localHeader, 0, 0x04034b50);
  writeUInt16LE(localHeader, 4, 20);
  writeUInt16LE(localHeader, 6, 0x0800);
  writeUInt16LE(localHeader, 8, 0);
  writeUInt16LE(localHeader, 10, 0);
  writeUInt16LE(localHeader, 12, 0);
  writeUInt32LE(localHeader, 14, crc);
  writeUInt32LE(localHeader, 18, fileData.length);
  writeUInt32LE(localHeader, 22, fileData.length);
  writeUInt16LE(localHeader, 26, fileNameBytes.length);
  writeUInt16LE(localHeader, 28, 0);
  localHeader.set(fileNameBytes, 30);

  return {
    fileNameBytes,
    fileData,
    crc,
    localHeader,
  };
}

export function buildZipArchive(entries = []) {
  const normalizedEntries = entries.map((entry) => createZipEntry(entry.name, entry.data));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of normalizedEntries) {
    localParts.push(entry.localHeader, entry.fileData);

    const centralHeader = new Uint8Array(46 + entry.fileNameBytes.length);
    writeUInt32LE(centralHeader, 0, 0x02014b50);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, 0x0800);
    writeUInt16LE(centralHeader, 10, 0);
    writeUInt16LE(centralHeader, 12, 0);
    writeUInt16LE(centralHeader, 14, 0);
    writeUInt32LE(centralHeader, 16, entry.crc);
    writeUInt32LE(centralHeader, 20, entry.fileData.length);
    writeUInt32LE(centralHeader, 24, entry.fileData.length);
    writeUInt16LE(centralHeader, 28, entry.fileNameBytes.length);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt32LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, offset);
    centralHeader.set(entry.fileNameBytes, 46);
    centralParts.push(centralHeader);

    offset += entry.localHeader.length + entry.fileData.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const localArchive = concatBytes(localParts);
  const endRecord = new Uint8Array(22);
  writeUInt32LE(endRecord, 0, 0x06054b50);
  writeUInt16LE(endRecord, 4, 0);
  writeUInt16LE(endRecord, 6, 0);
  writeUInt16LE(endRecord, 8, normalizedEntries.length);
  writeUInt16LE(endRecord, 10, normalizedEntries.length);
  writeUInt32LE(endRecord, 12, centralDirectory.length);
  writeUInt32LE(endRecord, 16, localArchive.length);
  writeUInt16LE(endRecord, 20, 0);

  return concatBytes([localArchive, centralDirectory, endRecord]);
}

function findEndOfCentralDirectory(data) {
  const minimumLength = 22;
  for (let offset = data.length - minimumLength; offset >= 0; offset -= 1) {
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x05 &&
      data[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  return -1;
}

export function parseZipArchive(input) {
  const data = toBytes(input);
  const endOffset = findEndOfCentralDirectory(data);
  if (endOffset < 0) {
    throw new Error('Plugin archive is not a valid ZIP file');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  const entries = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    const signature = view.getUint32(cursor, true);
    if (signature !== 0x02014b50) {
      throw new Error('Plugin archive central directory is invalid');
    }

    const compression = view.getUint16(cursor + 10, true);
    if (compression !== 0) {
      throw new Error('Plugin archive uses unsupported compression');
    }

    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const fileNameBytes = data.slice(cursor + 46, cursor + 46 + fileNameLength);
    const fileName = fromBytes(fileNameBytes);

    const localSignature = view.getUint32(localHeaderOffset, true);
    if (localSignature !== 0x04034b50) {
      throw new Error('Plugin archive local header is invalid');
    }

    const localCompression = view.getUint16(localHeaderOffset + 8, true);
    if (localCompression !== 0) {
      throw new Error('Plugin archive uses unsupported compression');
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const compressedSize = view.getUint32(localHeaderOffset + 18, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const fileData = data.slice(dataOffset, dataOffset + compressedSize);

    entries.push({
      name: normalizeArchiveName(fileName),
      data: fileData,
    });

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  if (entries.length === 0 || centralDirectorySize < 0) {
    throw new Error('Plugin archive is empty');
  }

  return entries;
}

export function buildPluginPackageZip(packageData = {}, options = {}) {
  const manifest = packageData.manifest && typeof packageData.manifest === 'object'
    ? packageData.manifest
    : packageData;
  const moduleSource = String(packageData.moduleSource || '').trim();
  if (!moduleSource) {
    throw new Error('Plugin package ZIP requires moduleSource');
  }

  const packageName = sanitizeSegment(
    options.packageName || manifest.id || manifest.name || 'plugin-package',
    'plugin-package'
  );
  const version = sanitizeSegment(manifest.version || options.version || '0.0.0', '0.0.0');
  const root = `${packageName}-${version}`;
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  return buildZipArchive([
    { name: `${root}/manifest.json`, data: manifestJson },
    { name: `${root}/module.mjs`, data: `${moduleSource}${moduleSource.endsWith('\n') ? '' : '\n'}` },
  ]);
}

export function extractPluginPackageZip(input) {
  const entries = parseZipArchive(input);
  const manifestEntry = entries.find((entry) => entry.name.endsWith('/manifest.json') || entry.name === 'manifest.json');
  const moduleEntry = entries.find((entry) => entry.name.endsWith('/module.mjs') || entry.name === 'module.mjs');

  if (!manifestEntry) {
    throw new Error('Plugin archive is missing manifest.json');
  }
  if (!moduleEntry) {
    throw new Error('Plugin archive is missing module.mjs');
  }

  let manifest;
  try {
    manifest = JSON.parse(fromBytes(manifestEntry.data));
  } catch {
    throw new Error('Plugin archive manifest.json is not valid JSON');
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Plugin archive manifest must be a JSON object');
  }

  return {
    manifest,
    moduleSource: fromBytes(moduleEntry.data).trimEnd(),
  };
}
