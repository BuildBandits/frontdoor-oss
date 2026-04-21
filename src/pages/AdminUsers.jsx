import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ShieldOff, UserCheck, UserX, ChevronDown, ChevronRight, Users, Trash2, Clock, X } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';
import PageNotice from '../components/PageNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';

export default function AdminUsers() {
  const { user: currentUser } = useAuthStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all'); // all | superadmin | admin | admin_readonly | user
  const [filterActive, setFilterActive] = useState('all'); // all | active | inactive
  const [expandedUser, setExpandedUser] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [showVisibleApps, setShowVisibleApps] = useState(false);

  useEffect(() => {
    if (!pageNotice) return undefined;
    const timer = setTimeout(() => setPageNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [pageNotice]);

  const showToast = (message, type = 'success') => setPageNotice({ message, type });
  const openConfirm = (dialog) => setConfirmDialog(dialog);
  const closeConfirm = () => {
    if (confirmBusy) return;
    setConfirmDialog(null);
  };
  const runConfirm = async () => {
    if (!confirmDialog?.onConfirm) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirmDialog(null);
    }
  };

  const loadUsers = useCallback(async () => {
    try {
      const res = await api.get('/users');
      setUsers(Array.isArray(res.data.users) ? res.data.users : []);
    } catch {
      showToast('Errore nel caricamento utenti', 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadUserDetail = async (userId) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/users/${userId}`);
      setUserDetail(res.data && typeof res.data === 'object' ? res.data : null);
    } catch {
      showToast('Errore nel caricamento dettaglio utente', 'error');
    }
    setDetailLoading(false);
  };

  const toggleExpand = async (userId) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      setUserDetail(null);
      setShowVisibleApps(false);
    } else {
      setExpandedUser(userId);
      setShowVisibleApps(false);
      await loadUserDetail(userId);
    }
  };

  const canEditUsers = currentUser?.role !== 'admin_readonly';
  const isComposeLockedAdmin = (user) => Boolean(user?.is_compose_locked_admin);
  const roleLabel = (role) => {
    if (role === 'superadmin') return 'superadmin';
    if (role === 'admin_readonly') return 'sola lettura';
    if (role === 'admin') return 'admin';
    return 'utente';
  };
  const roleBadgeClass = (role) => {
    if (role === 'superadmin') return 'bg-rose-100 text-rose-700';
    if (role === 'admin') return 'bg-amber-100 text-amber-700';
    if (role === 'admin_readonly') return 'bg-slate-100 text-slate-700';
    return 'bg-gray-100 text-gray-600';
  };
  const updateRole = async (user, newRole) => {
    const action = roleLabel(newRole);
    openConfirm({
      title: `Impostare il ruolo "${action}" per ${user.display_name || user.email}?`,
      message: newRole === 'user'
        ? 'L’utente tornerà a un profilo standard.'
        : newRole === 'admin_readonly'
          ? 'L’utente vedrà le pagine amministrative ma non potrà modificarle.'
          : 'L’utente otterrà i privilegi amministrativi della web app.',
      confirmLabel: 'Conferma',
      onConfirm: async () => {
        try {
          await api.put(`/users/${user.id}/role`, { role: newRole });
          showToast(`Ruolo impostato su ${action}`);
          await loadUsers();
          if (expandedUser === user.id) await loadUserDetail(user.id);
        } catch (err) {
          showToast(err.response?.data?.error || 'Errore nel cambio ruolo', 'error');
        }
      },
    });
  };

  const toggleActive = async (user) => {
    const newActive = !user.is_active;
    const action = newActive ? 'riattivare' : 'disattivare';
    openConfirm({
      title: `Vuoi ${action} ${user.display_name || user.email}?`,
      message: newActive
        ? 'L’utente tornerà attivo e potrà accedere nuovamente.'
        : 'L’utente verrà disattivato e non potrà più accedere.',
      confirmLabel: newActive ? 'Riattiva' : 'Disattiva',
      onConfirm: async () => {
        try {
          await api.put(`/users/${user.id}/active`, { is_active: newActive });
          showToast(newActive ? 'Utente riattivato' : 'Utente disattivato');
          await loadUsers();
          if (expandedUser === user.id) await loadUserDetail(user.id);
        } catch (err) {
          showToast(err.response?.data?.error || 'Errore', 'error');
        }
      },
    });
  };

  const deleteUser = async (user) => {
    const name = user.display_name || user.email;
    const visibleApps = userDetail?.visibleAppCount || 0;
    const message = visibleApps > 0
      ? `L’utente ${name} rende visibili ${visibleApps} app.\n\nEliminandolo perderai anche queste assegnazioni.`
      : 'Questa azione non è reversibile. Verranno rimossi anche tutti i log di accesso e le appartenenze ai gruppi.';
    openConfirm({
      title: `Eliminare definitivamente l'utente ${name}?`,
      message,
      confirmLabel: 'Elimina utente',
      onConfirm: async () => {
        try {
          await api.delete(`/users/${user.id}`);
          showToast('Utente eliminato definitivamente');
          setExpandedUser(null);
          setUserDetail(null);
          setShowVisibleApps(false);
          await loadUsers();
        } catch (err) {
          showToast(err.response?.data?.error || 'Errore nell\'eliminazione', 'error');
        }
      },
    });
  };

  // Filtering
  const filtered = users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterActive === 'active' && !u.is_active) return false;
    if (filterActive === 'inactive' && u.is_active) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (u.display_name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    }
    return true;
  });

  const groupLabel = (group) => group.entra_display_name || group.name;
  const localGroups = userDetail?.groups?.filter((g) => g.source !== 'entra') || [];
  const entraGroups = userDetail?.groups?.filter((g) => g.source === 'entra') || [];
  const detectedEntraGroups = userDetail?.entraGroups || [];
  const visibleApps = userDetail?.visibleApps || [];
  const formatDate = (iso) => {
    if (!iso) return 'Mai';
    try {
      return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const getRoleActions = (targetUser) => {
    if (!canEditUsers || isComposeLockedAdmin(targetUser)) return [];

    const actions = [];
    if (targetUser.role === 'user') {
      actions.push(
        {
          role: 'admin',
          label: 'Assegna ruolo Admin (accesso completo)',
          icon: Shield,
          className: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
          confirmText: 'L’utente potrà gestire app, gruppi e utenti.',
        },
        {
          role: 'admin_readonly',
          label: 'Assegna ruolo Admin (sola lettura)',
          icon: ShieldOff,
          className: 'bg-slate-50 text-slate-700 hover:bg-slate-100',
          confirmText: 'L’utente vedrà le pagine amministrative ma non potrà modificarle.',
        }
      );
    } else if (targetUser.role === 'admin_readonly') {
      actions.push(
        {
          role: 'admin',
          label: 'Assegna ruolo Admin (accesso completo)',
          icon: Shield,
          className: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
          confirmText: 'L’utente potrà gestire app, gruppi e utenti.',
        },
        {
          role: 'user',
          label: 'Rimuovi ruolo Admin',
          icon: ShieldOff,
          className: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
          confirmText: 'L’utente tornerà a un profilo standard.',
        }
      );
    } else if (targetUser.role === 'admin') {
      actions.push(
        {
          role: 'admin_readonly',
          label: 'Assegna ruolo Admin (sola lettura)',
          icon: ShieldOff,
          className: 'bg-slate-50 text-slate-700 hover:bg-slate-100',
          confirmText: 'L’utente perderà la possibilità di operare modifiche.',
        },
        {
          role: 'user',
          label: 'Rimuovi ruolo Admin',
          icon: ShieldOff,
          className: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
          confirmText: 'L’utente tornerà a un profilo standard.',
        }
      );
    } else if (targetUser.role === 'superadmin') {
      actions.push(
        {
          role: 'admin',
          label: 'Assegna ruolo Admin (accesso completo)',
          icon: ShieldOff,
          className: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
          confirmText: 'L’utente potrà gestire app, gruppi e utenti.',
        },
        {
          role: 'admin_readonly',
          label: 'Assegna ruolo Admin (sola lettura)',
          icon: ShieldOff,
          className: 'bg-slate-50 text-slate-700 hover:bg-slate-100',
          confirmText: 'L’utente perderà la possibilità di operare modifiche.',
        },
        {
          role: 'user',
          label: 'Rimuovi ruolo Admin',
          icon: ShieldOff,
          className: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
          confirmText: 'L’utente tornerà a un profilo standard.',
        }
      );
    }

    return actions;
  };

  const adminCount = users.filter((u) => ['superadmin', 'admin'].includes(u.role) && u.is_active).length;
  const activeCount = users.filter((u) => u.is_active).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">Gestione Utenti</h1>
          <p className="text-gray-500 mt-1">
            {users.length} utenti totali &middot; {activeCount} attivi &middot; {adminCount} con privilegi elevati
          </p>
        </div>
      </div>

      {!canEditUsers && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Modalità sola lettura: puoi consultare gli utenti, ma non modificarne ruolo o stato.
        </div>
      )}

      {pageNotice && (
        <div className="mb-6">
          <PageNotice
            type={pageNotice.type}
            message={pageNotice.message}
            onClose={() => setPageNotice(null)}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="flex-1 min-w-[200px]">
          <ClearableSearchField
            value={search}
            onChange={setSearch}
            placeholder="Cerca per nome o email..."
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">Tutti i ruoli</option>
          <option value="superadmin">Solo superadmin</option>
          <option value="admin">Solo admin</option>
          <option value="admin_readonly">Solo lettura</option>
          <option value="user">Solo utenti</option>
        </select>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">Tutti gli stati</option>
          <option value="active">Solo attivi</option>
          <option value="inactive">Solo disattivati</option>
        </select>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-gray-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Nessun utente trovato</p>
          {search && <p className="text-sm mt-1">Prova a cambiare i filtri di ricerca</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((user) => (
            <div key={user.id} className={`bg-white rounded-2xl border overflow-hidden transition-colors ${
              user.is_active ? 'border-gray-100' : 'border-red-100 bg-red-50/30'
            }`}>
              {/* User row */}
              <div
                className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-gray-50/50"
                onClick={() => toggleExpand(user.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedUser === user.id
                    ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                  <UserAvatar
                    userId={user.id}
                    displayName={user.display_name}
                    email={user.email}
                    avatarColor={user.avatar_color}
                    className={`w-9 h-9 ${!user.is_active ? 'opacity-40' : ''}`}
                    initialsClassName="text-xs"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-sm ${user.is_active ? 'text-dark' : 'text-gray-400 line-through'}`}>
                        {user.display_name || user.email}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${roleBadgeClass(user.role)}`}>
                        {roleLabel(user.role)}
                      </span>
                      {isComposeLockedAdmin(user) && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">compose</span>
                      )}
                      {!user.last_login && (
                        <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />mai loggato
                        </span>
                      )}
                      {!user.is_active && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">disattivato</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 hidden sm:block">
                    {user.group_count} gruppi
                  </span>
                  <span className="text-xs text-gray-400 hidden md:block">
                    Ultimo accesso: {formatDate(user.last_login)}
                  </span>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedUser === user.id && (
                <div className="border-t border-gray-100 px-5 py-5">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-dark rounded-full" />
                    </div>
                  ) : userDetail ? (
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.3fr)_minmax(0,0.88fr)] gap-6 lg:min-h-[460px]">
                      {/* Info */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Informazioni</h3>
                        <dl className="space-y-2 text-sm">
                          <div>
                            <dt className="text-gray-400">Email</dt>
                            <dd className="text-dark font-medium">{userDetail.user.email}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-400">Ruolo</dt>
                            <dd className="text-dark font-medium">{roleLabel(userDetail.user.role)}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-400">Stato</dt>
                            <dd className={userDetail.user.is_active ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                              {userDetail.user.is_active ? 'Attivo' : 'Disattivato'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-400">Registrato</dt>
                            <dd className="text-dark">{formatDate(userDetail.user.created_at)}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-400">Ultimo accesso</dt>
                            <dd className="text-dark">{formatDate(userDetail.user.last_login)}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-400">App visibili</dt>
                            <dd>
                              {userDetail.visibleAppCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setShowVisibleApps(true)}
                                  className="text-dark font-medium hover:text-accent-dark hover:underline"
                                >
                                  {userDetail.visibleAppCount}
                                </button>
                              ) : (
                                <span className="text-dark font-medium">0</span>
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      {/* Groups */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                          Gruppi Frontdoor ({userDetail.groups.length})
                        </h3>

                        <div className="space-y-5 h-full overflow-y-auto pr-1 lg:max-h-[390px]">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                              Gruppi locali ({localGroups.length})
                            </p>
                            <p className="mb-2 text-xs text-sky-600">
                              Sono gruppi creati e gestiti direttamente in Frontdoor, indipendenti dal tenant Entra.
                            </p>
                            {localGroups.length === 0 ? (
                              <p className="text-sm text-gray-300 italic">Nessun gruppo locale</p>
                            ) : (
                              <div className="space-y-1.5">
                                {localGroups.map((g) => (
                                  <div key={g.id} className="flex items-center gap-2 py-1">
                                    <Users className="w-3.5 h-3.5 text-gray-400" />
                                    <span className="text-sm text-dark">{g.name}</span>
                                    {g.description && (
                                      <span className="text-xs text-gray-400 truncate max-w-[150px]">{g.description}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                              Gruppi Frontdoor importati da Entra ({entraGroups.length})
                            </p>
                            <p className="mb-2 text-xs text-sky-600">
                              I gruppi Entra vengono rilevati al login o con Force Sync, poi importati manualmente da Gestione Gruppi.
                            </p>
                            {entraGroups.length === 0 ? (
                              <p className="text-sm text-gray-300 italic">Nessun gruppo Entra importato in Frontdoor</p>
                            ) : (
                              <div className="space-y-1.5">
                                {entraGroups.map((g) => (
                                  <div key={g.id} className="flex items-center gap-2 py-1">
                                    <Users className="w-3.5 h-3.5 text-gray-400" />
                                    <span className="text-sm text-dark">{groupLabel(g)}</span>
                                    <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">
                                      Entra
                                    </span>
                                    {g.description && (
                                      <span className="text-xs text-gray-400 truncate max-w-[150px]">{g.description}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                          Gruppi Entra rilevati ({detectedEntraGroups.length})
                        </h3>
                        <p className="mb-2 text-xs text-sky-600">
                          Questi gruppi vengono letti direttamente dal tenant Entra, anche se non sono ancora importati in Frontdoor.
                        </p>
                        {detectedEntraGroups.length === 0 ? (
                          <p className="text-sm text-gray-300 italic">Nessun gruppo Entra rilevato</p>
                        ) : (
                          <div className="space-y-1.5 h-full overflow-y-auto pr-1 lg:max-h-[390px]">
                            {detectedEntraGroups.map((group) => (
                              <button
                                key={group.entra_group_id}
                                type="button"
                                disabled={group.is_imported}
                                onClick={() => {
                                  if (group.is_imported) return;
                                  navigate('/admin/groups', {
                                    state: {
                                      openEntraImport: group.entra_group_id,
                                      entraSearch: group.display_name,
                                    },
                                  });
                                }}
                                className={`w-full flex items-center gap-2 py-1 text-left ${
                                  group.is_imported ? 'cursor-default opacity-80' : 'rounded-lg px-2 -mx-2 hover:bg-sky-50 transition-colors'
                                }`}
                              >
                                <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span className="text-sm text-dark">{group.display_name}</span>
                                {group.is_imported ? (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                                    Entra (importato)
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                    Entra (rilevato)
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Azioni</h3>
                        <div className="space-y-2 lg:sticky lg:top-4">
                          {!canEditUsers && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                              Ruolo attuale in sola lettura: le modifiche non sono consentite per questo account.
                            </div>
                          )}

                          {getRoleActions(user).map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                key={action.role}
                                onClick={() => updateRole(user, action.role)}
                                className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${action.className}`}
                              >
                                <Icon className="w-4 h-4" />
                                {action.label}
                              </button>
                            );
                          })}

                          <button
                            onClick={!canEditUsers || isComposeLockedAdmin(user) ? undefined : () => toggleActive(user)}
                            disabled={!canEditUsers || isComposeLockedAdmin(user)}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                              !canEditUsers || isComposeLockedAdmin(user)
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : user.is_active
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {!canEditUsers || isComposeLockedAdmin(user) ? (
                              <><UserX className="w-4 h-4" /> Disattivazione bloccata</>
                            ) : user.is_active ? (
                              <><UserX className="w-4 h-4" /> Disattiva utente</>
                            ) : (
                              <><UserCheck className="w-4 h-4" /> Riattiva utente</>
                            )}
                          </button>
                          <div className="border-t border-gray-100 pt-2 mt-1">
                            <button
                              onClick={!canEditUsers || isComposeLockedAdmin(user) ? undefined : () => deleteUser(user)}
                              disabled={!canEditUsers || isComposeLockedAdmin(user)}
                              className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                !canEditUsers || isComposeLockedAdmin(user)
                                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                  : 'bg-red-50 text-red-700 hover:bg-red-200'
                              }`}
                            >
                              <Trash2 className="w-4 h-4" /> {!canEditUsers || isComposeLockedAdmin(user) ? 'Eliminazione bloccata' : 'Elimina definitivamente'}
                            </button>
                            <p className="text-[11px] text-gray-400 mt-1 px-1">Rimuove utente, gruppi e log di accesso</p>
                            {isComposeLockedAdmin(user) && (
                              <p className="text-[11px] text-slate-400 mt-2 px-1">
                                Questo superadmin è definito in `ADMIN_EMAILS` nel compose: va prima rimosso da lì.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showVisibleApps && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowVisibleApps(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-dark">App visibili</h2>
                <p className="text-sm text-gray-500 mt-1">{visibleApps.length} applicazioni disponibili per questo utente</p>
              </div>
              <button onClick={() => setShowVisibleApps(false)} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {visibleApps.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">Nessuna app visibile</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleApps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => window.open(app.url, '_blank', 'noopener')}
                    className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left hover:border-accent hover:bg-accent/5 transition-colors"
                  >
                    <AppIcon app={app} className="w-8 h-8" textClassName="text-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-dark truncate">{app.name}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                          {app.mode}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">{app.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || 'Conferma'}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
