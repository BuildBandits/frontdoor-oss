import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeI18n, formatI18nReport } from '../scripts/check-i18n.mjs';

describe('i18n dictionaries', () => {
  it('have no duplicate keys', () => {
    const report = analyzeI18n();
    assert.equal(report.duplicates.length, 0, formatI18nReport(report));
  });

  it('stay aligned across locales', () => {
    const report = analyzeI18n();
    assert.equal(report.mismatches.length, 0, formatI18nReport(report));
  });
});
