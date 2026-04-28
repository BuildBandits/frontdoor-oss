import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractMyAppsApplicationId, isValidEntraApplicationId, normalizeEntraApplicationId } from '../shared/entra.js';

describe('entra application id helpers', () => {
  it('extracts the app id from a full MyApps launcher URL', () => {
    const input = 'https://launcher.myapps.microsoft.com/api/signin/d86f5bc4-85e1-4783-a129-c8baea8927c2?tenantId=27ad5cd6-8142-4989-b9bf-c5075d53c1dc';
    assert.equal(extractMyAppsApplicationId(input), 'd86f5bc4-85e1-4783-a129-c8baea8927c2');
    assert.equal(normalizeEntraApplicationId(input), 'd86f5bc4-85e1-4783-a129-c8baea8927c2');
    assert.equal(isValidEntraApplicationId(extractMyAppsApplicationId(input)), true);
  });

  it('keeps a bare application id intact', () => {
    const input = 'D86F5BC4-85E1-4783-A129-C8BAEA8927C2';
    assert.equal(normalizeEntraApplicationId(input), 'd86f5bc4-85e1-4783-a129-c8baea8927c2');
    assert.equal(isValidEntraApplicationId(input), true);
  });
});
