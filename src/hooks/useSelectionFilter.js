import { useState } from 'react';
import { filterBySelection } from '../utils/selectionFilter.js';

/**
 * All / selected / not selected view over a checkbox list. `selection` is the
 * live list of selected IDs; `apply(items, getId)` returns the items to show.
 */
export function useSelectionFilter(selection) {
  const [filter, setFilterState] = useState('all');
  const [snapshot, setSnapshot] = useState(null);

  const setFilter = (next) => {
    setFilterState(next);
    setSnapshot(next === 'all' ? null : [...selection]);
  };

  const apply = (items, getId) => filterBySelection(items, filter, snapshot, getId);

  return { filter, setFilter, apply };
}
