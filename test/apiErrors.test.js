import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { formatMessage, getUiStrings } from '../src/i18n/index.js';
import { apiErrorMessage } from '../src/utils/apiErrors.js';
import { analyzePluginPackage } from '../src/pluginHost/packageUtils.js';
import { extractPluginPackageZip } from '../shared/packageZip.js';
import { APP_SLUG_ERROR_CODES } from '../shared/appSlug.js';
import { TARGET_URL_ERROR_CODES } from '../shared/targetUrl.js';
import { respondWithError } from '../server/services/errors.js';

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

describe('API error translations', () => {
  it('formats placeholders and keeps unknown ones', () => {
    assert.equal(formatMessage('{a} and {b}', { a: 1 }), '1 and {b}');
    assert.equal(formatMessage(undefined), '');
  });

  it('prefers the translated code, then readable server text, then the fallback', () => {
    const ui = getUiStrings('it');
    const withCode = { response: { data: { error: 'App not found', code: 'app_not_found' } } };
    assert.equal(apiErrorMessage(withCode, ui, 'fallback'), ui.errors.app_not_found);

    const unknownCode = { response: { data: { error: 'Something readable', code: 'not_a_known_code' } } };
    assert.equal(apiErrorMessage(unknownCode, ui, 'fallback'), 'Something readable');

    const bareCode = { response: { data: { error: 'failed_to_do_something' } } };
    assert.equal(apiErrorMessage(bareCode, ui, 'fallback'), 'fallback');

    const withDetails = { error: 'x', code: 'backup_passphrase_too_short', details: { minLength: 12 } };
    assert.match(apiErrorMessage(withDetails, ui, 'fallback'), /12/);

    assert.equal(apiErrorMessage(new Error('boom'), ui, 'fallback'), 'fallback');
  });

  it('translates every error code the server and shared code can return', () => {
    const codes = new Set([
      ...Object.values(APP_SLUG_ERROR_CODES),
      ...Object.values(TARGET_URL_ERROR_CODES),
    ]);
    const patterns = [
      /\bcode: '([a-z0-9_]+)'/g,
      /\|\| '((?:failed_to|plugin)_[a-z0-9_]+)'/g,
      /(?:archiveError|pluginError)\('([a-z0-9_]+)'/g,
    ];
    for (const file of [...listSourceFiles('server'), ...listSourceFiles('shared')]) {
      if (file.endsWith('languages.js') || file.endsWith('verifySsoToken.js')) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) codes.add(match[1]);
      }
    }
    for (const field of ['entry', 'backend_url']) {
      for (const kind of ['invalid', 'protocol', 'private_network']) codes.add(`plugin_${field}_${kind}`);
    }

    for (const language of ['en', 'it']) {
      const ui = getUiStrings(language);
      const missing = [...codes].filter((code) => typeof ui.errors[code] !== 'string');
      assert.deepEqual(missing, [], `${language}: missing error translations`);
    }
  });

  it('returns a readable message and a code from respondWithError fallbacks', () => {
    let statusCode;
    let body;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; },
    };
    respondWithError(res, new Error('internal detail'), { status: 500, code: 'failed_to_update_branding' });
    assert.equal(statusCode, 500);
    assert.deepEqual(body, { error: 'Failed to update branding', code: 'failed_to_update_branding' });
  });

  it('gives plugin archive errors a translatable code', () => {
    assert.throws(() => extractPluginPackageZip(new Uint8Array([1, 2, 3])), (error) => (
      error.code === 'plugin_archive_invalid_zip' && /not a valid ZIP/.test(error.message)
    ));
  });

  it('returns translatable keys from the plugin package analysis', () => {
    const analysis = analyzePluginPackage({ manifest: { backend: { enabled: true } } });
    for (const language of ['en', 'it']) {
      const t = getUiStrings(language).admin.plugins.analysis;
      for (const check of analysis.checks) {
        assert.equal(typeof t.checks[check.key], 'string', `check ${check.key}`);
        if (check.detailKey) assert.equal(typeof t.details[check.detailKey], 'string', `detail ${check.detailKey}`);
      }
      for (const warning of analysis.warnings) {
        assert.equal(typeof t.warnings[warning], 'string', `warning ${warning}`);
      }
    }
    assert.equal(analysis.summary.entry, '');
  });
});
