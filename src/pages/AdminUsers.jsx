import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldOff, UserCheck, UserX, ChevronDown, ChevronRight, Users, AlertCircle, Check, Search, Trash2, UserPlus, X, Clock } from 'lucide-react';
import api from '../services/api';

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
      type === 'error' ? 'bg-red-600 text-white' : 'bg-dark text-white'
    }`}>
      {type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
      {message}
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all'); // all | admin | user
  const [filterActive, setFilterActive] = useState('all'); // all | active | inactive
  const [expandedUser, setExpandedUser] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Invite user modal
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviteGroups, setInviteGroups] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [inviteSaving, setInviteSaving] = useState(false);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const loadUsers = useCallback(async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data.users);
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
      setUserDetail(res.data);
    } catch {
      showToast('Errore nel caricamento dettaglio utente', 'error');
    }
    setDetailLoading(false);
  };

  const toggleExpand = async (userId) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      setUserDetail(null);
    } else {
      setExpandedUser(userId);
      await loadUserDetail(userId);
    }
  };

  const toggleRole = async (user) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    const action = newRole === 'admin' ? 'promuovere ad admin' : 'rimuovere i privilegi admin di';
    if (!confirm(`Vuoi ${action} ${user.display_name || user.email}?`)) return;

    try {
      await api.put(`/users/${user.id}/role`, { role: newRole });
      showToast(newRole === 'admin' ? 'Utente promosso ad admin' : 'Privilegi admin rimossi');
      await loadUsers();
      if (expandedUser === user.id) await loadUserDetail(user.id);
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore nel cambio ruolo', 'error');
    }
  };

  const toggleActive = async (user) => {
    const newActive = !user.is_active;
    const action = newActive ? 'riattivare' : 'disattivare';
    if (!confirm(`Vuoi ${action} ${user.display_name || user.email}?`)) return;

    try {
      await api.put(`/users/${user.id}/active`, { is_active: newActive });
      showToast(newActive ? 'Utente riattivato' : 'Utente disattivato');
      await loadUsers();
      if (expandedUser === user.id) await loadUserDetail(user.id);
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
  };

  const deleteUser = async (user) => {
    const name = user.display_name || user.email;
    if (!confirm(`ATTENZIONE: Vuoi eliminare DEFINITIVAMENTE l'utente ${name}?\n\nQuesta azione non è reversibile. Verranno rimossi anche tutti i log di accesso e le appartenenze ai gruppi.`)) return;
    if (!confirm(`Conferma finale: eliminare ${name}?`)) return;

    try {
      await api.delete(`/users/${user.id}`);
      showToast('Utente eliminato definitivamente');
      setExpandedUser(null);
      setUserDetail(null);
      await loadUsers();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore nell\'eliminazione', 'error');
    }
  };

  // Invite user
  const openInvite = async () => {
    try {
      const res = await api.get('/groups');
      setAllGroups(res.data.groups);
    } catch {
      // groups not critical for opening modal
    }
    setInviteEmail('');
    setInviteRole('user');
    setInviteGroups([]);
    setShowInvite(true);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSaving(true);
    try {
      await api.post('/users', {
        email: inviteEmail.trim(),
        role: inviteRole,
        groupIds: inviteGroups,
      });
      setShowInvite(false);
      showToast('Utente pre-registrato con successo');
      await loadUsers();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore nella pre-registrazione', 'error');
    }
    setInviteSaving(false);
  };

  const toggleInviteGroup = (groupId) => {
    setInviteGroups((prev) =>
      prev.includes(groupId) ? prev.filter((g) => g !== groupId) : [...prev, groupId]
    );
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

  const initials = (name) =>
    (name || '?')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const formatDate = (iso) => {
    if (!iso) return 'Mai';
    try {
      return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const adminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;
  const activeCount = users.filter((u) => u.is_active).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">Gestione Utenti</h1>
          <p className="text-gray-500 mt-1">
            {users.length} utenti totali &middot; {activeCount} attivi &middot; {adminCount} admin
          </p>
        </div>
        <button
          onClick={openInvite}
          className="flex items-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Invita Utente
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome o email..."
            className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">Tutti i ruoli</option>
          <option value="admin">Solo admin</option>
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
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                      !user.is_active ? 'opacity-40' : ''
                    }`}
                    style={{ backgroundColor: user.avatar_color || '#666' }}
                  >
                    {initials(user.display_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-sm ${user.is_active ? 'text-dark' : 'text-gray-400 line-through'}`}>
                        {user.display_name || user.email}
                      </span>
                      {user.role === 'admin' && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">admin</span>
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
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                            <dd className="text-dark font-medium capitalize">{userDetail.user.role}</dd>
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
                            <dd className="text-dark font-medium">{userDetail.visibleAppCount}</dd>
                          </div>
                        </dl>
                      </div>

                      {/* Groups */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                          Gruppi ({userDetail.groups.length})
                        </h3>
                        {userDetail.groups.length === 0 ? (
                          <p className="text-sm text-gray-300 italic">Nessun gruppo</p>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {userDetail.groups.map((g) => (
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

                      {/* Actions */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Azioni</h3>
                        <div className="space-y-2">
                          <button
                            onClick={() => toggleRole(user)}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                              user.role === 'admin'
                                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                            }`}
                          >
                            {user.role === 'admin' ? (
                              <><ShieldOff className="w-4 h-4" /> Rimuovi admin</>
                            ) : (
                              <><Shield className="w-4 h-4" /> Promuovi ad admin</>
                            )}
                          </button>
                          <button
                            onClick={() => toggleActive(user)}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                              user.is_active
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {user.is_active ? (
                              <><UserX className="w-4 h-4" /> Disattiva utente</>
                            ) : (
                              <><UserCheck className="w-4 h-4" /> Riattiva utente</>
                            )}
                          </button>
                          <div className="border-t border-gray-100 pt-2 mt-1">
                            <button
                              onClick={() => deleteUser(user)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-50 text-red-700 hover:bg-red-200 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" /> Elimina definitivamente
                            </button>
                            <p className="text-[11px] text-gray-400 mt-1 px-1">Rimuove utente, gruppi e log di accesso</p>
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

      {/* Invite user modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowInvite(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-dark">Invita Utente</h2>
              <button onClick={() => setShowInvite(false)} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  placeholder="utente@azienda.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Ruolo</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="user">Utente</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Gruppi</label>
                {allGroups.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">Nessun gruppo disponibile</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 rounded-xl p-2">
                    {allGroups.map((g) => (
                      <label key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteGroups.includes(g.id)}
                          onChange={() => toggleInviteGroup(g.id)}
                          className="rounded border-gray-300 text-dark focus:ring-accent"
                        />
                        <span className="text-sm text-dark">{g.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{g.member_count} membri</span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">L'utente vedrà solo le app dei gruppi selezionati</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
              <button onClick={() => setShowInvite(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-dark hover:bg-gray-100 rounded-xl transition-colors">
                Annulla
              </button>
              <button
                onClick={handleInvite}
                disabled={inviteSaving || !inviteEmail.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <UserPlus className="w-4 h-4" />
                {inviteSaving ? 'Invio...' : 'Invita'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
