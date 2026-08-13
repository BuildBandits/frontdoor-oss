import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const SECRET_PREFIX = 'enc:v1';

function getPluginSecretKey() {
  const material = String(
    process.env.PLUGIN_SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || ''
  );
  if (material.length < 32) {
    throw new Error(
      'PLUGIN_SECRET_ENCRYPTION_KEY (or JWT_SECRET fallback) must be at least 32 characters before storing plugin backend secrets'
    );
  }
  return createHash('sha256').update(material, 'utf8').digest();
}

export function encryptPluginSecret(value) {
  const plaintext = String(value || '');
  if (!plaintext) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getPluginSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptPluginSecret(value) {
  const stored = String(value || '');
  if (!stored) return '';
  if (!stored.startsWith(`${SECRET_PREFIX}:`)) {
    throw new Error('Legacy plaintext plugin secret must be re-entered before backend delivery');
  }

  const parts = stored.split(':');
  if (parts.length !== 5) {
    throw new Error('Stored plugin backend secret is malformed');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const ciphertext = Buffer.from(parts[4], 'base64url');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Stored plugin backend secret is malformed');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', getPluginSecretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored plugin backend secret cannot be decrypted');
  }
}
