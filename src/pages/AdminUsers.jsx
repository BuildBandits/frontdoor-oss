import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Shield, ShieldOff, UserCheck, UserX, ChevronDown, ChevronRight, Users, Trash2, Clock, X, Info, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';
import PageNotice from '../components/PageNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

export default function AdminUsers() {
  const { user: currentUser } = useAuthStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all'); // all | owner | admin | admin_readonly | user
  const [filterActive, setFilterActive] = useState('all'); // all | active | inactive
  const [expandedUser, setExpandedUser] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [showVisibleApps, setShowVisibleApps] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [brandingLanguage, setBrandingLanguage] = useState('en');

  useEffect(() => {
    if (!pageNotice) return undefined;
    const timer = setTimeout(() => setPageNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [pageNotice]);

  useEffect(() => {
    if (!showVisibleApps) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowVisibleApps(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showVisibleApps]);

  const showToast = useCallback((message, type = 'success') => setPageNotice({ message, type }), []);
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

  const ui = getUiStrings(resolveAppLanguage(currentUser?.preferredLanguage, brandingLanguage));
  const t = ui.admin.common;
  const u = ui.admin.users;

  const loadUsers = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const res = await api.get('/users');
      setUsers(Array.isArray(res.data.users) ? res.data.users : []);
    } catch {
      showToast(t.errorLoadingUsers, 'error');
    }
    if (showLoading) {
      setLoading(false);
    } else {
      setRefreshing(false);
    }
  }, [showToast, t.errorLoadingUsers]);

  useEffect(() => { void loadUsers({ showLoading: true }); }, [loadUsers]);
  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (!cancelled) setBrandingLanguage(normalizeLanguage(res.data?.branding?.defaultLanguage));
      })
      .catch(() => {
        if (!cancelled) setBrandingLanguage('en');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadUserDetail = async (userId) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/users/${userId}`);
      setUserDetail(res.data && typeof res.data === 'object' ? res.data : null);
    } catch {
      showToast(t.errorLoadingUserDetail, 'error');
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
    if (role === 'owner') return u.ownerBadge;
    if (role === 'admin_readonly') return t.readOnlyRole;
    if (role === 'admin') return u.adminBadge;
    return u.userBadge;
  };
  const roleBadgeClass = (role) => {
    if (role === 'owner') return 'bg-rose-100 text-rose-700';
    if (role === 'admin') return 'bg-amber-100 text-amber-700';
    if (role === 'admin_readonly') return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  };
  const RoleBadgeIcon = ({ role, className = 'w-3 h-3' }) => {
    if (role === 'admin') return <Shield className={className} />;
    if (role === 'admin_readonly') return <Eye className={className} />;
    return null;
  };
  const roleBadgeContent = (role) => (
    <>
      <RoleBadgeIcon role={role} />
      <span>{roleLabel(role)}</span>
    </>
  );
  const updateRole = async (user, newRole) => {
    const action = roleLabel(newRole);
    openConfirm({
      title: u.roleConfirmTitle.replace('{action}', action).replace('{name}', user.display_name || user.email),
      message: newRole === 'user'
        ? t.roleUserStandardMessage
        : newRole === 'admin_readonly'
          ? t.roleReadonlyMessage
          : t.roleAdminMessage,
      confirmLabel: t.confirm,
      onConfirm: async () => {
        try {
          await api.put(`/users/${user.id}/role`, { role: newRole });
          showToast(t.roleSetTo.replace('{action}', action));
          await loadUsers();
          if (expandedUser === user.id) await loadUserDetail(user.id);
        } catch (err) {
          showToast(err.response?.data?.error || t.errorSaving, 'error');
        }
      },
    });
  };

  const toggleActive = async (user) => {
    const newActive = !user.is_active;
    const action = newActive ? u.reactivateAction : u.deactivateAction;
    openConfirm({
      title: u.toggleActiveTitle.replace('{action}', action).replace('{name}', user.display_name || user.email),
      message: newActive ? u.reactivateMessage : u.deactivateMessage,
      confirmLabel: newActive ? u.reactivateUser : u.deactivateUser,
      onConfirm: async () => {
        try {
          await api.put(`/users/${user.id}/active`, { is_active: newActive });
          showToast(newActive ? u.reactivateUser : u.deactivateUser);
          await loadUsers();
          if (expandedUser === user.id) await loadUserDetail(user.id);
        } catch (err) {
          showToast(err.response?.data?.error || t.errorSaving, 'error');
        }
      },
    });
  };

  const deleteUser = async (user) => {
    const name = user.display_name || user.email;
    const visibleApps = userDetail?.visibleAppCount || 0;
    const message = visibleApps > 0
      ? t.deleteUserWithAppsMessage.replace('{name}', name).replace('{count}', String(visibleApps))
      : t.deleteUserMessage;
    openConfirm({
      title: u.deleteUserTitle.replace('{name}', name),
      message,
      confirmLabel: u.deleteUser,
      onConfirm: async () => {
        try {
          await api.delete(`/users/${user.id}`);
          showToast(u.deleteUser);
          setExpandedUser(null);
          setUserDetail(null);
          setShowVisibleApps(false);
          await loadUsers();
        } catch (err) {
          showToast(err.response?.data?.error || t.errorSaving, 'error');
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
  const openManagedGroup = (group) => {
    navigate('/admin/groups', {
      state: {
        openGroupDetail: group.id,
        groupSearch: groupLabel(group),
      },
    });
  };
  const localGroups = userDetail?.groups?.filter((g) => g.source !== 'entra') || [];
  const entraGroups = userDetail?.groups?.filter((g) => g.source === 'entra') || [];
  const detectedEntraGroups = userDetail?.entraGroups || [];
  const visibleApps = userDetail?.visibleApps || [];
  const appModeLabel = (mode) => {
    if (mode === 'redirect') return t.redirectSso;
    if (mode === 'shared-cookie') return t.sharedCookie;
    if (mode === 'entra-app') return t.entraApp;
    return t.link;
  };
  const appModeBadgeClass = (mode) => {
    if (mode === 'redirect') return 'bg-blue-100 text-blue-700';
    if (mode === 'shared-cookie') return 'bg-accent/10 text-accent-dark';
    if (mode === 'entra-app') return 'bg-violet-100 text-violet-700';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  };
  const formatDate = (iso) => {
    if (!iso) return t.noLogin;
    try {
      return new Date(iso).toLocaleDateString(ui.common.dateLocale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
          label: t.roleAdminFull,
          icon: Shield,
          className: 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/45 dark:text-amber-300 dark:hover:bg-amber-900/50',
          confirmText: t.roleAdminFullConfirm,
        },
        {
          role: 'admin_readonly',
          label: t.roleAdminReadonly,
          icon: Eye,
          className: 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
          confirmText: t.roleAdminReadonlyConfirm,
        }
      );
    } else if (targetUser.role === 'admin_readonly') {
      actions.push(
        {
          role: 'admin',
          label: t.roleAdminFull,
          icon: Shield,
          className: 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/45 dark:text-amber-300 dark:hover:bg-amber-900/50',
          confirmText: t.roleAdminFullConfirm,
        },
        {
          role: 'user',
          label: t.roleRemove,
          icon: ShieldOff,
          className: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/45 dark:text-blue-300 dark:hover:bg-blue-900/50',
          confirmText: t.roleRemoveConfirm,
        }
      );
    } else if (targetUser.role === 'admin') {
      actions.push(
        {
          role: 'admin_readonly',
          label: t.roleAdminReadonly,
          icon: Eye,
          className: 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
          confirmText: t.roleAdminReadonlyConfirm,
        },
        {
          role: 'user',
          label: t.roleRemove,
          icon: ShieldOff,
          className: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/45 dark:text-blue-300 dark:hover:bg-blue-900/50',
          confirmText: t.roleRemoveConfirm,
        }
      );
    } else if (targetUser.role === 'owner') {
      actions.push(
        {
          role: 'admin',
          label: t.roleAdminFull,
          icon: Shield,
          className: 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/45 dark:text-amber-300 dark:hover:bg-amber-900/50',
          confirmText: t.roleAdminFullConfirm,
        },
        {
          role: 'admin_readonly',
          label: t.roleAdminReadonly,
          icon: Eye,
          className: 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
          confirmText: t.roleAdminReadonlyConfirm,
        },
        {
          role: 'user',
          label: t.roleRemove,
          icon: ShieldOff,
          className: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/45 dark:text-blue-300 dark:hover:bg-blue-900/50',
          confirmText: t.roleRemoveConfirm,
        }
      );
    }

    return actions;
  };

  const adminCount = users.filter((u) => ['owner', 'admin'].includes(u.role) && u.is_active).length;
  const activeCount = users.filter((u) => u.is_active).length;

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.users.pageTitle}</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            {users.length} {ui.nav.users.toLowerCase()} {t.total} &middot; {activeCount} {t.active} &middot; {adminCount} {t.privileged}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsers()}
          disabled={refreshing || loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-dark dark:text-gray-100 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 max-sm:w-full"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {ui.admin.users.refresh}
        </button>
      </div>

      {!canEditUsers && (
        <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
          {t.readOnly}
        </div>
      )}

      {pageNotice && (
        <div className="mb-6">
          <PageNotice
            type={pageNotice.type}
            message={pageNotice.message}
            onClose={() => setPageNotice(null)}
            closeLabel={ui.common.closeNotice}
          />
        </div>
      )}

      {/* Filters */}
      <div className="mb-8 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder={ui.admin.users.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <DropdownSelect
            value={filterRole}
            onChange={setFilterRole}
            label={t.role}
            icon={Shield}
            options={[
              { value: 'all', label: t.allRoles },
              { value: 'owner', label: u.ownerBadge },
              { value: 'admin', label: u.adminBadge },
              { value: 'admin_readonly', label: t.readOnlyRole },
              { value: 'user', label: t.usersOnly },
            ]}
            className="min-w-[220px]"
          />
          <DropdownSelect
            value={filterActive}
            onChange={setFilterActive}
            label={t.status}
            icon={Clock}
            options={[
              { value: 'all', label: t.allStatuses },
              { value: 'active', label: t.activeOnly },
              { value: 'inactive', label: t.inactiveOnly },
            ]}
            className="min-w-[220px]"
          />
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">{t.noUsersFound}</p>
          {search && <p className="text-sm mt-1">{ui.admin.users.noUsersFoundHelp}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((user) => (
            <div key={user.id} className={`bg-white dark:bg-gray-900 rounded-2xl border overflow-hidden transition-colors ${
              user.is_active ? 'border-gray-100 dark:border-gray-800' : 'border-red-100 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/25'
            }`}>
              {/* User row */}
              <div
                className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-gray-50/90 dark:hover:bg-gray-800/50 transition-colors"
                onClick={() => toggleExpand(user.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedUser === user.id
                    ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />}
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
                      <span className={`font-semibold text-sm ${user.is_active ? 'text-dark dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                        {user.display_name || user.email}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${roleBadgeClass(user.role)}`}>
                        {roleBadgeContent(user.role)}
                      </span>
                      {isComposeLockedAdmin(user) && (
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded font-medium">{u.composeBadge}</span>
                      )}
                      {!user.last_login && (
                        <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />{t.noLogin}
                        </span>
                      )}
                      {!user.is_active && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">{t.inactive}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">
                    {user.group_count} {t.groups}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 hidden md:block">
                    {t.lastLogin}: {formatDate(user.last_login)}
                  </span>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedUser === user.id && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-5">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-dark rounded-full" />
                    </div>
                  ) : userDetail ? (
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.3fr)_minmax(0,0.88fr)] gap-6 lg:min-h-[460px]">
                      {/* Info */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t.info}</h3>
                        <dl className="space-y-2 text-sm">
                          <div>
                            <dt className="text-gray-400 dark:text-gray-500">{u.emailLabel}</dt>
                            <dd className="text-dark dark:text-gray-100 font-medium">{userDetail.user.email}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-400 dark:text-gray-500">{t.role}</dt>
                            <dd className="inline-flex items-center gap-1 text-dark dark:text-gray-100 font-medium">
                              {roleBadgeContent(userDetail.user.role)}
                            </dd>
                          </div>
                          <div>
                          <dt className="text-gray-400 dark:text-gray-500">{t.status}</dt>
                          <dd className={userDetail.user.is_active ? 'text-accent-dark font-medium' : 'text-red-500 font-medium'}>
                              {userDetail.user.is_active ? t.active : t.inactive}
                          </dd>
                        </div>
                        <div>
                            <dt className="text-gray-400 dark:text-gray-500">{t.registered}</dt>
                            <dd className="text-dark dark:text-gray-100">{formatDate(userDetail.user.created_at)}</dd>
                        </div>
                        <div>
                            <dt className="text-gray-400 dark:text-gray-500">{t.lastLogin}</dt>
                            <dd className="text-dark dark:text-gray-100">{formatDate(userDetail.user.last_login)}</dd>
                        </div>
                          <div>
                            <dt className="text-gray-400 dark:text-gray-500">{t.visibleApps}</dt>
                            <dd>
                              {userDetail.visibleAppCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setShowVisibleApps(true)}
                                  className="inline-flex items-center gap-1 text-dark dark:text-gray-100 font-medium hover:text-accent-dark hover:underline"
                                >
                                  {userDetail.visibleAppCount}
                                  <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                                </button>
                              ) : (
                                <span className="text-dark dark:text-gray-100 font-medium">0</span>
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      {/* Groups */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                          {t.frontdoorGroups} ({userDetail.groups.length})
                        </h3>

                        <div className="space-y-5 h-full overflow-y-auto pr-1 lg:max-h-[390px]">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                              {t.localGroups} ({localGroups.length})
                            </p>
                            <p className="mb-2 text-xs text-sky-600">
                              {t.localGroupsInfo}
                            </p>
                            {localGroups.length === 0 ? (
                            <p className="text-sm text-gray-300 dark:text-gray-600 italic">{t.noLocalGroups}</p>
                            ) : (
                              <div className="space-y-1.5">
                                {localGroups.map((g) => (
                                  <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => openManagedGroup(g)}
                                    className="w-full flex items-center gap-2 py-1 text-left rounded-lg px-2 -mx-2 hover:bg-sky-50 dark:hover:bg-sky-950/20 transition-colors cursor-pointer"
                                  >
                                    <Users className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                                    <span className="text-sm text-dark dark:text-gray-100">{g.name}</span>
                                    {g.description && (
                                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[150px]">{g.description}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                              {t.importedEntraGroups} ({entraGroups.length})
                            </p>
                            <p className="mb-2 text-xs text-sky-600">{t.entraGroupsInfo}</p>
                            {entraGroups.length === 0 ? (
                              <p className="text-sm text-gray-300 dark:text-gray-600 italic">{t.noImportedEntraGroups}</p>
                            ) : (
                              <div className="space-y-1.5">
                                {entraGroups.map((g) => (
                                  <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => openManagedGroup(g)}
                                    className="w-full flex items-center gap-2 py-1 text-left rounded-lg px-2 -mx-2 hover:bg-sky-50 dark:hover:bg-sky-950/20 transition-colors cursor-pointer"
                                  >
                                    <Users className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                                    <span className="text-sm text-dark dark:text-gray-100">{groupLabel(g)}</span>
                                    <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">
                                      {u.entraBadge}
                                    </span>
                                    {g.description && (
                                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[150px]">{g.description}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                          {t.detectedEntraGroups} ({detectedEntraGroups.length})
                        </h3>
                        <p className="mb-2 text-xs text-sky-600">
                          {t.detectedGroupsInfo}
                        </p>
                        {detectedEntraGroups.length === 0 ? (
                          <p className="text-sm text-gray-300 dark:text-gray-600 italic">{t.noDetectedEntraGroups}</p>
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
                                <Users className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                                <span className="text-sm text-dark dark:text-gray-100">{group.display_name}</span>
                                {group.is_imported ? (
                                  <span className="text-[10px] bg-accent/10 text-accent-dark px-1.5 py-0.5 rounded font-medium">
                                    {u.importedBadge}
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                    {u.detectedBadge}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t.actions}</h3>
                        <div className="space-y-2 lg:sticky lg:top-4">
                          {!canEditUsers && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                              {u.readOnlyUsersMessage}
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
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                : user.is_active
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/45'
                                  : 'bg-accent/10 text-accent-dark hover:bg-accent/20 dark:bg-accent-dark/25 dark:text-gray-100 dark:hover:bg-accent-dark/35'
                            }`}
                          >
                            {!canEditUsers || isComposeLockedAdmin(user) ? (
                              <><UserX className="w-4 h-4" /> {u.deactivateBlocked}</>
                            ) : user.is_active ? (
                              <><UserX className="w-4 h-4" /> {u.deactivateUser}</>
                            ) : (
                              <><UserCheck className="w-4 h-4" /> {u.reactivateUser}</>
                            )}
                          </button>
                          <div className="border-t border-gray-100 dark:border-gray-800 pt-2 mt-1">
                            <button
                              onClick={!canEditUsers || isComposeLockedAdmin(user) ? undefined : () => deleteUser(user)}
                              disabled={!canEditUsers || isComposeLockedAdmin(user)}
                              className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                !canEditUsers || isComposeLockedAdmin(user)
                                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                  : 'bg-red-50 text-red-700 hover:bg-red-200 dark:bg-red-950/45 dark:text-red-300 dark:hover:bg-red-900/55'
                              }`}
                            >
                              <Trash2 className="w-4 h-4" /> {!canEditUsers || isComposeLockedAdmin(user) ? u.deleteBlocked : u.deleteUser}
                            </button>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 px-1">{u.removeUserSummary}</p>
                            {isComposeLockedAdmin(user) && (
                              <p className="text-[11px] text-slate-400 mt-2 px-1">{u.composeWarning}</p>
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
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{t.visibleApps}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{visibleApps.length} {t.appVisibleCount}</p>
              </div>
              <button onClick={() => setShowVisibleApps(false)} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            {visibleApps.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">{t.noVisibleApps}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleApps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => {
                      setShowVisibleApps(false);
                      navigate(`/admin?edit=${encodeURIComponent(app.slug)}`);
                    }}
                    className="w-full flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-left hover:border-accent hover:bg-accent/5 transition-colors"
                  >
                    <AppIcon app={app} className="w-8 h-8" textClassName="text-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{app.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${appModeBadgeClass(app.mode)}`}>
                          {appModeLabel(app.mode)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{app.description}</p>
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
        confirmLabel={confirmDialog?.confirmLabel || t.confirm}
        cancelLabel={confirmDialog?.cancelLabel || ui.common.cancel}
        closeLabel={ui.common.closeDialog}
        busyLabel={ui.common.pleaseWait}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
