import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAllChecked, isItemChecked, toggleAll, toggleItem } from '../src/utils/selectAll.js';

const items = ['a', 'b', 'c'];

describe('select all', () => {
  it('shows every item checked when nothing is selected', () => {
    assert.equal(isAllChecked([], false), true);
    assert.equal(isItemChecked('b', [], false), true);
  });

  it('shows nothing checked after unchecking everything', () => {
    assert.equal(isAllChecked([], true), false);
    assert.equal(isItemChecked('b', [], true), false);
  });

  it('unchecking one item from "all" keeps the others', () => {
    assert.deepEqual(toggleItem(items, [], false, 'b'), { values: ['a', 'c'], noneChecked: false });
  });

  it('checking the last missing item goes back to "all"', () => {
    assert.deepEqual(toggleItem(items, ['a', 'c'], false, 'b'), { values: [], noneChecked: false });
  });

  it('unchecking the last checked item leaves nothing checked and no filter', () => {
    assert.deepEqual(toggleItem(items, ['a'], false, 'a'), { values: [], noneChecked: true });
    assert.deepEqual(toggleItem(['a'], [], false, 'a'), { values: [], noneChecked: true });
  });

  it('checking one item from "none" selects only that item', () => {
    assert.deepEqual(toggleItem(items, [], true, 'b'), { values: ['b'], noneChecked: false });
  });

  it('"All" toggles between every item and none', () => {
    assert.deepEqual(toggleAll([], false), { values: [], noneChecked: true });
    assert.deepEqual(toggleAll([], true), { values: [], noneChecked: false });
    assert.deepEqual(toggleAll(['a'], false), { values: [], noneChecked: false });
  });
});
