import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatLocalDateTime } from '../src/utils/dateTime.js';

describe('formatLocalDateTime', () => {
  const value = '2026-10-09 07:05:09';

  it('formats date and time in the given time zone', () => {
    assert.equal(formatLocalDateTime(value, { locale: 'en-GB', timeZone: 'UTC' }), '09 Oct 2026 07:05');
    assert.equal(formatLocalDateTime(value, { locale: 'en-GB', timeZone: 'Europe/Rome' }), '09 Oct 2026 09:05');
  });

  it('adds seconds or uses numeric dates on request', () => {
    assert.equal(formatLocalDateTime(value, { locale: 'en-GB', timeZone: 'UTC', seconds: true }), '09 Oct 2026 07:05:09');
    assert.equal(formatLocalDateTime(value, { locale: 'en-GB', timeZone: 'UTC', numeric: true }), '09/10/2026 07:05');
  });

  it('returns null for values that are not dates', () => {
    assert.equal(formatLocalDateTime(null, { locale: 'en-GB', timeZone: 'UTC' }), null);
    assert.equal(formatLocalDateTime('not a date', { locale: 'en-GB', timeZone: 'UTC' }), null);
  });
});
