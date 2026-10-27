import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { docsUrl } from '../src/utils/docsLinks.js';

describe('docsUrl', () => {
  it('builds the English page at the root and the Italian one under /it', () => {
    assert.equal(docsUrl('admins/backup', 'en', 'https://docs.example.com'), 'https://docs.example.com/docs/admins/backup/');
    assert.equal(docsUrl('admins/backup', 'it', 'https://docs.example.com'), 'https://docs.example.com/it/docs/admins/backup/');
  });

  it('returns null when the docs base URL is empty', () => {
    assert.equal(docsUrl('admins/backup', 'en', ''), null);
  });
});
