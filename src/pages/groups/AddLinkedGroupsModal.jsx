import { Plus, X } from 'lucide-react';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';

export default function AddLinkedGroupsModal({
  groups,
  showAddGroups,
  requestCloseActiveModal,
  g,
  ui,
  groupLinkSearch,
  setGroupLinkSearch,
  filteredLinkableGroups,
  filteredLinkableEntraGroups,
  selectedLinkedGroupIds,
  selectedLinkedEntraGroupIds,
  hasGroupLinkSearch,
  selectVisibleLinkedGroups,
  selectVisibleLinkedEntraGroups,
  toggleLinkedGroupSelection,
  groupLabel,
  toggleLinkedEntraGroupSelection,
  t,
  closeCurrentModal,
  addLinkedGroups,
}) {
  return (
    <>
      {/* Add linked groups modal */}
      {showAddGroups && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-4-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="groups-dialog-4-title" className="text-lg font-bold text-dark dark:text-gray-100">{g.addLinkedGroupsTitle}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{g.linkedGroupsHelp}</p>
              </div>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ClearableSearchField
              value={groupLinkSearch}
              onChange={setGroupLinkSearch}
              placeholder={g.linkedGroupsSearchPlaceholder}
              className="mb-3"
              clearLabel={ui.common.clearSearch}
            />
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
              <span>
                {g.groupsFound.replace('{count}', filteredLinkableGroups.length + filteredLinkableEntraGroups.length)} · {g.selectedCount.replace('{count}', selectedLinkedGroupIds.length + selectedLinkedEntraGroupIds.length)}
              </span>
              {hasGroupLinkSearch && (
                <button
                  onClick={() => {
                    selectVisibleLinkedGroups();
                    selectVisibleLinkedEntraGroups();
                  }}
                  className="font-medium text-accent-dark hover:underline"
                >
                  {g.selectAllFiltered}
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredLinkableGroups.length === 0 && filteredLinkableEntraGroups.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{g.noGroupsAvailable}</p>
              ) : (
                <>
                  {filteredLinkableGroups.length > 0 && (
                    <div className="space-y-1">
                      {filteredLinkableGroups.map((group) => (
                        <label
                          key={group.id}
                          className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedLinkedGroupIds.includes(group.id)}
                            onChange={() => toggleLinkedGroupSelection(group.id)}
                            className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{groupLabel(group)}</span>
                              {group.source === 'entra' && (
                                <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{group.id}</div>
                            {group.description && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{group.description}</div>}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  {filteredLinkableEntraGroups.length > 0 && (
                    <div className="pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        {g.linkedEntraGroups}
                      </div>
                      <div className="space-y-1">
                        {filteredLinkableEntraGroups.map((group) => (
                          <label
                            key={group.entra_group_id}
                            className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedLinkedEntraGroupIds.includes(group.entra_group_id)}
                              onChange={() => toggleLinkedEntraGroupSelection(group.entra_group_id)}
                              className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{group.display_name || group.entra_group_id}</span>
                                <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                              </div>
                              <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{group.entra_group_id}</div>
                              {group.description && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{group.description}</div>}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={closeCurrentModal}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {ui.common.cancel}
              </button>
              <button
                onClick={addLinkedGroups}
                disabled={selectedLinkedGroupIds.length === 0 && selectedLinkedEntraGroupIds.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                {g.addLinkedGroupsConfirm}
              </button>
            </div>
        </Modal>
      )}
    </>
  );
}
