import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sortOptionsByLabel } from '../src/utils/sortOptions.js';

const labels = (options) => options.map((option) => option.label);

describe('sortOptionsByLabel', () => {
  it('keeps "all" first and sorts the rest by label', () => {
    const options = [
      { value: 'all', label: 'Tutti' },
      { value: 'inactive', label: 'Solo disattivati' },
      { value: 'entraMissing', label: 'Non trovati in Entra' },
      { value: 'neverSignedIn', label: 'Mai collegati' },
    ];
    assert.deepEqual(labels(sortOptionsByLabel(options, 'it')), ['Tutti', 'Mai collegati', 'Non trovati in Entra', 'Solo disattivati']);
  });

  it('keeps a clearSelection option first in multi-select menus', () => {
    const options = [{ value: '__all__', label: 'All admins', clearSelection: true }, { value: 'b', label: 'bob' }, { value: 'a', label: 'Alice' }];
    assert.deepEqual(labels(sortOptionsByLabel(options, 'en')), ['All admins', 'Alice', 'bob']);
  });

  it('ignores case and accents, and does not change the input', () => {
    const options = [{ value: 'z', label: 'Zeta' }, { value: 'e', label: 'école' }, { value: 'a', label: 'Alpha' }];
    assert.deepEqual(labels(sortOptionsByLabel(options, 'en')), ['Alpha', 'école', 'Zeta']);
    assert.deepEqual(labels(options), ['Zeta', 'école', 'Alpha']);
  });
});
