import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getUiStrings } from '../src/i18n/index.js';
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

  it('return the same dictionary object for the same language', () => {
    // Components call getUiStrings during render and use the result in hook
    // dependencies; a fresh object per call re-runs those effects on every render.
    for (const language of ['en', 'it']) {
      assert.equal(getUiStrings(language), getUiStrings(language));
    }
    assert.equal(getUiStrings('not-a-language'), getUiStrings('en'));
    assert.notEqual(getUiStrings('it'), getUiStrings('en'));
  });

  it('expose the home tour strings in every locale', () => {
    for (const language of ['en', 'it']) {
      const ui = getUiStrings(language);
      assert.ok(ui.home.tour);
      assert.equal(typeof ui.home.tour.skip, 'string');
      assert.equal(typeof ui.home.tour.steps.welcome.title, 'string');
      assert.equal(typeof ui.home.tour.steps.welcome.body, 'string');
      assert.equal(typeof ui.home.tour.steps.reorder.body, 'string');
      assert.equal(typeof ui.home.tour.steps.menu.body, 'string');
      assert.equal(typeof ui.layout.takeTour, 'string');
    }
  });
});
