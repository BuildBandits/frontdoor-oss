import { useEffect, useMemo, useState } from 'react';
import { Check, UserPlus, X } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';
import { useLatestRequest } from '../../hooks/useLatestRequest';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatMessage } from '../../i18n';
import { DEFAULT_GROUP_ID } from '../../../shared/groups.js';

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DELAY_MS = 300;
const MAX_USERS = 50;

const badgeClass = 'text-[10px] px-1.5 py-0.5 rounded-sm font-medium';

// Pick one or more users from the Entra tenant and create their accounts before
// the first sign-in, optionally in some local groups (the default group is always added).
export default function PreonboardUserModal({ onClose, onCompleted, ui }) {
  const p = ui.admin.users.preonboard;
  const [step, setStep] = useState('pick'); // pick | groups | done
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupIds, setGroupIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [outcome, setOutcome] = useState([]);
  const { begin: beginSearch, cancel: cancelSearch } = useLatestRequest();

  useEffect(() => {
    let cancelled = false;
    api.get('/groups')
      .then((res) => {
        if (cancelled) return;
        const localGroups = (res.data.groups || []).filter((group) => group.source !== 'entra' && group.id !== DEFAULT_GROUP_ID);
        setGroups(localGroups);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const term = query.trim();
  useEffect(() => {
    if (term.length < SEARCH_MIN_LENGTH) {
      cancelSearch();
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const isLatest = beginSearch();
      setSearching(true);
      setSearchError(null);
      try {
        const res = await api.get('/users/directory/search', { params: { q: term } });
        if (isLatest()) setResults(Array.isArray(res.data.users) ? res.data.users : []);
      } catch (err) {
        if (!isLatest()) return;
        setResults([]);
        setSearchError({ message: apiErrorMessage(err, ui, p.searchFailed), hint: err?.response?.data?.hint || null });
      } finally {
        if (isLatest()) setSearching(false);
      }
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term, beginSearch, cancelSearch, ui, p.searchFailed]);

  const visibleGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) => group.name.toLowerCase().includes(q) || (group.description || '').toLowerCase().includes(q));
  }, [groups, groupSearch]);

  const selectedIds = new Set(selectedUsers.map((user) => user.id));
  const toggleUser = (entraUser) => {
    setSelectedUsers((prev) => (prev.some((user) => user.id === entraUser.id)
      ? prev.filter((user) => user.id !== entraUser.id)
      : prev.length >= MAX_USERS ? prev : [...prev, entraUser]));
  };
  const removeUser = (userId) => setSelectedUsers((prev) => prev.filter((user) => user.id !== userId));

  const toggleGroup = (groupId) => {
    setGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  };

  const save = async () => {
    if (selectedUsers.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post('/users/preonboard', { microsoftIds: selectedUsers.map((user) => user.id), groupIds });
      const byId = new Map((res.data.results || []).map((result) => [result.microsoftId, result]));
      const rows = selectedUsers.map((user) => ({ user, result: byId.get(user.id) || { status: 'failed' } }));
      setOutcome(rows);
      setStep('done');
      onCompleted(rows.filter((row) => row.result.status === 'created').length);
    } catch (err) {
      setSaveError(apiErrorMessage(err, ui, p.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  const selectedChips = (
    <ul className="flex flex-wrap gap-2" aria-label={p.selectedUsers}>
      {selectedUsers.map((user) => (
        <li key={user.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent bg-accent/5 py-1 pl-3 pr-1 text-xs text-dark dark:text-gray-100">
          <span className="truncate">{user.displayName}</span>
          <button
            type="button"
            onClick={() => removeUser(user.id)}
            aria-label={formatMessage(p.removeUser, { name: user.displayName })}
            className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-dark dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );

  const disabledCount = selectedUsers.filter((user) => !user.accountEnabled).length;
  const createdCount = outcome.filter((row) => row.result.status === 'created').length;

  return (
    <Modal onClose={onClose} closeOnEscape={false} closeOnBackdrop={false} labelledBy="users-preonboard-title" panelClassName="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800" overlayClassName="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 py-4">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        aria-label={ui.common.close}
      >
        <X className="w-4 h-4" />
      </button>

      <div className="p-6 sm:p-8">
        <h2 id="users-preonboard-title" className="text-2xl font-extrabold text-dark dark:text-gray-100">{p.title}</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1 mb-6">{p.help}</p>

        {step === 'pick' && (
          <>
            {selectedUsers.length > 0 && <div className="mb-3">{selectedChips}</div>}
            <ClearableSearchField
              value={query}
              onChange={setQuery}
              placeholder={p.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              autoFocus
            />
            <div className="mt-3 min-h-[8rem]" aria-live="polite">
              {term.length < SEARCH_MIN_LENGTH ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{p.searchHint}</p>
              ) : searching ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{p.searching}</p>
              ) : searchError ? (
                <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  <p>{searchError.message}</p>
                  {searchError.hint && <p className="mt-1 text-xs">{searchError.hint}</p>}
                </div>
              ) : results.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{p.noResults}</p>
              ) : (
                <ul className="space-y-2">
                  {results.map((entraUser) => {
                    const exists = Boolean(entraUser.frontdoorUserId);
                    const picked = selectedIds.has(entraUser.id);
                    return (
                      <li key={entraUser.id}>
                        <button
                          type="button"
                          onClick={() => toggleUser(entraUser)}
                          disabled={exists || (!picked && selectedUsers.length >= MAX_USERS)}
                          aria-pressed={picked}
                          className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            picked ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            {picked && <Check className="h-4 w-4 text-accent-dark" aria-hidden="true" />}
                            <span className="text-sm font-medium text-dark dark:text-gray-100">{entraUser.displayName}</span>
                            {picked && (
                              <span className={`${badgeClass} bg-accent/20 text-dark dark:text-gray-100`}>{p.added}</span>
                            )}
                            {exists && (
                              <span className={`${badgeClass} bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300`}>{p.alreadyInFrontdoor}</span>
                            )}
                            {!entraUser.accountEnabled && (
                              <span className={`${badgeClass} bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300`}>{p.disabledInEntra}</span>
                            )}
                            {entraUser.userType === 'Guest' && (
                              <span className={`${badgeClass} bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300`}>{p.guest}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{entraUser.email}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedUsers.length >= MAX_USERS && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{formatMessage(p.maxUsers, { max: MAX_USERS })}</p>
              )}
            </div>
          </>
        )}

        {step === 'groups' && (
          <>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-dark dark:text-gray-100">{formatMessage(p.selectedSummary, { count: selectedUsers.length })}</h3>
              <button
                type="button"
                onClick={() => { setStep('pick'); setSaveError(null); }}
                className="text-xs font-medium text-accent-dark hover:underline shrink-0"
              >
                {p.changeUsers}
              </button>
            </div>
            {selectedChips}
            {disabledCount > 0 && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{p.disabledInEntraHelp}</p>
            )}

            <h3 className="mt-6 text-sm font-semibold text-dark dark:text-gray-100">{p.groupsTitle}</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">{p.groupsHelp}</p>
            {groups.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">{p.noLocalGroups}</p>
            ) : (
              <>
                <ClearableSearchField
                  value={groupSearch}
                  onChange={setGroupSearch}
                  placeholder={p.groupSearchPlaceholder}
                  clearLabel={ui.common.clearSearch}
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-2 max-h-[36vh] overflow-y-auto pr-1">
                  {visibleGroups.map((group) => {
                    const selected = groupIds.includes(group.id);
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
                          onChange={() => toggleGroup(group.id)}
                          className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-dark dark:text-gray-100 truncate block">{group.name}</span>
                          {group.description && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{group.description}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {step === 'done' && (
          <>
            <p className="mb-3 text-sm font-semibold text-dark dark:text-gray-100">
              {formatMessage(p.doneSummary, { created: createdCount, total: outcome.length })}
            </p>
            <ul className="space-y-2" aria-live="polite">
              {outcome.map(({ user, result }) => (
                <li key={user.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-dark dark:text-gray-100 truncate">{user.displayName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user.email}</p>
                  </div>
                  {result.status === 'created' ? (
                    <span className={`${badgeClass} shrink-0 bg-accent/20 text-dark dark:text-gray-100`}>{p.statusCreated}</span>
                  ) : (
                    <span className={`${badgeClass} shrink-0 bg-red-50 text-red-700 dark:bg-red-950/45 dark:text-red-300`}>
                      {apiErrorMessage({ code: result.code }, ui, p.saveFailed)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {saveError && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">{saveError}</p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
          {step === 'done' ? (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
            >
              {ui.common.close}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {ui.common.cancel}
              </button>
              {step === 'pick' ? (
                <button
                  type="button"
                  onClick={() => setStep('groups')}
                  disabled={selectedUsers.length === 0}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {formatMessage(p.continue, { count: selectedUsers.length })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={save}
                  disabled={selectedUsers.length === 0 || saving}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <UserPlus className="w-4 h-4" />
                  {saving ? p.saving : (groupIds.length === 0 ? p.submitWithoutGroups : p.submit)}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
