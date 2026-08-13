import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptPluginSecret,
  encryptPluginSecret,
} from '../server/services/pluginSecrets.js';

test('plugin backend secrets are authenticated-encrypted at rest', () => {
  const previousKey = process.env.PLUGIN_SECRET_ENCRYPTION_KEY;
  process.env.PLUGIN_SECRET_ENCRYPTION_KEY = 'test-only-plugin-secret-key-material-123456789';
  try {
    const encrypted = encryptPluginSecret('webhook-secret-value');
    assert.match(encrypted, /^enc:v1:/);
    assert.equal(encrypted.includes('webhook-secret-value'), false);
    assert.equal(decryptPluginSecret(encrypted), 'webhook-secret-value');
    assert.throws(() => decryptPluginSecret('plaintext-legacy-secret'), /must be re-entered/);

    process.env.PLUGIN_SECRET_ENCRYPTION_KEY = 'different-test-plugin-secret-key-987654321';
    assert.throws(() => decryptPluginSecret(encrypted), /cannot be decrypted/);
  } finally {
    if (previousKey === undefined) delete process.env.PLUGIN_SECRET_ENCRYPTION_KEY;
    else process.env.PLUGIN_SECRET_ENCRYPTION_KEY = previousKey;
  }
});
