import { X } from 'lucide-react';
import UserAvatar from '../../components/UserAvatar';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';

export default function AddMembersModal({
  showAddMembers,
  requestCloseActiveModal,
  groups,
  g,
  ui,
  memberSearch,
  setMemberSearch,
  filteredUsers,
  addMember,
}) {
  return (
    <>
      {/* Add members modal */}
      {showAddMembers && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-3-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <h2 id="groups-dialog-3-title" className="text-lg font-bold text-dark dark:text-gray-100">{g.addMembersTitle}</h2>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{g.memberExisting}</p>
            <ClearableSearchField
              value={memberSearch}
              onChange={setMemberSearch}
              placeholder={g.memberSearchPlaceholder}
              className="mb-3"
              clearLabel={ui.common.clearSearch}
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredUsers.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{g.noUsersAvailable}</p>
              ) : (
                filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => addMember(u.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
                  >
                    <UserAvatar
                      userId={u.id}
                      displayName={u.display_name}
                      email={u.email}
                      avatarColor={u.avatar_color}
                      className="w-7 h-7"
                      initialsClassName="text-[10px]"
                    />
                    <div>
                      <div className="text-sm font-medium text-dark dark:text-gray-100">{u.display_name || u.email}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{u.email}</div>
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
