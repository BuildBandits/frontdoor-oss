export const SELECTION_FILTERS = ['all', 'selected', 'unselected'];

// The selected/unselected views work on a snapshot of the selection taken when
// the view is chosen, so an item toggled while the view is open stays in place
// instead of disappearing under the pointer.
export function filterBySelection(items, filter, selectionSnapshot, getId = (item) => item.id) {
  if (filter === 'all' || !Array.isArray(selectionSnapshot)) return items;
  const snapshot = new Set(selectionSnapshot);
  const wantSelected = filter === 'selected';
  return items.filter((item) => snapshot.has(getId(item)) === wantSelected);
}
