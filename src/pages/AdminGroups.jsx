import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Save, Users, ChevronDown, ChevronRight, AppWindow, Pencil, AlertCircle, Check, Clock, Mail } from 'lucide-react';
import api from '../services/api';

const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';

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

export default function AdminGroups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [groupDetail, setGroupDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Create group modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit group inline
  const [editingGroup, setEditingGroup] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // Add members modal
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');

  // Add member by email
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitingEmail, setInvitingEmail] = useState(false);

  // Add apps modal
  const [showAddApps, setShowAddApps] = useState(false);
  const [allApps, setAllApps] = useState([]);
  const [appSearch, setAppSearch] = useState('');

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.get('/groups');
      setGroups(res.data.groups);
    } catch {
      showToast('Errore nel caricamento gruppi', 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadGroupDetail = async (groupId) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/groups/${groupId}`);
      setGroupDetail(res.data);
    } catch {
      showToast('Errore nel caricamento dettaglio gruppo', 'error');
    }
    setDetailLoading(false);
  };

  const toggleExpand = async (groupId) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null);
      setGroupDetail(null);
      setEditingGroup(null);
    } else {
      setExpandedGroup(groupId);
      setEditingGroup(null);
      await loadGroupDetail(groupId);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.post('/groups', { name: newName.trim(), description: newDesc.trim() });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      showToast('Gruppo creato');
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore nella creazione', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (group) => {
    if (!confirm(`Eliminare il gruppo "${group.name}"? I membri non saranno eliminati, ma perderanno la visibilità delle app assegnate solo a questo gruppo.`)) return;
    try {
      await api.delete(`/groups/${group.id}`);
      if (expandedGroup === group.id) {
        setExpandedGroup(null);
        setGroupDetail(null);
      }
      showToast(`Gruppo "${group.name}" eliminato`);
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
  };

  // --- Edit group ---
  const startEdit = (group) => {
    setEditingGroup(group.id);
    setEditName(groupDetail?.group?.name || group.name);
    setEditDesc(groupDetail?.group?.description || group.description || '');
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    try {
      await api.put(`/groups/${editingGroup}`, { name: editName.trim(), description: editDesc.trim() });
      setEditingGroup(null);
      showToast('Gruppo aggiornato');
      await loadGroups();
      if (expandedGroup === editingGroup) await loadGroupDetail(editingGroup);
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore nel salvataggio', 'error');
    }
  };

  // --- Members ---
  const openAddMembers = async () => {
    try {
      const res = await api.get('/users');
      setAllUsers(res.data.users);
      setMemberSearch('');
      setInviteEmail('');
      setShowAddMembers(true);
    } catch {
      showToast('Errore nel caricamento utenti', 'error');
    }
  };

  const addMember = async (userId) => {
    try {
      await api.post(`/groups/${expandedGroup}/members`, { userIds: [userId] });
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
  };

  const addMemberByEmail = async () => {
    if (!inviteEmail.trim()) return;
    setInvitingEmail(true);
    try {
      await api.post(`/groups/${expandedGroup}/members`, { emails: [inviteEmail.trim()] });
      setInviteEmail('');
      showToast('Membro aggiunto');
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
    setInvitingEmail(false);
  };

  const removeMember = async (userId, displayName) => {
    if (!confirm(`Rimuovere ${displayName || 'questo utente'} dal gruppo?`)) return;
    try {
      await api.delete(`/groups/${expandedGroup}/members/${userId}`);
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
  };

  // --- Apps ---
  const openAddApps = async () => {
    try {
      const res = await api.get('/apps/all');
      setAllApps(res.data.apps);
      setAppSearch('');
      setShowAddApps(true);
    } catch {
      showToast('Errore nel caricamento app', 'error');
    }
  };

  const addApp = async (appId) => {
    try {
      await api.post(`/groups/${expandedGroup}/apps`, { appIds: [appId] });
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
  };

  const removeApp = async (appId, appName) => {
    if (!confirm(`Rimuovere "${appName || 'questa app'}" dal gruppo?`)) return;
    try {
      await api.delete(`/groups/${expandedGroup}/apps/${appId}`);
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Errore', 'error');
    }
  };

  // Filter for add-members modal: exclude already-in-group
  const currentMemberIds = new Set((groupDetail?.members || []).map((m) => m.id));
  const filteredUsers = allUsers.filter((u) => {
    if (currentMemberIds.has(u.id)) return false;
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return u.display_name?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  // Filter for add-apps modal: exclude already-assigned
  const currentAppIds = new Set((groupDetail?.apps || []).map((a) => a.id));
  const filteredApps = allApps.filter((a) => {
    if (currentAppIds.has(a.id)) return false;
    if (!appSearch.trim()) return true;
    return a.name.toLowerCase().includes(appSearch.toLowerCase());
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">Gestione Gruppi</h1>
          <p className="text-gray-500 mt-1">Gestisci gruppi utente e visibilit&agrave; app per gruppo</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuovo Gruppo
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-gray-100" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Nessun gruppo</p>
          <p className="text-sm mt-1">Crea il primo gruppo per gestire la visibilit&agrave; delle app</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* Group row */}
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50/50"
                onClick={() => toggleExpand(group.id)}
              >
                <div className="flex items-center gap-4">
                  {expandedGroup === group.id
                    ? <ChevronDown className="w-4 h-4 text-gray-400" />
                    : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-dark">{group.name}</span>
                      {group.id === DEFAULT_GROUP_ID && (
                        <span className="text-xs bg-accent/30 text-dark px-2 py-0.5 rounded-full font-medium">default</span>
                      )}
                    </div>
                    {group.description && <p className="text-sm text-gray-500 mt-0.5">{group.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-sm text-gray-500">
                    <Users className="w-4 h-4" /> {group.member_count}
                  </span>
                  <span className="flex items-center gap-1 text-sm text-gray-500">
                    <AppWindow className="w-4 h-4" /> {group.app_count}
                  </span>
                  {group.id !== DEFAULT_GROUP_ID && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(group); }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Elimina gruppo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedGroup === group.id && (
                <div className="border-t border-gray-100 px-6 py-5">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-dark rounded-full" />
                    </div>
                  ) : groupDetail ? (
                    <>
                      {/* Edit group info */}
                      <div className="mb-5 pb-5 border-b border-gray-100">
                        {editingGroup === group.id ? (
                          <div className="flex flex-col sm:flex-row gap-3">
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 mb-1">Nome</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                disabled={group.id === DEFAULT_GROUP_ID}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 mb-1">Descrizione</label>
                              <input
                                type="text"
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <button onClick={saveEdit} className="px-3 py-2 bg-dark text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                                <Save className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingGroup(null)} className="px-3 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm text-gray-500">
                                {groupDetail.group?.description || <span className="italic text-gray-300">Nessuna descrizione</span>}
                              </span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEdit(group); }}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-dark transition-colors"
                            >
                              <Pencil className="w-3 h-3" />
                              Modifica
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Members */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                              Membri ({groupDetail.members.length})
                            </h3>
                            <button
                              onClick={openAddMembers}
                              className="text-xs font-medium text-accent hover:underline"
                            >
                              + Aggiungi
                            </button>
                          </div>
                          {groupDetail.members.length === 0 ? (
                            <div className="text-center py-6 text-gray-300">
                              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                              <p className="text-sm">Nessun membro</p>
                              <p className="text-xs mt-1">Clicca "+ Aggiungi" per assegnare utenti</p>
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {groupDetail.members.map((m) => (
                                <div key={m.id} className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                      style={{ backgroundColor: m.avatar_color || '#666' }}
                                    >
                                      {(m.display_name || '?').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                                    </div>
                                    <div>
                                      <span className="text-sm text-dark">{m.display_name || m.email}</span>
                                      {m.role === 'admin' && (
                                        <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">admin</span>
                                      )}
                                      {!m.last_login && (
                                        <span className="ml-1.5 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5">
                                          <Clock className="w-3 h-3" />mai loggato
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => removeMember(m.id, m.display_name)}
                                    className="text-gray-300 hover:text-red-500 transition-colors"
                                    title="Rimuovi dal gruppo"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Apps */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                              App visibili ({groupDetail.apps.length})
                            </h3>
                            <button
                              onClick={openAddApps}
                              className="text-xs font-medium text-accent hover:underline"
                            >
                              + Aggiungi
                            </button>
                          </div>
                          {groupDetail.apps.length === 0 ? (
                            <div className="text-center py-6 text-gray-300">
                              <AppWindow className="w-8 h-8 mx-auto mb-2 opacity-40" />
                              <p className="text-sm">Nessuna app assegnata</p>
                              <p className="text-xs mt-1">Clicca "+ Aggiungi" per assegnare app</p>
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {groupDetail.apps.map((a) => (
                                <div key={a.id} className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{a.icon}</span>
                                    <span className="text-sm text-dark">{a.name}</span>
                                  </div>
                                  <button
                                    onClick={() => removeApp(a.id, a.name)}
                                    className="text-gray-300 hover:text-red-500 transition-colors"
                                    title="Rimuovi dal gruppo"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create group modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-dark">Nuovo Gruppo</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Nome</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="es. Design Team"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Descrizione</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Opzionale"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-dark hover:bg-gray-100 rounded-xl transition-colors">
                Annulla
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Creazione...' : 'Crea'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add members modal */}
      {showAddMembers && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowAddMembers(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-dark">Aggiungi Membri</h2>
              <button onClick={() => setShowAddMembers(false)} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Invite by email */}
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addMemberByEmail()}
                  placeholder="Invita per email..."
                  className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  autoFocus
                />
              </div>
              <button
                onClick={addMemberByEmail}
                disabled={invitingEmail || !inviteEmail.trim()}
                className="px-4 py-2.5 bg-dark text-white rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors"
              >
                {invitingEmail ? '...' : 'Invita'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3 -mt-2">Crea l'utente se non esiste ancora e lo aggiunge al gruppo</p>

            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Oppure seleziona utente esistente</p>
            </div>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Cerca utente..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredUsers.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nessun utente disponibile</p>
              ) : (
                filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => addMember(u.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: u.avatar_color || '#666' }}
                    >
                      {(u.display_name || '?').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-dark">{u.display_name || u.email}</div>
                      <div className="text-xs text-gray-400">{u.email}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add apps modal */}
      {showAddApps && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowAddApps(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-dark">Aggiungi App</h2>
              <button onClick={() => setShowAddApps(false)} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={appSearch}
              onChange={(e) => setAppSearch(e.target.value)}
              placeholder="Cerca app..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredApps.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nessuna app disponibile</p>
              ) : (
                filteredApps.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => addApp(a.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors"
                  >
                    <span className="text-lg">{a.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-dark">{a.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{a.slug}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
