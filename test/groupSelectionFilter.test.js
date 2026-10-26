import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { filterGroupsBySelection } from '../src/pages/apps/groupSelectionFilter.js';

const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const ids = (list) => list.map((group) => group.id);

describe('filterGroupsBySelection', () => {
  it('returns every group in the "all" view', () => {
    assert.deepEqual(ids(filterGroupsBySelection(groups, 'all', ['a'])), ['a', 'b', 'c']);
  });

  it('keeps only the groups in the snapshot in the "selected" view', () => {
    assert.deepEqual(ids(filterGroupsBySelection(groups, 'selected', ['a', 'c'])), ['a', 'c']);
  });

  it('keeps only the groups outside the snapshot in the "unselected" view', () => {
    assert.deepEqual(ids(filterGroupsBySelection(groups, 'unselected', ['a', 'c'])), ['b']);
  });

  it('follows the snapshot, not the live selection, so toggled rows stay visible', () => {
    const snapshot = ['a', 'b'];
    // The admin unchecks "a" while the "selected" view is open: the row stays.
    assert.deepEqual(ids(filterGroupsBySelection(groups, 'selected', snapshot)), ['a', 'b']);
  });

  it('applies on top of an already searched list', () => {
    const searched = groups.filter((group) => group.id !== 'a');
    assert.deepEqual(ids(filterGroupsBySelection(searched, 'selected', ['a', 'b'])), ['b']);
  });
});
