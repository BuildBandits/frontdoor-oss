import { X } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';

export default function AddAppsModal({
  showAddApps,
  requestCloseActiveModal,
  groups,
  g,
  ui,
  appSearch,
  setAppSearch,
  filteredApps,
  addApp,
}) {
  return (
    <>
      {/* Add apps modal */}
      {showAddApps && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-5-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <h2 id="groups-dialog-5-title" className="text-lg font-bold text-dark dark:text-gray-100">{g.addAppTitle}</h2>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ClearableSearchField
              value={appSearch}
              onChange={setAppSearch}
              placeholder={g.searchAppsPlaceholder}
              className="mb-3"
              clearLabel={ui.common.clearSearch}
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredApps.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{g.noAppsAvailable}</p>
              ) : (
                filteredApps.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => addApp(a.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
                  >
                    <AppIcon app={a} className="w-6 h-6" textClassName="text-lg" />
                    <div>
                      <div className="text-sm font-medium text-dark dark:text-gray-100">{a.name}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{a.slug}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
        </Modal>
      )}
    </>
  );
}
