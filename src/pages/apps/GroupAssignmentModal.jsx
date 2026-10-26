import { useState } from 'react';
import { X, Save } from 'lucide-react';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';
import { DEFAULT_GROUP_ID } from '../../../shared/groups.js';
import { GROUP_SELECTION_FILTERS, filterGroupsBySelection } from './groupSelectionFilter.js';

export default function GroupAssignmentModal(props) {
  if (!props.pendingGroupAssignApp) return null;
  return <GroupAssignmentDialog {...props} />;
}

function GroupAssignmentDialog({
  pendingGroupAssignApp,
  closeGroupAssignmentModal,
  apps,
  hasPendingGroupAssignmentChanges,
  openConfirm,
  t,
  a,
  groupAssignSearch,
  setGroupAssignSearch,
  ui,
  groupAssignSelection,
  filteredGroups,
  hasGroupAssignSearch,
  selectVisibleGroups,
  groupsLoading,
  toggleGroupAssignment,
  groupLabel,
  saveGroupAssignment,
  assigningGroups,
  groupAssignAllowNoChanges,
}) {
  const [selectionFilter, setSelectionFilter] = useState('all');
  const [selectionSnapshot, setSelectionSnapshot] = useState(null);
  const visibleGroups = filterGroupsBySelection(filteredGroups, selectionFilter, selectionSnapshot);
  const selectionFilterLabels = {
    all: a.groupFilterAll,
    selected: a.groupFilterSelected,
    unselected: a.groupFilterUnselected,
  };

  const changeSelectionFilter = (filter) => {
    setSelectionFilter(filter);
    setSelectionSnapshot(filter === 'all' ? null : [...groupAssignSelection]);
  };

  return (
    <Modal onClose={closeGroupAssignmentModal} closeOnEscape={false} closeOnBackdrop={false} labelledBy="apps-dialog-2-title" panelClassName="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800" overlayClassName="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 px-4 py-4">
        <button
          type="button"
          onClick={() => {
            if (hasPendingGroupAssignmentChanges) {
              openConfirm({
                title: t.closeWithoutSavingTitle,
                message: t.closeWithoutSavingGroupsMessage,
                confirmLabel: t.close,
                onConfirm: async () => closeGroupAssignmentModal(),
              });
              return;
            }
            closeGroupAssignmentModal();
          }}
          className="absolute top-4 right-4 p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          aria-label={a.closeGroupSelection}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 sm:p-8">
          <div className="mb-6">
            <h2 id="apps-dialog-2-title" className="text-2xl font-extrabold text-dark dark:text-gray-100">{a.addToGroupsTitle}</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {a.addToGroupsHelp}
            </p>
            {pendingGroupAssignApp?.defaultIncluded ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {a.defaultGroupAlreadyCreated}
              </p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {a.defaultGroupMissingHelp}
              </p>
            )}
          </div>

          <div className="mb-4">
            <ClearableSearchField
              value={groupAssignSearch}
              onChange={setGroupAssignSearch}
              placeholder={ui.admin.apps.searchGroupsPlaceholder}
              clearLabel={ui.common.clearSearch}
              autoFocus
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label={a.groupFilterLabel} className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-0.5">
                {GROUP_SELECTION_FILTERS.map((filter) => {
                  const active = selectionFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => changeSelectionFilter(filter)}
                      aria-pressed={active}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-white dark:bg-gray-800 text-dark dark:text-gray-100 shadow-sm'
                          : 'text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white'
                      }`}
                    >
                      {selectionFilterLabels[filter]}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => changeSelectionFilter('selected')}
                  disabled={groupAssignSelection.length === 0}
                  title={a.showSelectedGroups}
                  className="hover:text-dark dark:hover:text-white hover:underline disabled:no-underline disabled:hover:text-gray-400 dark:disabled:hover:text-gray-500"
                >
                  {groupAssignSelection.length} {a.selectedGroupSummary}
                </button>
                <span>{visibleGroups.length} {t.groups}</span>
              </div>
            </div>
            {hasGroupAssignSearch && selectionFilter !== 'selected' && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => selectVisibleGroups(visibleGroups)}
                  disabled={visibleGroups.length === 0}
                  className="text-xs font-medium text-accent-dark hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {a.selectAllFiltered}
                </button>
              </div>
            )}
          </div>

          {groupsLoading ? (
            <div className="animate-pulse grid gap-2 sm:grid-cols-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800" />
              ))}
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-3 py-4">
              {selectionFilter === 'selected' && !hasGroupAssignSearch ? a.noSelectedGroups : ui.admin.apps.noGroupsFound}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 max-h-[48vh] overflow-y-auto pr-1">
              {visibleGroups.map((group) => {
                const selected = groupAssignSelection.includes(group.id);
                const groupSourceLabel = group.source === 'entra' ? ui.admin.groups.entraBadge : ui.admin.groups.localBadge;
                return (
                  <label
                    key={group.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                      selected ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleGroupAssignment(group.id)}
                      className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{groupLabel(group)}</span>
                        <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-sm font-medium">
                          {groupSourceLabel}
                        </span>
                        {group.id === DEFAULT_GROUP_ID && (
                          <span className="text-[10px] bg-accent/30 text-dark dark:text-gray-100 px-1.5 py-0.5 rounded-sm font-medium">
                            {ui.admin.groups.defaultBadge}
                          </span>
                        )}
                      </div>
                      {group.description && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{group.description}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={closeGroupAssignmentModal}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              {a.skipGroupAssignment}
            </button>
            <button
              type="button"
              onClick={saveGroupAssignment}
              disabled={assigningGroups || (!hasPendingGroupAssignmentChanges && !groupAssignAllowNoChanges)}
              className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {assigningGroups ? t.saving : ui.admin.apps.addSelectedGroups}
            </button>
          </div>
        </div>
    </Modal>
  );
}
