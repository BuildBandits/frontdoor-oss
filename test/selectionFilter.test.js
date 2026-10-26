import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { filterBySelection } from '../src/utils/selectionFilter.js';

const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const ids = (list) => list.map((group) => group.id);

describe('filterBySelection', () => {
  it('returns every group in the "all" view', () => {
    assert.deepEqual(ids(filterBySelection(groups, 'all', ['a'])), ['a', 'b', 'c']);
  });

  it('keeps only the groups in the snapshot in the "selected" view', () => {
    assert.deepEqual(ids(filterBySelection(groups, 'selected', ['a', 'c'])), ['a', 'c']);
  });

  it('keeps only the groups outside the snapshot in the "unselected" view', () => {
    assert.deepEqual(ids(filterBySelection(groups, 'unselected', ['a', 'c'])), ['b']);
  });

  it('follows the snapshot, not the live selection, so toggled rows stay visible', () => {
    const snapshot = ['a', 'b'];
    // The admin unchecks "a" while the "selected" view is open: the row stays.
    assert.deepEqual(ids(filterBySelection(groups, 'selected', snapshot)), ['a', 'b']);
  });

  it('applies on top of an already searched list', () => {
    const searched = groups.filter((group) => group.id !== 'a');
    assert.deepEqual(ids(filterBySelection(searched, 'selected', ['a', 'b'])), ['b']);
  });
});

describe('filterBySelection with a custom key', () => {
  it('reads the ID through getId', () => {
    const entraGroups = [{ entra_group_id: 'x' }, { entra_group_id: 'y' }];
    const result = filterBySelection(entraGroups, 'selected', ['y'], (group) => group.entra_group_id);
    assert.deepEqual(result, [{ entra_group_id: 'y' }]);
  });
});
