import { Plus, X, Users } from 'lucide-react';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';
import SegmentedControl from '../../components/SegmentedControl';
import { useSelectionFilter } from '../../hooks/useSelectionFilter';
import { SELECTION_FILTERS } from '../../utils/selectionFilter.js';

export default function EntraImportModal(props) {
  if (!props.showEntraImport) return null;
  return <EntraImportDialog {...props} />;
}

function EntraImportDialog({
  requestCloseActiveModal,
  groups,
  g,
  t,
  ui,
  entraSearch,
  setEntraSearch,
  filteredEntraCandidates,
  selectedEntraGroups,
  hasEntraSearch,
  selectVisibleEntraGroups,
  entraCandidatesLoading,
  toggleEntraGroupSelection,
  setShowEntraImport,
  handleImportEntraGroups,
  importingEntra,
}) {
  const selectionFilter = useSelectionFilter(selectedEntraGroups);
  const visibleCandidates = selectionFilter.apply(filteredEntraCandidates, (group) => group.entra_group_id);
  const selectionLabels = { all: g.selectionAll, selected: g.selectionSelected, unselected: g.selectionUnselected };

  return (
    <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-2-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-2xl shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 id="groups-dialog-2-title" className="text-xl font-bold text-dark dark:text-gray-100">{g.newEntraGroup}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t.entraHelp}
            </p>
          </div>
          <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <ClearableSearchField
              value={entraSearch}
              onChange={setEntraSearch}
              placeholder={g.searchEntraPlaceholder}
              clearLabel={ui.common.clearSearch}
              autoFocus
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <SegmentedControl
              label={g.selectionFilterLabel}
              value={selectionFilter.filter}
              onChange={selectionFilter.setFilter}
              options={SELECTION_FILTERS.map((value) => ({ value, label: selectionLabels[value] }))}
            />
            <span className="flex items-center gap-1">
              {g.groupsFound.replace('{count}', visibleCandidates.length)} ·
              <button
                type="button"
                onClick={() => selectionFilter.setFilter('selected')}
                disabled={selectedEntraGroups.length === 0}
                title={g.showSelectedGroups}
                className="hover:text-dark dark:hover:text-white hover:underline disabled:no-underline disabled:hover:text-gray-500 dark:disabled:hover:text-gray-400"
              >
                {g.selectedCount.replace('{count}', selectedEntraGroups.length)}
              </button>
            </span>
          </div>
          {hasEntraSearch && selectionFilter.filter !== 'selected' && (
            <div className="flex justify-end text-xs">
              <button
                type="button"
                onClick={() => selectVisibleEntraGroups(visibleCandidates)}
                className="font-medium text-accent-dark hover:underline"
              >
                {g.selectAllFiltered}
              </button>
            </div>
          )}

          {entraCandidatesLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-dark rounded-full" />
            </div>
          ) : visibleCandidates.length === 0 && selectionFilter.filter === 'selected' ? (
            <div className="text-center py-10 text-sm text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
              {g.noSelectedGroups}
            </div>
          ) : visibleCandidates.length === 0 ? (
            <div className="text-center py-10 text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">{g.noEntraGroupsDetected}</p>
              <p className="text-xs mt-1">{g.noEntraGroupsHelp}</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2 border border-gray-100 dark:border-gray-800 rounded-xl p-2">
              {visibleCandidates.map((group) => {
                const selected = selectedEntraGroups.includes(group.entra_group_id);
                return (
                  <label
                    key={group.entra_group_id}
                    className={`flex items-start gap-3 px-3 py-3 rounded-lg border transition-colors ${
                      group.is_imported ? 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 opacity-70' : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected || group.is_imported}
                      disabled={group.is_imported}
                      onChange={() => toggleEntraGroupSelection(group.entra_group_id)}
                      className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{group.display_name}</span>
                        <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                        {group.is_imported ? (
                          <span className="text-[10px] bg-accent/10 text-accent-dark px-1.5 py-0.5 rounded-sm font-medium">{g.alreadyImported}</span>
                        ) : (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-amber-950/40 dark:text-amber-300">{g.onlyEntraDetected}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{group.entra_group_id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {g.knownMembersInCatalog.replace('{count}', group.synced_member_count)} · {group.local_name ? g.localNamePrefix.replace('{name}', group.local_name) : g.notYetImported}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setShowEntraImport(false)}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            {ui.common.cancel}
          </button>
            <button
              onClick={handleImportEntraGroups}
              disabled={importingEntra || selectedEntraGroups.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              {importingEntra ? g.importing : g.importSelected}
            </button>
        </div>
    </Modal>
  );
}
