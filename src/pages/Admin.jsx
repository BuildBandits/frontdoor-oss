import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, RotateCcw, Save, Copy, Users, ChevronDown, ChevronUp, Check, SlidersHorizontal } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import TagInput from '../components/TagInput';
import AppIcon from '../components/AppIcon';
import PageNotice from '../components/PageNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

const emptyApp = { name: '', slug: '', description: '', long_description: '', icon: '📦', target_url: '', sort_order: 0, mode: 'redirect-plain', sso_endpoint: '', sso_method: 'GET', tags: [] };
const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';

export default function Admin() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [apps, setApps] = useState([]);
  const [groups, setGroups] = useState([]);
  const [branding, setBranding] = useState(null);
  const [editing, setEditing] = useState(null); // null = closed, 'new' = creating, or app object
  const [form, setForm] = useState(emptyApp);
  const [loading, setLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [iconMode, setIconMode] = useState('emoji');
  const [iconAssetDataUrl, setIconAssetDataUrl] = useState('');
  const [iconAssetPreview, setIconAssetPreview] = useState('');
  const [iconSvgText, setIconSvgText] = useState('');
  const [removeIconAsset, setRemoveIconAsset] = useState(false);
  const [includeDefaultGroup, setIncludeDefaultGroup] = useState(true);
  const [clonedGroupIds, setClonedGroupIds] = useState([]);
  const [pendingGroupAssignApp, setPendingGroupAssignApp] = useState(null);
  const [groupAssignSearch, setGroupAssignSearch] = useState('');
  const [groupAssignSelection, setGroupAssignSelection] = useState([]);
  const [assigningGroups, setAssigningGroups] = useState(false);
  const [appSearch, setAppSearch] = useState('');
  const [appModeFilter, setAppModeFilter] = useState('all');
  const [modeFilterOpen, setModeFilterOpen] = useState(false);
  const [appSort, setAppSort] = useState({ key: 'sort_order', direction: 'asc' });
  const [pageNotice, setPageNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const iconFileInputRef = useRef(null);
  const modeFilterRef = useRef(null);
  const canEdit = user?.role !== 'admin_readonly';
  const [brandingLanguage, setBrandingLanguage] = useState('en');

  useEffect(() => {
    if (!pageNotice) return undefined;
    const timer = setTimeout(() => setPageNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [pageNotice]);

  useEffect(() => {
    if (!modeFilterOpen) return undefined;
    const onMouseDown = (event) => {
      if (modeFilterRef.current && !modeFilterRef.current.contains(event.target)) {
        setModeFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [modeFilterOpen]);

  const pushNotice = (type, message) => setPageNotice({ type, message });
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

  const loadApps = () => {
    api.get('/apps/all').then((res) => {
      setApps(res.data.apps);
      setLoading(false);
    });
  };

  const loadGroups = () => {
    api.get('/groups').then((res) => {
      setGroups(Array.isArray(res.data.groups) ? res.data.groups : []);
    }).catch(() => {
      setGroups([]);
    }).finally(() => {
      setGroupsLoading(false);
    });
  };

  const loadBranding = () => {
    api.get('/branding')
      .then((res) => {
        setBranding(res.data.branding || null);
        setBrandingLanguage(normalizeLanguage(res.data?.branding?.defaultLanguage));
      })
      .catch(() => {
        setBranding(null);
        setBrandingLanguage('en');
      });
  };

  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));
  const t = ui.admin.common;
  const a = ui.admin.apps;

  useEffect(() => {
    loadApps();
    loadGroups();
    loadBranding();
  }, []);

  const openNew = () => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    setForm(emptyApp);
    setIconMode('emoji');
    setIconAssetDataUrl('');
    setIconAssetPreview('');
    setIconSvgText('');
    setRemoveIconAsset(false);
    setIncludeDefaultGroup(true);
    setClonedGroupIds([]);
    setEditing('new');
  };

  const openEdit = (app) => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    setForm({
      name: app.name,
      slug: app.slug,
      description: app.description || '',
      icon: app.icon || '📦',
      target_url: app.target_url,
      sort_order: app.sort_order || 0,
      mode: app.mode || 'redirect-plain',
      sso_endpoint: app.mode === 'entra-app' ? (app.sso_endpoint && app.sso_endpoint !== '/sso' ? app.sso_endpoint : '') : (app.sso_endpoint || '/sso'),
      sso_method: app.sso_method || 'GET',
      long_description: app.long_description || '',
      tags: Array.isArray(app.tags) ? app.tags : (typeof app.tags === 'string' ? JSON.parse(app.tags || '[]') : []),
    });
    setIconMode(app.iconUrl ? 'asset' : 'emoji');
    setIconAssetPreview(app.iconUrl || '');
    setIconAssetDataUrl('');
    setIconSvgText('');
    setRemoveIconAsset(false);
    setIncludeDefaultGroup(true);
    setClonedGroupIds([]);
    setEditing(app);
  };

  useEffect(() => {
    const editSlug = searchParams.get('edit');
    if (!editSlug || apps.length === 0) return;
    const target = apps.find((app) => app.slug === editSlug);
    if (!target) return;
    if (editing !== null && editing !== 'new' && editing.slug === target.slug) return;
    openEdit(target);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('edit');
    setSearchParams(nextParams, { replace: true });
  }, [apps, editing, openEdit, searchParams, setSearchParams]);

  const openClone = async () => {
    if (!canEdit || editing === 'new' || !editing?.id) return;

    setCloning(true);
    try {
      const res = await api.post(`/apps/${editing.id}/clone`);
      const cloned = res.data?.app;
      if (!cloned) throw new Error(t.cloneDataMissing);

      setEditing('new');
      setForm({
        name: cloned.name || '',
        slug: cloned.slug || '',
        description: cloned.description || '',
        icon: cloned.icon || '📦',
        target_url: cloned.target_url || '',
        sort_order: cloned.sort_order || 0,
        mode: cloned.mode || 'redirect-plain',
        sso_endpoint: cloned.mode === 'entra-app'
          ? (cloned.sso_endpoint && cloned.sso_endpoint !== '/sso' ? cloned.sso_endpoint : '')
          : (cloned.sso_endpoint || '/sso'),
        sso_method: cloned.sso_method || 'GET',
        long_description: cloned.long_description || '',
        tags: Array.isArray(cloned.tags) ? cloned.tags : [],
      });
      setIconMode(cloned.iconDataUrl ? 'asset' : 'emoji');
      setIconAssetDataUrl(cloned.iconDataUrl || '');
      setIconAssetPreview(cloned.iconDataUrl || cloned.iconUrl || '');
      setIconSvgText(cloned.iconSvgText || '');
      setRemoveIconAsset(false);
      setIncludeDefaultGroup(true);
      setClonedGroupIds(Array.isArray(cloned.groupIds) ? cloned.groupIds : []);
      pushNotice('success', a.duplicateNotice);
    } catch (err) {
      pushNotice('error', err.response?.data?.error || err.message || t.cloneFailed);
    }
    setCloning(false);
  };

  const close = () => {
    setEditing(null);
    setForm(emptyApp);
    setIconMode('emoji');
    setIconAssetDataUrl('');
    setIconAssetPreview('');
    setIconSvgText('');
    setRemoveIconAsset(false);
    setIncludeDefaultGroup(true);
    setClonedGroupIds([]);
  };

  const appModalDirty = useMemo(() => {
    if (editing === null) return false;
    const isNew = editing === 'new';
    const existingIconUrl = !isNew && editing?.iconUrl ? editing.iconUrl : '';
    const baseApp = isNew ? emptyApp : {
      name: editing.name || '',
      slug: editing.slug || '',
      description: editing.description || '',
      long_description: editing.long_description || '',
      icon: editing.icon || '📦',
      target_url: editing.target_url || '',
      sort_order: editing.sort_order || 0,
      mode: editing.mode || 'redirect-plain',
      sso_endpoint: editing.mode === 'entra-app' ? (editing.sso_endpoint && editing.sso_endpoint !== '/sso' ? editing.sso_endpoint : '') : (editing.sso_endpoint || '/sso'),
      sso_method: editing.sso_method || 'GET',
      tags: Array.isArray(editing.tags) ? editing.tags : [],
    };

    const formTags = Array.isArray(form.tags) ? form.tags : [];
    const baseTags = Array.isArray(baseApp.tags) ? baseApp.tags : [];
    const equalTags = formTags.length === baseTags.length
      && formTags.every((tag, index) => tag === baseTags[index]);

    const iconDirty = isNew
      ? (
          (iconMode === 'asset' && Boolean(iconAssetDataUrl || iconSvgText || iconAssetPreview || removeIconAsset)) ||
          (iconMode === 'emoji' && form.icon !== emptyApp.icon)
        )
      : (
          (iconMode === 'emoji' && Boolean(existingIconUrl)) ||
          (iconMode === 'asset' && Boolean(iconAssetDataUrl || iconSvgText || removeIconAsset || (iconAssetPreview && iconAssetPreview !== existingIconUrl)))
        );

    return (
      form.name !== baseApp.name ||
      form.slug !== baseApp.slug ||
      form.description !== baseApp.description ||
      form.long_description !== baseApp.long_description ||
      form.icon !== baseApp.icon ||
      form.target_url !== baseApp.target_url ||
      form.sort_order !== baseApp.sort_order ||
      form.mode !== baseApp.mode ||
      form.sso_endpoint !== baseApp.sso_endpoint ||
      form.sso_method !== baseApp.sso_method ||
      !equalTags ||
      iconDirty
    );
  }, [editing, form, iconMode, iconAssetDataUrl, iconSvgText, iconAssetPreview, removeIconAsset]);

  useEffect(() => {
    if (editing === null || confirmDialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (appModalDirty) {
        openConfirm({
          title: t.closeWithoutSavingTitle,
          message: t.closeWithoutSavingAppMessage,
          confirmLabel: t.close,
          onConfirm: async () => close(),
        });
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, appModalDirty, confirmDialog]);

  useEffect(() => {
    if (!pendingGroupAssignApp || confirmDialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (groupAssignSelection.length > 0) {
        openConfirm({
          title: t.closeWithoutSavingTitle,
          message: t.closeWithoutSavingGroupsMessage,
          confirmLabel: t.close,
          onConfirm: async () => closeGroupAssignmentModal(),
        });
        return;
      }
      closeGroupAssignmentModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingGroupAssignApp, groupAssignSelection.length, confirmDialog]);

  const applyIconAssetFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setIconMode('asset');
      setIconAssetDataUrl(dataUrl);
      setIconAssetPreview(dataUrl);
      setIconSvgText('');
      setRemoveIconAsset(false);
    };
    reader.readAsDataURL(file);
  };

  const handleIconFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) applyIconAssetFile(file);
    event.target.value = '';
  };

  const handleIconPaste = (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        applyIconAssetFile(file);
        event.preventDefault();
      }
      return;
    }

    const pastedText = event.clipboardData?.getData('text/plain') || '';
    if (/<svg[\s>]/i.test(pastedText)) {
      const svg = pastedText.trim();
      setIconMode('asset');
      setIconSvgText(svg);
      setIconAssetDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      setIconAssetPreview(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      setRemoveIconAsset(false);
      event.preventDefault();
    }
  };

  const handleSave = async () => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    setSaving(true);
    try {
      if (iconMode === 'asset' && !iconAssetDataUrl && !iconSvgText && !iconAssetPreview && editing === 'new') {
        throw new Error(a.iconAssetRequired);
      }
      if (form.mode === 'entra-app' && !form.sso_endpoint.trim()) {
        throw new Error(a.enterApplicationId);
      }

      const iconPayload = iconMode === 'asset'
        ? {
            iconDataUrl: iconAssetDataUrl || undefined,
            iconSvgText: iconSvgText || undefined,
            removeIconAsset: removeIconAsset || undefined,
          }
        : {
            removeIconAsset: editing !== 'new' && Boolean(editing.iconUrl) ? true : undefined,
          };

      if (editing === 'new') {
        const res = await api.post('/apps', {
          ...form,
          ...iconPayload,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
          groupIds: includeDefaultGroup
            ? [DEFAULT_GROUP_ID, ...clonedGroupIds]
            : clonedGroupIds,
        });
        loadApps();
        close();
        pushNotice('success', a.appCreated);
        if (!includeDefaultGroup) {
          openGroupAssignmentModal({
            ...res.data?.app,
            defaultIncluded: false,
          }, clonedGroupIds);
        }
      } else {
        await api.put(`/apps/${editing.id}`, {
          ...form,
          ...iconPayload,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
        });
        loadApps();
        close();
        pushNotice('success', a.appUpdated);
      }
    } catch (err) {
      pushNotice('error', err.response?.data?.error || err.message || t.errorSaving);
    }
    setSaving(false);
  };

  const handleDelete = async (app) => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    openConfirm({
      title: a.deleteTitle.replace('{name}', app.name),
      message: a.deleteMessage,
      confirmLabel: t.delete,
      onConfirm: async () => {
        try {
          await api.delete(`/apps/${app.id}`);
          loadApps();
          pushNotice('success', a.appDeleted.replace('{name}', app.name));
        } catch (err) {
          pushNotice('error', err.response?.data?.error || t.errorSaving);
        }
      },
    });
  };

  const handleToggle = async (app) => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    try {
      await api.put(`/apps/${app.id}`, { is_active: app.is_active ? 0 : 1 });
      loadApps();
    } catch (err) {
      pushNotice('error', err.response?.data?.error || t.errorSaving);
    }
  };

  const handleRestoreDefaults = async () => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    openConfirm({
      title: a.restoreDemoTitle,
      message: a.restoreDemoMessage,
      confirmLabel: a.restoreDemoConfirm,
      onConfirm: async () => {
        setRestoringDefaults(true);
        try {
          const res = await api.post('/apps/restore-defaults');
          loadApps();
          pushNotice('success', `${res.data.message}. ${a.restoreDemoSummary.replace('{created}', res.data.created).replace('{updated}', res.data.updated)}`);
        } catch (err) {
          pushNotice('error', err.response?.data?.error || t.errorSaving);
        } finally {
          setRestoringDefaults(false);
        }
      },
    });
  };

  const groupLabel = (group) => group.entra_display_name || group.name;
  const groupMatchesSearch = (group) => {
    if (!groupAssignSearch.trim()) return true;
    const q = groupAssignSearch.toLowerCase();
    return groupLabel(group).toLowerCase().includes(q) || (group.description || '').toLowerCase().includes(q) || (group.source || '').toLowerCase().includes(q);
  };
  const filteredGroups = groups.filter(groupMatchesSearch);
  const allTags = useMemo(() => {
    const tagSet = new Set();
    apps.forEach((app) => {
      (Array.isArray(app.tags) ? app.tags : []).forEach((tag) => {
        const normalized = (tag ?? '').toString().trim().toLowerCase();
        if (normalized) tagSet.add(normalized);
      });
    });
    return [...tagSet].sort();
  }, [apps]);
  const toggleGroupAssignment = (groupId) => {
    setGroupAssignSelection((prev) => (
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    ));
  };
  const modeVisibility = branding || {
    showSharedCookieMode: true,
    showRedirectSsoMode: true,
    showEntraAppMode: true,
  };
  const modeOptions = [
    { value: 'redirect-plain', label: a.externalLink, active: 'bg-dark text-white border-dark', alwaysVisible: true },
    { value: 'shared-cookie', label: a.sharedCookie, active: 'bg-emerald-600 text-white border-emerald-600', visible: modeVisibility.showSharedCookieMode !== false },
    { value: 'redirect', label: a.redirectSso, active: 'bg-blue-600 text-white border-blue-600', visible: modeVisibility.showRedirectSsoMode !== false },
    { value: 'entra-app', label: a.entraApp, active: 'bg-violet-600 text-white border-violet-600', visible: modeVisibility.showEntraAppMode !== false },
  ];
  const visibleModeOptions = modeOptions.filter((opt) => opt.alwaysVisible || opt.visible);
  const visibleModeFilterOptions = [
    { value: 'all', label: a.allConnections, active: 'bg-gray-900 text-white border-gray-900' },
    ...visibleModeOptions,
  ];
  const currentModeFilterOption = visibleModeFilterOptions.find((opt) => opt.value === appModeFilter) || visibleModeFilterOptions[0];
  const currentModeOption = modeOptions.find((opt) => opt.value === form.mode);
  const handleModeChange = (nextMode) => {
    if (nextMode === 'entra-app') {
      setForm((prev) => ({
        ...prev,
        mode: nextMode,
        sso_endpoint: prev.sso_endpoint && prev.sso_endpoint !== '/sso' ? prev.sso_endpoint : '',
      }));
      return;
    }
    if (nextMode === 'redirect' && !form.sso_endpoint) {
      setForm((prev) => ({ ...prev, mode: nextMode, sso_endpoint: '/sso' }));
      return;
    }
    setForm((prev) => ({ ...prev, mode: nextMode }));
  };
  const filteredApps = useMemo(() => {
    const q = appSearch.toLowerCase().trim();
    const filtered = apps.filter((app) => {
      if (appModeFilter !== 'all' && app.mode !== appModeFilter) return false;
      if (!q) return true;
      const tags = Array.isArray(app.tags) ? app.tags : [];
      return (
        app.name?.toLowerCase().includes(q) ||
        app.slug?.toLowerCase().includes(q) ||
        app.description?.toLowerCase().includes(q) ||
        app.target_url?.toLowerCase().includes(q) ||
        app.mode?.toLowerCase().includes(q) ||
        tags.some((tag) => (tag || '').toString().toLowerCase().includes(q))
      );
    });

    const compareText = (a, b, key) => (a?.[key] || '').toString().localeCompare((b?.[key] || '').toString(), 'it', { sensitivity: 'base' });
    const compareNumber = (a, b, key) => (Number(a?.[key] || 0) - Number(b?.[key] || 0));
    const direction = appSort.direction === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      let result = 0;
      switch (appSort.key) {
        case 'name':
          result = compareText(a, b, 'name');
          break;
        case 'slug':
          result = compareText(a, b, 'slug');
          break;
        case 'target_url':
          result = compareText(a, b, 'target_url');
          break;
        case 'mode':
          result = compareText(a, b, 'mode');
          break;
        case 'is_active':
          result = Number(Boolean(a.is_active)) - Number(Boolean(b.is_active));
          break;
        case 'sort_order':
        default:
          result = compareNumber(a, b, 'sort_order') || compareText(a, b, 'name');
          break;
      }

      if (result === 0 && appSort.key !== 'name') {
        result = compareText(a, b, 'name');
      }
      return result * direction;
    });
  }, [apps, appSearch, appModeFilter, appSort]);

  const openGroupAssignmentModal = (app, selectedIds = []) => {
    setPendingGroupAssignApp(app);
    setGroupAssignSelection(selectedIds);
    setGroupAssignSearch('');
  };

  const jumpToGroupsForApp = (app) => {
    const query = [app.name, app.slug].filter(Boolean).join(' ');
    navigate('/admin/groups', {
      state: {
        groupSearch: query,
      },
    });
  };

  const toggleSort = (key) => {
    setAppSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortIndicator = (key) => {
    if (appSort.key !== key) return null;
    return appSort.direction === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5" />
      : <ChevronDown className="w-3.5 h-3.5" />;
  };

  const closeGroupAssignmentModal = () => {
    setPendingGroupAssignApp(null);
    setGroupAssignSelection([]);
    setGroupAssignSearch('');
    setAssigningGroups(false);
  };

  const saveGroupAssignment = async () => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    if (!pendingGroupAssignApp || groupAssignSelection.length === 0) {
      closeGroupAssignmentModal();
      return;
    }

    setAssigningGroups(true);
    try {
      const res = await api.post(`/apps/${pendingGroupAssignApp.id}/groups`, { groupIds: groupAssignSelection });
      loadApps();
      closeGroupAssignmentModal();
      pushNotice(
        'success',
        res.data?.message || a.assignedToGroups.replace('{name}', pendingGroupAssignApp.name).replace('{count}', groupAssignSelection.length)
      );
    } catch (err) {
      pushNotice('error', err.response?.data?.error || a.groupAssignmentError);
    } finally {
      setAssigningGroups(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">{ui.admin.apps.pageTitle}</h1>
          <p className="text-gray-500 mt-1">{ui.admin.apps.subtitle}</p>
        </div>
        <button
          onClick={openNew}
          disabled={!canEdit}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed max-sm:w-full"
        >
          <Plus className="w-4 h-4" />
          {ui.admin.apps.new}
        </button>
      </div>

      {!canEdit && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {ui.admin.apps.readOnly}
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

      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <ClearableSearchField
              value={appSearch}
              onChange={setAppSearch}
              placeholder={ui.admin.apps.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
            />
          </div>
          <div className="relative" ref={modeFilterRef}>
            <button
              type="button"
              onClick={() => setModeFilterOpen((prev) => !prev)}
              className="relative inline-flex min-w-[220px] items-center w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm text-left text-gray-600 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <span className="truncate">{currentModeFilterOption.label}</span>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </button>

            {modeFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 min-w-[260px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
                <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  {ui.admin.apps.modeFilter}
                </div>
                <div className="py-1">
                  {visibleModeFilterOptions.map((opt) => {
                    const selected = appModeFilter === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setAppModeFilter(opt.value);
                          setModeFilterOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          selected ? 'bg-gray-50 text-dark' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            selected ? 'border-dark bg-dark text-white' : 'border-gray-300 bg-white text-transparent'
                          }`}
                          aria-hidden="true"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="flex-1">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="text-xs text-gray-400">
            {filteredApps.length} {ui.nav.apps.toLowerCase()} {t.of} {apps.length}
          </div>
        </div>
      </div>

      {/* App table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-gray-100" />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark">
                    <span>{ui.nav.apps}</span> {sortIndicator('name')}
                    </button>
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('slug')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark">
                      <span>{a.sortBySlug}</span> {sortIndicator('slug')}
                    </button>
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('target_url')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark">
                      <span>{a.sortByTargetUrl}</span> {sortIndicator('target_url')}
                    </button>
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('mode')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark">
                    <span>{ui.admin.common.appMode}</span> {sortIndicator('mode')}
                    </button>
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('is_active')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark">
                    <span>{ui.admin.common.active}</span> {sortIndicator('is_active')}
                    </button>
                  </th>
                <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredApps.map((app) => (
                <tr key={app.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <AppIcon app={app} className="w-8 h-8" textClassName="text-2xl" />
                      <span className="font-semibold text-dark">{app.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{app.slug}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-[200px]">{app.target_url}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      app.mode === 'redirect' ? 'bg-blue-100 text-blue-700'
                        : app.mode === 'shared-cookie' ? 'bg-emerald-100 text-emerald-700'
                        : app.mode === 'entra-app' ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {app.mode === 'redirect' ? t.redirectSso : app.mode === 'shared-cookie' ? t.sharedCookie : app.mode === 'entra-app' ? t.entraApp : t.link}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleToggle(app)}
                      disabled={!canEdit}
                      className={`w-10 h-6 rounded-full transition-colors relative inline-flex items-center ${
                        app.is_active ? 'bg-accent' : 'bg-gray-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span
                        className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          app.is_active ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => jumpToGroupsForApp(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={a.goToGroupsSearch}
                      >
                        <Users className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 hover:text-dark hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/60">
            <button
              onClick={handleRestoreDefaults}
              disabled={restoringDefaults || !canEdit}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${restoringDefaults ? 'animate-spin' : ''}`} />
              {ui.admin.apps.restoreDemoApps}
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {editing !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-6xl shadow-xl my-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-dark">
                {editing === 'new' ? ui.admin.apps.newApp : ui.admin.apps.editApp}
              </h2>
              <button onClick={close} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">{a.icon}</label>
                    <p className="text-xs text-gray-400">
                      {a.iconHelp}
                    </p>
                  </div>
                  <div className="flex items-center rounded-xl border border-gray-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIconMode('emoji');
                        setIconAssetDataUrl('');
                        setIconAssetPreview('');
                        setIconSvgText('');
                        setRemoveIconAsset(Boolean(editing && editing !== 'new' && editing.iconUrl));
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        iconMode === 'emoji' ? 'bg-dark text-white' : 'text-gray-500 hover:text-dark'
                      }`}
                    >
                      {a.useEmoji}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIconMode('asset')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        iconMode === 'asset' ? 'bg-dark text-white' : 'text-gray-500 hover:text-dark'
                      }`}
                    >
                      {a.useImage}
                    </button>
                  </div>
                </div>

                {iconMode === 'emoji' ? (
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] items-center">
                    <div className="w-16 h-16 rounded-2xl border border-gray-200 bg-white flex items-center justify-center">
                      <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">{a.emojiOrSymbol}</label>
                      <input
                        type="text"
                        value={form.icon}
                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                        placeholder="📦"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[180px_1fr] items-start">
                    <div
                      role="button"
                      tabIndex={0}
                      onPaste={handleIconPaste}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer?.files?.[0];
                        if (file) applyIconAssetFile(file);
                      }}
                      onClick={() => iconFileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          iconFileInputRef.current?.click();
                        }
                      }}
                      className="rounded-2xl border-2 border-dashed border-gray-200 bg-white px-4 py-4 text-center cursor-pointer hover:border-accent transition-colors outline-none min-h-[180px] flex flex-col items-center justify-center gap-3"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center overflow-hidden">
                        {iconAssetPreview ? (
                          <img src={iconAssetPreview} alt={a.uploadedIconPreview} className="w-full h-full object-contain" />
                        ) : (
                          <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-dark">{a.iconUploadCta}</p>
                        <p className="text-xs text-gray-400">{a.iconUploadHint}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <input
                        ref={iconFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
                        onChange={handleIconFileChange}
                        className="hidden"
                      />

                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">{a.pasteSvgLabel}</label>
                        <textarea
                          value={iconSvgText}
                          onChange={(e) => {
                            const svg = e.target.value;
                            setIconSvgText(svg);
                            setIconAssetPreview(/<svg[\s>]/i.test(svg)
                              ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`
                              : '');
                            setIconAssetDataUrl('');
                            setRemoveIconAsset(false);
                          }}
                          placeholder={a.svgPlaceholder}
                          rows={4}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                        />
                      </div>

                      {iconAssetPreview && (
                        <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
                          <span>{a.uploadedIconPreview}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setIconAssetDataUrl('');
                              setIconAssetPreview('');
                              setIconSvgText('');
                              setRemoveIconAsset(true);
                            }}
                            className="text-red-600 hover:text-red-700 font-semibold"
                          >
                            {a.removeImage}
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-gray-400">
                        {a.iconPasteHint}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.nameLabel}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={a.nameExample}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.slugLabel}</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  placeholder={a.slugExample}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.descriptionLabel}</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={a.descriptionPlaceholder}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.targetUrlLabel}</label>
                <input
                  type="url"
                  value={form.target_url}
                  onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                  placeholder={a.targetUrlExample}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

                {editing === 'new' && (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDefaultGroup}
                        onChange={(e) => setIncludeDefaultGroup(e.target.checked)}
                        className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-dark">{a.addToDefaultGroup}</span>
                          <span className="text-[10px] bg-accent/20 text-dark px-1.5 py-0.5 rounded font-medium">
                            {ui.common.defaultRecommended}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {a.defaultGroupIncludedHelp}
                        </p>
                      </div>
                    </label>
                  </div>
                )}

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.connection}</label>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {visibleModeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleModeChange(opt.value)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        form.mode === opt.value ? opt.active : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {currentModeOption && !visibleModeOptions.some((opt) => opt.value === form.mode) && (
                  <p className="text-xs text-gray-400 mt-2">
                    {a.currentMode}: <span className="font-semibold text-gray-500">{currentModeOption.label}</span>. {a.currentModeHelp}
                  </p>
                )}
              </div>

              {form.mode === 'entra-app' && (
                <div className="p-3 bg-violet-50 rounded-xl">
                    <label className="block text-sm font-medium text-violet-700 mb-1">{ui.admin.apps.entraApplicationId}</label>
                  <input
                    type="text"
                    value={form.sso_endpoint}
                    onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                    placeholder={ui.admin.apps.enterApplicationId}
                    className="w-full px-3 py-2 border border-violet-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                  <p className="text-xs text-violet-500 mt-1">
                    {ui.admin.apps.applicationIdHelp}
                  </p>
                </div>
              )}

              {form.mode === 'redirect' && (
                <div className="grid grid-cols-[1fr_auto] gap-4 p-3 bg-blue-50 rounded-xl">
                    <div>
                    <label className="block text-sm font-medium text-blue-700 mb-1">{a.ssoEndpointLabel}</label>
                    <input
                      type="text"
                      value={form.sso_endpoint}
                      onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                      placeholder="/sso"
                      className="w-full px-3 py-2 border border-blue-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    </div>
                    <div>
                    <label className="block text-sm font-medium text-blue-700 mb-1">{a.ssoMethodLabel}</label>
                    <select
                      value={form.sso_method}
                      onChange={(e) => setForm({ ...form, sso_method: e.target.value })}
                      className="px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.tagsLabel}</label>
                  <TagInput
                    value={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    suggestions={allTags}
                    placeholder={a.tagsPlaceholder}
                    suggestionsLabel={a.tagSuggestionsTitle}
                    availableTagsLabel={a.availableTagsTitle}
                    useSuggestionLabel={a.useExistingTag}
                  />
                  <p className="text-xs text-gray-400 mt-1">{ui.admin.apps.enterToAddTags}</p>
                </div>

                <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.sortOrderLabel}</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{a.longDescriptionLabel}</label>
                <textarea
                  value={form.long_description}
                  onChange={(e) => setForm({ ...form, long_description: e.target.value })}
                  placeholder={a.longDescriptionPlaceholder}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">{a.longDescriptionHelp}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
              {editing !== 'new' && (
              <button
                onClick={openClone}
                disabled={cloning || !canEdit}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-violet-700 hover:text-violet-800 hover:bg-violet-50 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy className="w-4 h-4" />
                  {cloning ? a.duplicating : a.duplicate}
              </button>
              )}
              <button
                onClick={close}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-dark hover:bg-gray-100 rounded-xl transition-colors"
              >
                {ui.common.cancel}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.slug || !form.target_url}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {saving ? a.saving : a.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingGroupAssignApp && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 px-4 py-4">
          <div className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-gray-100">
            <button
              type="button"
              onClick={() => {
                if (groupAssignSelection.length > 0) {
                  openConfirm({
                    title: t.closeWithoutSavingTitle,
                    message: t.closeWithoutSavingGroupsMessage,
                    confirmLabel: t.close,
                    onConfirm: async () => closeGroupAssignmentModal(),
                  });
                  return;
                }
                closeGroupAssignmentModal();
              }}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-dark hover:bg-gray-100 rounded-lg transition-colors"
              aria-label={a.closeGroupSelection}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6 sm:p-8">
              <div className="mb-6">
                <h2 className="text-2xl font-extrabold text-dark">{a.addToGroupsTitle}</h2>
                <p className="text-gray-500 mt-1">
                  {a.addToGroupsHelp}
                </p>
                {pendingGroupAssignApp?.defaultIncluded ? (
                  <p className="text-xs text-gray-400 mt-2">
                    {a.defaultGroupAlreadyCreated}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-2">
                    {a.defaultGroupMissingHelp}
                  </p>
                )}
              </div>

              <div className="mb-4">
                <ClearableSearchField
                  value={groupAssignSearch}
                  onChange={setGroupAssignSearch}
                  placeholder={ui.admin.apps.searchGroupsPlaceholder}
                  clearLabel={ui.common.clearSearch}
                />
                <div className="mt-2 text-xs text-gray-400 flex items-center justify-between gap-3">
                  <span>{groupAssignSelection.length} {a.selectedGroupSummary}</span>
                  <span>{filteredGroups.length} {t.groups}</span>
                </div>
              </div>

              {groupsLoading ? (
                <div className="animate-pulse grid gap-2 sm:grid-cols-2">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-16 rounded-xl bg-white border border-gray-100" />
                  ))}
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="text-sm text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 px-3 py-4">
                  {ui.admin.apps.noGroupsFound}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 max-h-[52vh] overflow-y-auto pr-1">
                  {filteredGroups.map((group) => {
                    const selected = groupAssignSelection.includes(group.id);
                    const groupSourceLabel = group.source === 'entra' ? 'Entra' : 'Locale';
                    return (
                      <label
                        key={group.id}
                        className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                          selected ? 'border-accent bg-accent/5' : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleGroupAssignment(group.id)}
                          className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-dark truncate">{groupLabel(group)}</span>
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                              {groupSourceLabel}
                            </span>
                            {group.id === DEFAULT_GROUP_ID && (
                              <span className="text-[10px] bg-accent/30 text-dark px-1.5 py-0.5 rounded font-medium">
                                default
                              </span>
                            )}
                          </div>
                          {group.description && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">{group.description}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeGroupAssignmentModal}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-dark hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Salta
                </button>
                <button
                  type="button"
                  onClick={saveGroupAssignment}
                  disabled={assigningGroups || groupAssignSelection.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  {assigningGroups ? t.saving : ui.admin.apps.addSelectedGroups}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || ui.common.confirm}
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
