import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractMyAppsApplicationId, isValidEntraApplicationId, normalizeEntraApplicationId } from '../shared/entra.js';

describe('entra application id helpers', () => {
  it('extracts the app id from a full MyApps launcher URL', () => {
    const input = 'https://launcher.myapps.microsoft.com/api/signin/aaaabbbb-cccc-dddd-eeee-ffff00001111?tenantId=00000000-0000-0000-0000-000000000000';
    assert.equal(extractMyAppsApplicationId(input), 'aaaabbbb-cccc-dddd-eeee-ffff00001111');
    assert.equal(normalizeEntraApplicationId(input), 'aaaabbbb-cccc-dddd-eeee-ffff00001111');
    assert.equal(isValidEntraApplicationId(extractMyAppsApplicationId(input)), true);
  });

  it('keeps a bare application id intact', () => {
    const input = 'AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111';
    assert.equal(normalizeEntraApplicationId(input), 'aaaabbbb-cccc-dddd-eeee-ffff00001111');
    assert.equal(isValidEntraApplicationId(input), true);
  });
});
