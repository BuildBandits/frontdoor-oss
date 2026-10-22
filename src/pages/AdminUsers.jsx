import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Eye, Shield, ShieldOff, UserCheck, UserX, ChevronDown, ChevronRight, Users, Trash2, Clock, X, Info, RefreshCw, AlertTriangle, Wand2, Filter, LogIn } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useBranding } from '../stores/brandingStore';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';
import TopToastNotice from '../components/TopToastNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import Modal from '../components/Modal';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
import Tooltip from '../components/Tooltip';
import PaginationControls from '../components/PaginationControls';
import { formatMessage, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import { apiErrorMessage } from '../utils/apiErrors';
import { normalizeColorScheme, resolveAppColorScheme } from '../../shared/colorSchemes.js';
import { formatLocalDateTime } from '../utils/dateTime';
import { normalizeTimeZone, resolveAppTimeZone } from '../../shared/timeZones.js';

export default function AdminUsers() {
  const { user: currentUser, impersonation, startImpersonation } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [impersonationTarget, setImpersonationTarget] = useState(null);
  const [impersonationReason, setImpersonationReason] = useState('');
  const [impersonationStarting, setImpersonationStarting] = useState(false);
  const [impersonationError, setImpersonationError] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all'); // all | owner | admin | admin_readonly | user
  const [filterActive, setFilterActive] = useState('all'); // all | active | inactive
  const [filterPersonalization, setFilterPersonalization] = useState('all'); // all | customized | none
  const [expandedUser, setExpandedUser] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const { open: openConfirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [showVisibleApps, setShowVisibleApps] = useState(false);
  const [visibleAppsSearch, setVisibleAppsSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const branding = useBranding();
  const brandingLanguage = normalizeLanguage(branding?.defaultLanguage);
  const brandingTimeZone = normalizeTimeZone(branding?.defaultTimeZone, 'UTC');
  const defaultHomeDesktopView = branding?.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards';
  const defaultColorScheme = normalizeColorScheme(branding?.defaultColorScheme);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const detailInfoRef = useRef(null);
  const [detailInfoHeight, setDetailInfoHeight] = useState(null);

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

  useLayoutEffect(() => {
    const element = detailInfoRef.current;
    if (!element) {
      setDetailInfoHeight(null);
      return undefined;
    }

    const updateHeight = () => {
      setDetailInfoHeight(element.getBoundingClientRect().height);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expandedUser, detailLoading, userDetail]);

  const showToast = useCallback((message, type = 'success') => setPageNotice({ message, type }), []);

  const ui = getUiStrings(resolveAppLanguage(currentUser?.preferredLanguage, brandingLanguage));
  const t = ui.admin.common;
  const u = ui.admin.users;
  const timeZone = resolveAppTimeZone(currentUser?.preferredTimeZone, brandingTimeZone);

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
    setPage(1);
  }, [search, filterRole, filterActive, filterPersonalization, pageSize]);

  // Only the latest detail request may update the panel, so a slower answer for a
  // user that is no longer expanded cannot appear (and be acted on) under another one.
  const detailRequest = useLatestRequest();
  const loadUserDetail = async (userId) => {
    const isLatest = detailRequest.begin();
    setDetailLoading(true);
    try {
      const res = await api.get(`/users/${userId}`);
      if (isLatest()) setUserDetail(res.data && typeof res.data === 'object' ? res.data : null);
    } catch {
      if (isLatest()) showToast(t.errorLoadingUserDetail, 'error');
    }
    if (isLatest()) setDetailLoading(false);
  };

  const toggleExpand = async (userId) => {
    if (expandedUser === userId) {
      detailRequest.cancel();
      setExpandedUser(null);
      setUserDetail(null);
      setShowVisibleApps(false);
      setDetailLoading(false);
    } else {
      setExpandedUser(userId);
      setUserDetail(null);
      setShowVisibleApps(false);
      await loadUserDetail(userId);
    }
  };

  // Coming back from "Stop" in the impersonation banner: show that user's detail again.
  const expandUserId = location.state?.expandUserId;
  useEffect(() => {
    if (!expandUserId) return;
    navigate(location.pathname, { replace: true, state: null });
    void toggleExpand(expandUserId);
    // Runs once per navigation that carries the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandUserId]);

  const canImpersonate = (targetUser) => (
    !impersonation
    && targetUser.role === 'user'
    && Boolean(targetUser.is_active)
    && targetUser.id !== currentUser?.id
  );

  const openImpersonation = (targetUser) => {
    setImpersonationTarget(targetUser);
    setImpersonationReason('');
    setImpersonationError('');
  };

  const confirmImpersonation = async (event) => {
    event.preventDefault();
    setImpersonationStarting(true);
    setImpersonationError('');
    try {
      await startImpersonation(impersonationTarget.id, impersonationReason);
      navigate('/');
    } catch (err) {
      setImpersonationError(apiErrorMessage(err, ui, u.impersonateFailed));
      setImpersonationStarting(false);
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
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
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
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
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
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
        }
      },
    });
  };

  // Filtering
  const filtered = users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterActive === 'active' && !u.is_active) return false;
    if (filterActive === 'inactive' && u.is_active) return false;
    if (filterActive === 'entraMissing' && !u.entra_missing_since) return false;
    if (filterPersonalization === 'customized' && !hasAtLeastOnePersonalization(u)) return false;
    if (filterPersonalization === 'none' && hasAtLeastOnePersonalization(u)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (u.display_name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    }
    return true;
  });
  const pagination = useMemo(() => ({
    page,
    pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    total: filtered.length,
  }), [filtered.length, page, pageSize]);
  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  useEffect(() => {
    if (page > pagination.pages) {
      setPage(pagination.pages);
    }
  }, [page, pagination.pages]);

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
  const visibleAppsQuery = visibleAppsSearch.trim().toLowerCase();
  const filteredVisibleApps = visibleAppsQuery
    ? visibleApps.filter((app) => [app.name, app.slug, app.description]
      .some((value) => typeof value === 'string' && value.toLowerCase().includes(visibleAppsQuery)))
    : visibleApps;
  const appModeLabel = (mode) => {
    if (mode === 'redirect') return t.redirectSso;
    if (mode === 'internal-link') return t.internalLink;
    if (mode === 'shared-cookie') return t.sharedCookie;
    if (mode === 'entra-app') return t.entraApp;
    return t.link;
  };
  const appModeBadgeClass = (mode) => {
    if (mode === 'redirect') return 'bg-blue-100 text-blue-700';
    if (mode === 'internal-link') return 'bg-emerald-100 text-emerald-700';
    if (mode === 'shared-cookie') return 'bg-accent/10 text-accent-dark';
    if (mode === 'entra-app') return 'bg-violet-100 text-violet-700';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  };
  const formatDate = (iso) => (iso ? formatLocalDateTime(iso, { locale: ui.common.dateLocale, timeZone }) || iso : t.noLogin);

  const formatDateTimeCompact = (iso) => (iso ? formatLocalDateTime(iso, { locale: ui.common.dateLocale, timeZone, numeric: true }) || iso : ui.common.default);

  function parseStoredJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === 'string' && item.trim());
    }
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()) : [];
    } catch {
      return [];
    }
  }

  const formatStoredPreference = (value, mapping) => {
    if (!value) return ui.common.default;
    return mapping[value] || value;
  };

  function hasAtLeastOnePersonalization(user) {
    return Boolean(
      (user?.home_desktop_view != null && normalizeHomeView(user.home_desktop_view) !== defaultHomeDesktopView)
      || (user?.preferred_language != null && normalizeLanguage(user.preferred_language) !== normalizeLanguage(brandingLanguage))
      || (user?.preferred_timezone != null && normalizeTimeZone(user.preferred_timezone, brandingTimeZone) !== normalizeTimeZone(brandingTimeZone, brandingTimeZone))
      || (user?.preferred_color_scheme != null && normalizeColorScheme(user.preferred_color_scheme) !== defaultColorScheme)
      || parseStoredJsonArray(user?.app_order).length > 0
    );
  }

  function normalizeHomeView(value) {
    return value === 'compact' ? 'compact' : 'cards';
  }
  const renderPreferenceStatus = (value, { isDefault = false, resetLabel = null, onReset = null } = {}) => (
    <div className="inline-flex max-w-full items-center justify-end gap-1.5">
      <span className="min-w-0 truncate">{value}</span>
      {isDefault ? (
        <span className="text-gray-400 dark:text-gray-500 font-normal">
          ({ui.common.default.toLowerCase()})
        </span>
      ) : null}
      {!isDefault && canEditUsers && onReset && resetLabel && (
        <Tooltip content={resetLabel}>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onReset();
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/60"
            aria-label={resetLabel}
          >
            <AlertTriangle className="h-3 w-3" />
          </button>
        </Tooltip>
      )}
    </div>
  );

  const openPreferenceResetConfirm = (label, payload) => {
    if (!userDetail?.user?.id) return;
    openConfirm({
      title: u.resetPreferenceTitle.replace('{label}', label),
      message: u.resetPreferenceMessage.replace('{label}', label),
      confirmLabel: ui.common.reset,
      onConfirm: async () => {
        try {
          await api.put(`/users/${userDetail.user.id}/preferences`, payload);
          showToast(ui.common.changesSaved);
          await loadUserDetail(userDetail.user.id);
        } catch (err) {
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
        }
      },
    });
  };

  const effectiveHomeView = normalizeHomeView(userDetail?.user?.home_desktop_view ?? defaultHomeDesktopView);
  const effectiveLanguage = resolveAppLanguage(userDetail?.user?.preferred_language, brandingLanguage);
  const effectiveTimeZone = resolveAppTimeZone(userDetail?.user?.preferred_timezone, brandingTimeZone);
  const effectiveColorScheme = resolveAppColorScheme(userDetail?.user?.preferred_color_scheme, defaultColorScheme);
  const customOrderItems = parseStoredJsonArray(userDetail?.user?.app_order);
  const hasCustomOrder = customOrderItems.length > 0;
  const homeViewIsDefault = effectiveHomeView === defaultHomeDesktopView;
  const languageIsDefault = !userDetail?.user?.preferred_language || effectiveLanguage === brandingLanguage;
  const timeZoneIsDefault = !userDetail?.user?.preferred_timezone || effectiveTimeZone === brandingTimeZone;
  const colorSchemeIsDefault = !userDetail?.user?.preferred_color_scheme || effectiveColorScheme === defaultColorScheme;

  const renderInfoRow = (label, value, {
    valueClassName = 'text-dark dark:text-gray-100 font-medium',
    extra = null,
    noBorder = false,
  } = {}) => (
    <div className={`flex items-start justify-between gap-4 py-2 ${noBorder ? 'last:pb-0' : 'border-b border-gray-100 dark:border-gray-800 last:border-b-0 last:pb-0'}`}>
      <dt className="min-w-0 text-gray-400 dark:text-gray-500">
        {label}
      </dt>
      <dd className={`shrink-0 text-right ${valueClassName}`}>
        <span>{value}</span>
        {extra}
      </dd>
    </div>
  );

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

  const getCompactActionLabel = (action) => {
    if (action.role === 'admin') return u.roleAdminCompact;
    if (action.role === 'admin_readonly') return u.roleReadonlyCompact;
    if (action.role === 'user') return u.roleRemoveCompact;
    return action.label;
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

      <TopToastNotice
        notice={pageNotice}
        onClose={() => setPageNotice(null)}
        closeLabel={ui.common.closeNotice}
        positionClassName="top-4 sm:top-6"
      />

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
            className="min-w-[190px]"
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
              { value: 'entraMissing', label: u.entraMissingOnly },
            ]}
            className="min-w-[190px]"
          />
          <DropdownSelect
            value={filterPersonalization}
            onChange={setFilterPersonalization}
            label={u.personalizationFilterLabel}
            icon={Wand2}
            options={[
              { value: 'all', label: u.allPersonalizationStates },
              { value: 'customized', label: u.personalizedOnly },
              { value: 'none', label: u.noPersonalizations },
            ]}
            className="min-w-[260px]"
          />
          <DropdownSelect
            value={pageSize}
            onChange={(next) => setPageSize(parseInt(next, 10))}
            label={ui.admin.logs.rows}
            icon={Filter}
            options={[
              { value: 25, label: '25' },
              { value: 50, label: '50' },
              { value: 100, label: '100' },
              { value: 150, label: '150' },
            ]}
            className="min-w-[140px]"
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
          <PaginationControls
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            summary={formatMessage(ui.admin.users.pageSummary, pagination)}
            previousLabel={ui.common.previous}
            nextLabel={ui.common.next}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
            className="mt-0"
          />
          {paginatedUsers.map((user) => (
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
                    ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />}
                  <UserAvatar
                    userId={user.id}
                    displayName={user.display_name}
                    email={user.email}
                    avatarColor={user.avatar_color}
                    className={`w-9 h-9 ${!user.is_active ? 'opacity-40' : ''}`}
                    initialsClassName="text-xs"
                  />
                  <div className="min-w-0 flex-1 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-semibold text-sm ${user.is_active ? 'text-dark dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                          {user.display_name || user.email}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${roleBadgeClass(user.role)}`}>
                          {roleBadgeContent(user.role)}
                        </span>
                        {isComposeLockedAdmin(user) && (
                          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded-sm font-medium">{u.composeBadge}</span>
                        )}
                        {!user.last_login && (
                          <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-sm font-medium flex items-center gap-0.5 dark:bg-purple-900/40">
                            <Clock className="w-3 h-3" />{t.noLogin}
                          </span>
                        )}
                        {!user.is_active && (
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-sm font-medium">{t.inactive}</span>
                        )}
                        {user.entra_missing_since && (
                          <Tooltip content={u.entraMissingSince.replace('{date}', formatDate(user.entra_missing_since))}>
                            <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 px-1.5 py-0.5 rounded-sm font-medium">{u.entraMissingBadge}</span>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user.email}</p>
                    </div>
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
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 xl:gap-10 lg:items-start">
                      {/* Info */}
                      <div ref={detailInfoRef} className="flex flex-col self-start">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t.info}</h3>
                        <dl className="flex flex-col space-y-0 text-sm">
                          {renderInfoRow(u.emailLabel, userDetail.user.email)}
                          {renderInfoRow(
                            t.role,
                            <span className="inline-flex items-center gap-1">{roleBadgeContent(userDetail.user.role)}</span>
                          )}
                          {renderInfoRow(
                            t.status,
                            userDetail.user.is_active ? t.active : t.inactive,
                            { valueClassName: userDetail.user.is_active ? 'text-accent-dark font-medium' : 'text-red-500 font-medium' }
                          )}
                          {userDetail.user.entra_missing_since && renderInfoRow(
                            u.entraMissingLabel,
                            formatDate(userDetail.user.entra_missing_since),
                            { valueClassName: 'text-amber-600 dark:text-amber-400 font-medium' }
                          )}
                          {renderInfoRow(t.registered, formatDate(userDetail.user.created_at))}
                          {renderInfoRow(t.lastLogin, formatDate(userDetail.user.last_login))}
                          {renderInfoRow(t.lastActivity, formatDate(userDetail.user.last_activity_at))}
                          {renderInfoRow(
                            t.visibleApps,
                            userDetail.visibleAppCount > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setVisibleAppsSearch('');
                                  setShowVisibleApps(true);
                                }}
                                className="inline-flex items-center gap-1 text-dark dark:text-gray-100 font-medium hover:text-accent-dark hover:underline"
                              >
                                {userDetail.visibleAppCount}
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                              </button>
                            ) : '0',
                            { noBorder: true }
                          )}
                          <div aria-hidden="true" className="block h-0 py-5" />
                          <div className="mt-16 pt-2">
                            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                              {u.personalSettings}
                            </h3>
                            <dl className="space-y-0 text-sm">
                              {renderInfoRow(
                                u.homeView,
                                renderPreferenceStatus(
                                  formatStoredPreference(effectiveHomeView, {
                                  cards: ui.layout.homeViewCards,
                                  compact: ui.layout.homeViewCompact,
                                  }),
                                  {
                                    isDefault: homeViewIsDefault,
                                    resetLabel: u.resetPreferenceTooltip.replace('{label}', u.homeView),
                                    onReset: homeViewIsDefault ? null : () => openPreferenceResetConfirm(u.homeView, { homeDesktopView: null }),
                                  }
                                )
                              )}
                              {renderInfoRow(
                                u.languageSetting,
                                renderPreferenceStatus(
                                  formatStoredPreference(effectiveLanguage, {
                                  en: ui.common.english,
                                  it: ui.common.italian,
                                  }),
                                  {
                                    isDefault: languageIsDefault,
                                    resetLabel: u.resetPreferenceTooltip.replace('{label}', u.languageSetting),
                                    onReset: languageIsDefault ? null : () => openPreferenceResetConfirm(u.languageSetting, { preferredLanguage: null }),
                                  }
                                )
                              )}
                              {renderInfoRow(
                                u.timeZoneSetting,
                                renderPreferenceStatus(
                                  effectiveTimeZone,
                                  {
                                    isDefault: timeZoneIsDefault,
                                    resetLabel: u.resetPreferenceTooltip.replace('{label}', u.timeZoneSetting),
                                    onReset: timeZoneIsDefault ? null : () => openPreferenceResetConfirm(u.timeZoneSetting, { preferredTimeZone: null }),
                                  }
                                )
                              )}
                              {renderInfoRow(
                                u.themeSetting,
                                renderPreferenceStatus(
                                  formatStoredPreference(effectiveColorScheme, {
                                  light: ui.layout.colorSchemeLight,
                                  dark: ui.layout.colorSchemeDark,
                                  auto: ui.layout.colorSchemeAuto,
                                  }),
                                  {
                                    isDefault: colorSchemeIsDefault,
                                    resetLabel: u.resetPreferenceTooltip.replace('{label}', u.themeSetting),
                                    onReset: colorSchemeIsDefault ? null : () => openPreferenceResetConfirm(u.themeSetting, { preferredColorScheme: null }),
                                  }
                                )
                              )}
                              {renderInfoRow(
                                u.customOrder,
                                renderPreferenceStatus(
                                  hasCustomOrder ? ui.common.yes : ui.common.no,
                                  {
                                    isDefault: !hasCustomOrder,
                                    resetLabel: u.resetPreferenceTooltip.replace('{label}', u.customOrder),
                                    onReset: !hasCustomOrder ? null : () => openPreferenceResetConfirm(u.customOrder, { appOrder: null }),
                                  }
                                ),
                                {
                                  extra: userDetail.user.app_order_updated_at
                                    ? (
                                      <span className="text-gray-400 dark:text-gray-500 font-normal">
                                        {` (${formatDateTimeCompact(userDetail.user.app_order_updated_at)})`}
                                      </span>
                                    )
                                    : null,
                                }
                              )}
                              {renderInfoRow(
                                ui.home.favorites,
                                `${parseStoredJsonArray(userDetail.user.favorite_apps).length}${userDetail.user.favorite_apps_updated_at ? ` (${formatDateTimeCompact(userDetail.user.favorite_apps_updated_at)})` : ''}`
                              )}
                            </dl>
                          </div>
                        </dl>
                      </div>

                      {/* Groups */}
                      <div
                        className="flex h-full min-h-0 flex-col overflow-hidden self-start"
                        style={detailInfoHeight ? { height: `${detailInfoHeight}px`, maxHeight: `${detailInfoHeight}px` } : undefined}
                      >
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                          {t.frontdoorGroups} ({userDetail.groups.length})
                        </h3>

                        <div className="flex min-h-0 flex-1 flex-col space-y-5 overflow-y-auto pr-1">
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
                                    <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-sm font-medium">
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

                      <div
                        className="flex h-full min-h-0 flex-col overflow-hidden self-start"
                        style={detailInfoHeight ? { height: `${detailInfoHeight}px`, maxHeight: `${detailInfoHeight}px` } : undefined}
                      >
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                          {t.detectedEntraGroups} ({detectedEntraGroups.length})
                        </h3>
                        <p className="mb-2 text-xs text-sky-600">
                          {t.detectedGroupsInfo}
                        </p>
                        {detectedEntraGroups.length === 0 ? (
                          <p className="text-sm text-gray-300 dark:text-gray-600 italic">{t.noDetectedEntraGroups}</p>
                        ) : (
                          <div className="flex min-h-0 flex-1 flex-col space-y-1.5 overflow-y-auto pr-1">
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
                                  <span className="text-[10px] bg-accent/10 text-accent-dark px-1.5 py-0.5 rounded-sm font-medium">
                                    {u.importedBadge}
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-amber-950/40 dark:text-amber-300">
                                    {u.detectedBadge}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {(canEditUsers || canImpersonate(user)) && (
                        <div className="col-span-full border-t border-gray-100 dark:border-gray-800 pt-5 mt-1">
                          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t.actions}</h3>
                          <div className="flex flex-wrap gap-2">
                            {canImpersonate(user) && (
                              <Tooltip content={u.impersonate}>
                                <button
                                  type="button"
                                  onClick={() => openImpersonation(user)}
                                  aria-label={u.impersonate}
                                  className="inline-flex min-w-0 items-center gap-2 rounded-full bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-950/45 dark:text-violet-300 dark:hover:bg-violet-900/50"
                                >
                                  <LogIn className="h-4 w-4 shrink-0" />
                                  <span className="min-w-0 truncate">{u.impersonate}</span>
                                </button>
                              </Tooltip>
                            )}
                            {canEditUsers && (
                              <>
                                {getRoleActions(user).map((action) => {
                                  const Icon = action.icon;
                                  return (
                                    <Tooltip key={action.role} content={action.label}>
                                      <button
                                        type="button"
                                        onClick={() => updateRole(user, action.role)}
                                        aria-label={action.label}
                                        className={`inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${action.className}`}
                                      >
                                        <Icon className="h-4 w-4 shrink-0" />
                                        <span className="min-w-0 truncate">{getCompactActionLabel(action)}</span>
                                      </button>
                                    </Tooltip>
                                  );
                                })}

                                <Tooltip content={isComposeLockedAdmin(user) ? u.deactivateBlocked : (user.is_active ? u.deactivateUser : u.reactivateUser)}>
                                  <button
                                    type="button"
                                    onClick={isComposeLockedAdmin(user) ? undefined : () => toggleActive(user)}
                                    disabled={isComposeLockedAdmin(user)}
                                    aria-label={isComposeLockedAdmin(user) ? u.deactivateBlocked : (user.is_active ? u.deactivateUser : u.reactivateUser)}
                                    className={`inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                                      isComposeLockedAdmin(user)
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                        : user.is_active
                                          ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/45'
                                          : 'bg-accent/10 text-accent-dark hover:bg-accent/20 dark:bg-accent-dark/25 dark:text-gray-100 dark:hover:bg-accent-dark/35'
                                    }`}
                                  >
                                    {isComposeLockedAdmin(user) ? (
                                      <><UserX className="h-4 w-4 shrink-0" /> <span className="min-w-0 truncate">{u.deactivateBlocked}</span></>
                                    ) : user.is_active ? (
                                      <><UserX className="h-4 w-4 shrink-0" /> <span className="min-w-0 truncate">{u.deactivateUser}</span></>
                                    ) : (
                                      <><UserCheck className="h-4 w-4 shrink-0" /> <span className="min-w-0 truncate">{u.reactivateUser}</span></>
                                    )}
                                  </button>
                                </Tooltip>
                                <Tooltip content={isComposeLockedAdmin(user) ? u.deleteBlocked : u.deleteUser}>
                                  <button
                                    type="button"
                                    onClick={isComposeLockedAdmin(user) ? undefined : () => deleteUser(user)}
                                    disabled={isComposeLockedAdmin(user)}
                                    aria-label={isComposeLockedAdmin(user) ? u.deleteBlocked : u.deleteUser}
                                    className={`inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                                      isComposeLockedAdmin(user)
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                        : 'bg-red-50 text-red-700 hover:bg-red-200 dark:bg-red-950/45 dark:text-red-300 dark:hover:bg-red-900/55'
                                    }`}
                                  >
                                    <Trash2 className="h-4 w-4 shrink-0" /> <span className="min-w-0 truncate">{u.deleteUser}</span>
                                  </button>
                                </Tooltip>
                              </>
                            )}
                          </div>
                          {canEditUsers && (
                            <div className="mt-3 flex flex-wrap items-center gap-3 px-1 text-[11px] text-gray-400 dark:text-gray-500">
                              <span>{u.removeUserSummary}</span>
                              {isComposeLockedAdmin(user) && (
                                <span>{u.composeWarning}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <PaginationControls
        page={pagination.page}
        pages={pagination.pages}
        total={pagination.total}
        summary={formatMessage(ui.admin.users.pageSummary, pagination)}
        previousLabel={ui.common.previous}
        nextLabel={ui.common.next}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
      />

      {impersonationTarget && (
        <Modal onClose={() => !impersonationStarting && setImpersonationTarget(null)} labelledBy="impersonation-dialog-title">
          <form onSubmit={confirmImpersonation} className="space-y-4">
            <h2 id="impersonation-dialog-title" className="text-lg font-bold text-dark dark:text-gray-100">
              {formatMessage(u.impersonateTitle, { name: impersonationTarget.display_name || impersonationTarget.email })}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">{u.impersonateBody}</p>
            <label className="block text-sm font-medium text-dark dark:text-gray-100">
              {u.impersonateReasonLabel}
              <textarea
                data-autofocus
                required
                maxLength={500}
                rows={3}
                value={impersonationReason}
                onChange={(event) => setImpersonationReason(event.target.value)}
                placeholder={u.impersonateReasonPlaceholder}
                className="mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              />
            </label>
            {impersonationError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{impersonationError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setImpersonationTarget(null)} disabled={impersonationStarting} className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                {ui.common.cancel}
              </button>
              <button type="submit" disabled={impersonationStarting || !impersonationReason.trim()} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-60">
                {u.impersonateStart}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showVisibleApps && (
        <Modal onClose={() => setShowVisibleApps(false)} closeOnEscape={false} labelledBy="users-dialog-1-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-y-auto" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="users-dialog-1-title" className="text-lg font-bold text-dark dark:text-gray-100">{t.visibleApps}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {visibleAppsQuery ? `${filteredVisibleApps.length} / ${visibleApps.length}` : visibleApps.length} {t.appVisibleCount}
                </p>
              </div>
              <button type="button" onClick={() => setShowVisibleApps(false)} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            {visibleApps.length > 0 && (
              <ClearableSearchField
                className="mb-4"
                value={visibleAppsSearch}
                onChange={setVisibleAppsSearch}
                placeholder={t.visibleAppsSearchPlaceholder}
                clearLabel={ui.common.clearSearch}
                restoreOnEscape={false}
                autoFocus
              />
            )}

            {visibleApps.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">{t.noVisibleApps}</p>
              </div>
            ) : filteredVisibleApps.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">{t.visibleAppsNoResults}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredVisibleApps.map((app) => (
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
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${appModeBadgeClass(app.mode)}`}>
                          {appModeLabel(app.mode)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{app.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
        </Modal>
      )}

      <ConfirmDialog {...confirmDialogProps} ui={ui} />
    </div>
  );
}
