export const GROUP_SELECTION_FILTERS = ['all', 'selected', 'unselected'];

// The selected/unselected views work on a snapshot of the selection taken when
// the view is chosen, so a group toggled while the view is open stays in place
// instead of disappearing under the pointer.
export function filterGroupsBySelection(groups, filter, selectionSnapshot) {
  if (filter === 'all' || !Array.isArray(selectionSnapshot)) return groups;
  const snapshot = new Set(selectionSnapshot);
  const wantSelected = filter === 'selected';
  return groups.filter((group) => snapshot.has(group.id) === wantSelected);
}
