import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import { Readable, Transform } from 'stream';
import { UserFacingError } from './errors.js';

// Encrypted v1 archives: magic | salt (16) | iv (12) | GCM tag (16) | ciphertext of the gzipped JSON.
const ENCRYPTION_MAGIC = Buffer.from('FDBKENC1', 'ascii');
// Encrypted streams (v2 archives, database exports): magic | salt (16) | iv (12) | ciphertext | GCM tag (16).
// The tag goes last so the file can be written in one pass.
const STREAM_MAGIC = Buffer.from('FDBKENC2', 'ascii');
const STREAM_HEADER_LENGTH = STREAM_MAGIC.length + 16 + 12;
const TAG_LENGTH = 16;
const MIN_PASSPHRASE_LENGTH = 12;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function assertValidPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new UserFacingError(`The backup passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`, {
      code: 'backup_passphrase_too_short',
      details: { minLength: MIN_PASSPHRASE_LENGTH },
    });
  }
}

// 1 for in-memory encrypted v1 archives, 2 for streamed encryption, null otherwise.
export function encryptionFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < ENCRYPTION_MAGIC.length) return null;
  const magic = buffer.subarray(0, ENCRYPTION_MAGIC.length);
  if (magic.equals(ENCRYPTION_MAGIC)) return 1;
  if (magic.equals(STREAM_MAGIC)) return 2;
  return null;
}

export function isEncryptedBackup(buffer) {
  return encryptionFormat(buffer) !== null;
}

function invalidPassphrase() {
  return new UserFacingError('Wrong passphrase, or the backup file is damaged.', { code: 'backup_passphrase_invalid' });
}

function requirePassphrase(passphrase) {
  if (!passphrase) {
    throw new UserFacingError('This backup is encrypted: enter its passphrase.', { code: 'backup_passphrase_required' });
  }
}

// Transform stream that writes the header, the encrypted data and finally the tag.
export function createEncryptStream(passphrase) {
  assertValidPassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let headerSent = false;
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (!headerSent) {
        this.push(Buffer.concat([STREAM_MAGIC, salt, iv]));
        headerSent = true;
      }
      callback(null, cipher.update(chunk));
    },
    flush(callback) {
      if (!headerSent) this.push(Buffer.concat([STREAM_MAGIC, salt, iv]));
      this.push(cipher.final());
      callback(null, cipher.getAuthTag());
    },
  });
}

// Readable stream with the decrypted content of a streamed-encryption file. A
// wrong passphrase or tampered file surfaces as a backup_passphrase_invalid
// error at the end of the stream, so callers must only commit after it ends.
export async function createDecryptStream(filePath, passphrase) {
  requirePassphrase(passphrase);
  const { size } = await fsp.stat(filePath);
  if (size < STREAM_HEADER_LENGTH + TAG_LENGTH) throw invalidPassphrase();
  const handle = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(STREAM_HEADER_LENGTH);
    await handle.read(header, 0, STREAM_HEADER_LENGTH, 0);
    const tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(tag, 0, TAG_LENGTH, size - TAG_LENGTH);
    const salt = header.subarray(STREAM_MAGIC.length, STREAM_MAGIC.length + 16);
    const iv = header.subarray(STREAM_MAGIC.length + 16, STREAM_HEADER_LENGTH);
    const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const mapped = new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
    const ciphertextEnd = size - TAG_LENGTH - 1;
    // No ciphertext at all (empty input): an empty source still lets final() check the tag.
    const source = ciphertextEnd < STREAM_HEADER_LENGTH
      ? Readable.from([])
      : fs.createReadStream(filePath, { start: STREAM_HEADER_LENGTH, end: ciphertextEnd });
    source.on('error', (error) => mapped.destroy(error));
    decipher.on('error', () => mapped.destroy(invalidPassphrase()));
    source.pipe(decipher).pipe(mapped);
    return mapped;
  } finally {
    await handle.close();
  }
}

export function encryptBackup(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([ENCRYPTION_MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(buffer, passphrase) {
  requirePassphrase(passphrase);
  let offset = ENCRYPTION_MAGIC.length;
  const salt = buffer.subarray(offset, offset + 16);
  offset += 16;
  const iv = buffer.subarray(offset, offset + 12);
  offset += 12;
  const tag = buffer.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = buffer.subarray(offset);
  try {
    const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw invalidPassphrase();
  }
}
