import crypto from 'crypto';
import { UserFacingError } from './errors.js';

// Encrypted archives: magic | salt (16) | iv (12) | GCM tag (16) | ciphertext of the gzipped JSON.
const ENCRYPTION_MAGIC = Buffer.from('FDBKENC1', 'ascii');
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

export function isEncryptedBackup(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > ENCRYPTION_MAGIC.length
    && buffer.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC);
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
  if (!passphrase) {
    throw new UserFacingError('This backup is encrypted: enter its passphrase.', { code: 'backup_passphrase_required' });
  }
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
    throw new UserFacingError('Wrong passphrase, or the backup file is damaged.', { code: 'backup_passphrase_invalid' });
  }
}
