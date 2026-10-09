import { X, Save } from 'lucide-react';
import Modal from '../../components/Modal';

export default function CreateGroupModal({
  showCreate,
  requestCloseActiveModal,
  groups,
  g,
  ui,
  newName,
  setNewName,
  handleCreate,
  newDesc,
  setNewDesc,
  t,
  setShowCreate,
  saving,
}) {
  return (
    <>
      {/* Create group modal */}
      {showCreate && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-1-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-6">
              <h2 id="groups-dialog-1-title" className="text-xl font-bold text-dark dark:text-gray-100">{g.newLocalGroup}</h2>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{g.groupNameLabel}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder={g.groupNameExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-accent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{g.groupDescriptionLabel}</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder={g.optional}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                {ui.common.cancel}
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <Save className="w-4 h-4" />
                {saving ? ui.common.saving : g.create}
              </button>
            </div>
        </Modal>
      )}
    </>
  );
}
