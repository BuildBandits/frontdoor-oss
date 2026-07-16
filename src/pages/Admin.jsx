import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, Save, Copy, Users, ChevronDown, ChevronUp, Check, Filter, Settings, Tag } from 'lucide-react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import TagInput from '../components/TagInput';
import AppIcon from '../components/AppIcon';
import PageNotice from '../components/PageNotice';
import TopToastNotice from '../components/TopToastNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
import PaginationControls from '../components/PaginationControls';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import { normalizeEntraApplicationId } from '../../shared/entra.js';
import { normalizeAppSlug, suggestAppSlug } from '../../shared/appSlug.js';
import PluginSurface from '../pluginHost/PluginSurface';
import { PLUGIN_SURFACES } from '../pluginHost/constants';

const emptyApp = { name: '', slug: '', description: '', long_description: '', icon: '📦', target_url: '', sort_order: 0, mode: 'redirect-plain', sso_endpoint: '', sso_method: 'GET', tags: [] };
const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';
const UNLABELED_TAG_FILTER = '__frontdoor_unlabeled__';

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
  const [groupAssignInitialSelection, setGroupAssignInitialSelection] = useState([]);
  const [groupAssignAllowNoChanges, setGroupAssignAllowNoChanges] = useState(false);
  const [assigningGroups, setAssigningGroups] = useState(false);
  const [appSearch, setAppSearch] = useState('');
  const [appModeFilter, setAppModeFilter] = useState('all');
  const [showOnlyOrphanApps, setShowOnlyOrphanApps] = useState(false);
  const [modeFilterOpen, setModeFilterOpen] = useState(false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [selectedTagFilters, setSelectedTagFilters] = useState([]);
  const [tagFilterSearch, setTagFilterSearch] = useState('');
  const [appSort, setAppSort] = useState({ key: 'sort_order', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pageNotice, setPageNotice] = useState(null);
  const [appSaveNotice, setAppSaveNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const iconFileInputRef = useRef(null);
  const slugAutoFillRef = useRef(false);
  const modeFilterRef = useRef(null);
  const tagFilterRef = useRef(null);
  const tagFilterSearchRef = useRef(null);
  const tagFilterItemRefs = useRef([]);
  const canEdit = user?.role !== 'admin_readonly';
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const filterButtonMinWidth = 'min-w-[260px]';

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

  useEffect(() => {
    if (!tagFilterOpen) return undefined;
    const onMouseDown = (event) => {
      if (tagFilterRef.current && !tagFilterRef.current.contains(event.target)) {
        setTagFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [tagFilterOpen]);

  useEffect(() => {
    if (tagFilterOpen) return;
    setTagFilterSearch('');
  }, [tagFilterOpen]);

  const pushNotice = (type, message) => setPageNotice({ type, message });
  const pushAppSaveNotice = (type, message) => {
    const noticeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now());
    setAppSaveNotice({ id: noticeId, type, message });
  };
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
  const hasPendingGroupAssignmentChanges = groupAssignSelection.length !== groupAssignInitialSelection.length
    || groupAssignSelection.some((groupId) => !groupAssignInitialSelection.includes(groupId));

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
    setAppSaveNotice(null);
    slugAutoFillRef.current = false;
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
    setAppSaveNotice(null);
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

  const populateClonedApp = (cloned, { includeDefaultGroup: includeDefaultGroupDefault = false } = {}) => {
    setAppSaveNotice(null);
    slugAutoFillRef.current = false;
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
    setIncludeDefaultGroup(includeDefaultGroupDefault);
    setClonedGroupIds(Array.isArray(cloned.groupIds) ? cloned.groupIds : []);
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

      populateClonedApp(cloned, { includeDefaultGroup: false });
      pushNotice('success', a.duplicateNotice);
    } catch (err) {
      pushNotice('error', err.response?.data?.error || err.message || t.cloneFailed);
    }
    setCloning(false);
  };

  const duplicateApp = async (app) => {
    if (!canEdit || !app?.id) return;

    setCloning(true);
    try {
      const res = await api.post(`/apps/${app.id}/clone`);
      const cloned = res.data?.app;
      if (!cloned) throw new Error(t.cloneDataMissing);

      populateClonedApp(cloned, { includeDefaultGroup: false });
      pushNotice('success', a.duplicateNotice);
    } catch (err) {
      pushNotice('error', err.response?.data?.error || err.message || t.cloneFailed);
    }
    setCloning(false);
  };

  const close = () => {
    setAppSaveNotice(null);
    slugAutoFillRef.current = false;
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
    if (editing !== 'new' || slugAutoFillRef.current) return;
    const suggestedSlug = form.name.trim() ? suggestAppSlug(form.name) : '';
    setForm((current) => {
      if (current.slug === suggestedSlug) return current;
      if (current.name !== form.name) return current;
      return { ...current, slug: suggestedSlug };
    });
  }, [editing, form.name]);

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
      if (hasPendingGroupAssignmentChanges) {
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
  }, [pendingGroupAssignApp, hasPendingGroupAssignmentChanges, confirmDialog]);

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

  const saveApp = async ({ openGroupAssignmentAfterSave = false } = {}) => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    const normalizedSlug = normalizeAppSlug(form.slug);
    if (normalizedSlug.length > 63) {
      pushAppSaveNotice('error', a.slugTooLong);
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

      const normalizedSsoEndpoint = form.mode === 'entra-app'
        ? normalizeEntraApplicationId(form.sso_endpoint)
        : form.sso_endpoint;

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
          slug: normalizedSlug,
          sso_endpoint: normalizedSsoEndpoint,
          ...iconPayload,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
          // When the clone flow skips the default group, create the app with no
          // memberships yet so the follow-up picker defines the real final set.
          groupIds: includeDefaultGroup
            ? [DEFAULT_GROUP_ID, ...clonedGroupIds]
            : [],
        });
        loadApps();
        close();
        pushAppSaveNotice('success', a.appCreated);
        if (!includeDefaultGroup) {
          openGroupAssignmentModal({
            ...res.data?.app,
            defaultIncluded: false,
          }, clonedGroupIds, false, true);
        }
      } else {
        await api.put(`/apps/${editing.id}`, {
          ...form,
          slug: normalizedSlug,
          sso_endpoint: normalizedSsoEndpoint,
          ...iconPayload,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
        });
        const savedApp = {
          ...editing,
          ...form,
          slug: normalizedSlug,
          sso_endpoint: normalizedSsoEndpoint,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
          groupIds: Array.isArray(editing.groupIds) ? editing.groupIds : [],
        };
        loadApps();
        if (openGroupAssignmentAfterSave) {
          close();
          pushAppSaveNotice('success', a.appUpdated);
          openGroupAssignmentModal(
            savedApp,
            savedApp.groupIds,
            savedApp.groupIds.includes(DEFAULT_GROUP_ID),
            true
          );
        } else {
          close();
          pushAppSaveNotice('success', a.appUpdated);
        }
      }
    } catch (err) {
      pushAppSaveNotice('error', err.response?.data?.error || err.message || t.errorSaving);
    }
    setSaving(false);
  };

  const handleSave = async () => {
    await saveApp();
  };

  const handleSaveAndAssignGroups = async () => {
    await saveApp({ openGroupAssignmentAfterSave: true });
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

  const groupLabel = (group) => group.entra_display_name || group.name;
  const groupMatchesSearch = (group) => {
    if (!groupAssignSearch.trim()) return true;
    const q = groupAssignSearch.toLowerCase();
    return groupLabel(group).toLowerCase().includes(q) || (group.description || '').toLowerCase().includes(q) || (group.source || '').toLowerCase().includes(q);
  };
  const filteredGroups = groups.filter(groupMatchesSearch);
  const hasGroupAssignSearch = groupAssignSearch.trim().length > 0;
  const selectVisibleGroups = () => {
    if (filteredGroups.length === 0) return;
    setGroupAssignSelection((prev) => Array.from(new Set([...prev, ...filteredGroups.map((group) => group.id)])));
  };
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
  useEffect(() => {
    setSelectedTagFilters((prev) => prev.filter((tag) => tag === UNLABELED_TAG_FILTER || allTags.includes(tag)));
  }, [allTags]);
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
    { value: 'internal-link', label: a.internalLink, active: 'bg-emerald-600 text-white border-emerald-600', alwaysVisible: true },
    { value: 'shared-cookie', label: a.sharedCookie, active: 'bg-accent text-dark dark:text-gray-100 border-accent', visible: modeVisibility.showSharedCookieMode !== false },
    { value: 'redirect', label: a.redirectSso, active: 'bg-blue-600 text-white border-blue-600', visible: modeVisibility.showRedirectSsoMode !== false },
    { value: 'entra-app', label: a.entraApp, active: 'bg-violet-600 text-white border-violet-600', visible: modeVisibility.showEntraAppMode !== false },
  ];
  const visibleModeOptions = modeOptions.filter((opt) => opt.alwaysVisible || opt.visible);
  const visibleModeFilterOptions = [
    { value: 'all', label: a.allConnections, active: 'bg-gray-900 dark:bg-gray-100 text-white border-gray-900' },
    ...visibleModeOptions,
  ];
  const currentModeFilterOption = visibleModeFilterOptions.find((opt) => opt.value === appModeFilter) || visibleModeFilterOptions[0];
  const hasTagFilters = selectedTagFilters.length > 0;
  const currentModeOption = modeOptions.find((opt) => opt.value === form.mode);
  useEffect(() => {
    setPage(1);
  }, [appSearch, appModeFilter, showOnlyOrphanApps, selectedTagFilters, appSort, pageSize]);
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
  const toggleTagFilter = (tag) => {
    const normalizedTag = tag === UNLABELED_TAG_FILTER ? UNLABELED_TAG_FILTER : (tag ?? '').toString().trim().toLowerCase();
    if (!normalizedTag) return;
    setSelectedTagFilters((prev) => (
      prev.includes(normalizedTag)
        ? prev.filter((value) => value !== normalizedTag)
        : [...prev, normalizedTag]
    ));
  };
  const filteredTags = useMemo(() => {
    const q = tagFilterSearch.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((tag) => tag.includes(q));
  }, [allTags, tagFilterSearch]);
  const tagFilterOptionCount = (hasTagFilters ? 1 : 0) + 2 + filteredTags.length;
  const focusTagFilterItem = (index) => {
    tagFilterItemRefs.current[index]?.focus?.();
  };
  const handleTagFilterSearchKeyDown = (event) => {
    if (tagFilterOptionCount === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusTagFilterItem(0);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusTagFilterItem(Math.max(0, tagFilterOptionCount - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusTagFilterItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusTagFilterItem(Math.max(0, tagFilterOptionCount - 1));
    }
  };
  const handleTagFilterItemKeyDown = (event, index) => {
    if (tagFilterOptionCount === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusTagFilterItem((index + 1) % tagFilterOptionCount);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusTagFilterItem((index - 1 + tagFilterOptionCount) % tagFilterOptionCount);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusTagFilterItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusTagFilterItem(Math.max(0, tagFilterOptionCount - 1));
    }
  };
  const filteredApps = useMemo(() => {
    const q = appSearch.toLowerCase().trim();
    const filtered = apps.filter((app) => {
      if (showOnlyOrphanApps && Number(app.group_count || 0) !== 0) return false;
      if (appModeFilter !== 'all' && app.mode !== appModeFilter) return false;
      const tags = Array.isArray(app.tags)
        ? app.tags.map((tag) => (tag ?? '').toString().trim().toLowerCase()).filter(Boolean)
        : [];
      if (selectedTagFilters.length > 0) {
        const matchesTagFilter = selectedTagFilters.some((selectedTag) => (
          selectedTag === UNLABELED_TAG_FILTER
            ? tags.length === 0
            : tags.includes(selectedTag)
        ));
        if (!matchesTagFilter) return false;
      }
      if (!q) return true;
      return (
        app.name?.toLowerCase().includes(q) ||
        app.slug?.toLowerCase().includes(q) ||
        app.description?.toLowerCase().includes(q) ||
        app.target_url?.toLowerCase().includes(q) ||
        app.mode?.toLowerCase().includes(q) ||
        tags.some((tag) => tag.includes(q))
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
  }, [apps, appSearch, appModeFilter, appSort, showOnlyOrphanApps, selectedTagFilters]);
  const pagination = useMemo(() => ({
    page,
    pages: Math.max(1, Math.ceil(filteredApps.length / pageSize)),
    total: filteredApps.length,
  }), [filteredApps.length, page, pageSize]);
  const paginatedApps = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredApps.slice(start, start + pageSize);
  }, [filteredApps, page, pageSize]);
  const orphanApps = useMemo(
    () => apps.filter((app) => Number(app.group_count || 0) === 0),
    [apps],
  );

  useEffect(() => {
    if (showOnlyOrphanApps && orphanApps.length === 0) {
      setShowOnlyOrphanApps(false);
    }
  }, [showOnlyOrphanApps, orphanApps.length]);

  useEffect(() => {
    if (page > pagination.pages) {
      setPage(pagination.pages);
    }
  }, [page, pagination.pages]);

  const openGroupAssignmentModal = (app, selectedIds = [], defaultIncluded = false, allowNoChanges = false) => {
    const normalizedSelectedIds = [...new Set(selectedIds.filter(Boolean))];
    setPendingGroupAssignApp({ ...app, defaultIncluded });
    setGroupAssignSelection(normalizedSelectedIds);
    setGroupAssignInitialSelection(normalizedSelectedIds);
    setGroupAssignSearch('');
    setGroupAssignAllowNoChanges(allowNoChanges);
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
    setGroupAssignInitialSelection([]);
    setGroupAssignSearch('');
    setGroupAssignAllowNoChanges(false);
    setAssigningGroups(false);
  };

  const saveGroupAssignment = async () => {
    if (!canEdit) {
      pushNotice('error', t.readOnly);
      return;
    }
    if (!pendingGroupAssignApp) {
      closeGroupAssignmentModal();
      return;
    }
    if (!hasPendingGroupAssignmentChanges && !groupAssignAllowNoChanges) {
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
        a.assignedToGroups
          .replace('{name}', pendingGroupAssignApp.name)
          .replace('{added}', String(res.data?.added ?? 0))
          .replace('{removed}', String(res.data?.removed ?? 0))
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
          <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.apps.pageTitle}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.admin.apps.subtitle}</p>
        </div>
        <button
          onClick={openNew}
          disabled={!canEdit}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed max-sm:w-full"
        >
          <Plus className="w-4 h-4" />
          {ui.admin.apps.new}
        </button>
        <PluginSurface surface={PLUGIN_SURFACES.ADMIN_HEADER_ACTIONS} variant="toolbar" className="justify-end max-sm:w-full" />
      </div>

      {!canEdit && (
        <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
          {ui.admin.apps.readOnly}
        </div>
      )}

      <TopToastNotice
        notice={pageNotice}
        onClose={() => setPageNotice(null)}
        closeLabel={ui.common.closeNotice}
        positionClassName="top-4 sm:top-6"
      />

      <TopToastNotice
        key={appSaveNotice?.id ?? 'app-save-notice'}
        notice={appSaveNotice}
        onClose={() => setAppSaveNotice(null)}
        closeLabel={ui.common.closeNotice}
        positionClassName="top-4 sm:top-6"
      />

      <PluginSurface surface={PLUGIN_SURFACES.ADMIN_PAGE_TOP} variant="stack" className="mb-6" />

      {orphanApps.length > 0 && (
        <div className="mb-6">
          <PageNotice
            type="warning"
            title={a.unassignedAppsTitle}
            message={a.unassignedAppsHelp}
            actionLabel={showOnlyOrphanApps ? a.showAllApps : a.showOnlyUnassigned}
            onAction={() => setShowOnlyOrphanApps((prev) => !prev)}
          >
            <div className="flex flex-wrap gap-2">
              {orphanApps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => openEdit(app)}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 dark:border-amber-800/70 bg-white dark:bg-gray-900 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/45"
                  title={a.unassignedAppOpen}
                >
                  <AppIcon app={app} className="h-4 w-4" textClassName="text-[10px]" />
                  <span className="max-w-[220px] truncate">{app.name}</span>
                </button>
              ))}
            </div>
          </PageNotice>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex flex-wrap items-center gap-3">
          <div className="flex-[1.1] min-w-[180px]">
            <ClearableSearchField
              value={appSearch}
              onChange={setAppSearch}
              placeholder={ui.admin.apps.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <div className="relative" ref={modeFilterRef}>
            <button
              type="button"
              onClick={() => setModeFilterOpen((prev) => !prev)}
            className={`relative inline-flex h-12 items-center w-full ${filterButtonMinWidth} pl-10 pr-10 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-left text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-900`}
            >
              <Settings className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="shrink-0 text-gray-400 dark:text-gray-500">{a.modeFilterShort}:</span>
                <span className="truncate">{currentModeFilterOption.label}</span>
              </span>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </button>

            {modeFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
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
                          selected ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="flex-1">{opt.label}</span>
                        {selected && <Check className="h-4 w-4 text-dark dark:text-gray-100" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="relative" ref={tagFilterRef}>
            <button
              type="button"
              onClick={() => setTagFilterOpen((prev) => !prev)}
              className={`relative inline-flex h-12 items-center w-full ${filterButtonMinWidth} pl-10 pr-10 border rounded-xl text-sm text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-900 ${
                hasTagFilters
                  ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/45 dark:text-violet-100'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300'
              }`}
              aria-haspopup="menu"
              aria-expanded={tagFilterOpen}
            >
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span
                className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden pr-12 whitespace-nowrap"
                style={{
                  WebkitMaskImage: 'linear-gradient(to right, #000 0, #000 calc(100% - 3rem), transparent 100%)',
                  maskImage: 'linear-gradient(to right, #000 0, #000 calc(100% - 3rem), transparent 100%)',
                }}
              >
                <span className="shrink-0 text-gray-400 dark:text-gray-500">{a.tagFilterLabel}:</span>
                <span className="min-w-0">
                  {selectedTagFilters.length === 0
                    ? a.tagFilterAll
                    : a.tagFilterSelected.replace('{count}', String(selectedTagFilters.length))}
                </span>
              </span>
              <span className="absolute right-10 top-1/2 -translate-y-1/2 inline-flex min-w-6 items-center justify-center rounded-full bg-white/80 dark:bg-gray-900/80 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-300">
                {selectedTagFilters.length}
              </span>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </button>

            {tagFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                <div className="border-b border-gray-100 dark:border-gray-800 px-3 py-3">
                  <ClearableSearchField
                    value={tagFilterSearch}
                    onChange={setTagFilterSearch}
                    placeholder={a.tagFilterSearchPlaceholder}
                    clearLabel={ui.common.clearSearch}
                    inputClassName="text-sm"
                    autoFocus
                    inputRef={tagFilterSearchRef}
                    onKeyDown={handleTagFilterSearchKeyDown}
                  />
                </div>
                <div className="max-h-72 overflow-auto py-1">
                  {hasTagFilters && (
                    <button
                      type="button"
                      onClick={() => setSelectedTagFilters([])}
                      ref={(node) => { tagFilterItemRefs.current[0] = node; }}
                      onKeyDown={(event) => handleTagFilterItemKeyDown(event, 0)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors text-violet-700 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                    >
                      <span className="flex h-4 w-4 items-center justify-center rounded border border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100" aria-hidden="true">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="flex-1 font-semibold">{a.clearTagFilters}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedTagFilters([])}
                    ref={(node) => { tagFilterItemRefs.current[hasTagFilters ? 1 : 0] = node; }}
                    onKeyDown={(event) => handleTagFilterItemKeyDown(event, hasTagFilters ? 1 : 0)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      !hasTagFilters
                        ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        !hasTagFilters ? 'border-dark bg-dark text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="flex-1">{a.tagFilterAll}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTagFilter(UNLABELED_TAG_FILTER)}
                    ref={(node) => { tagFilterItemRefs.current[hasTagFilters ? 2 : 1] = node; }}
                    onKeyDown={(event) => handleTagFilterItemKeyDown(event, hasTagFilters ? 2 : 1)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      selectedTagFilters.includes(UNLABELED_TAG_FILTER)
                        ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        selectedTagFilters.includes(UNLABELED_TAG_FILTER)
                          ? 'border-dark bg-dark text-white'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="flex-1">{a.appsWithoutTags}</span>
                  </button>
                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                  {filteredTags.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">
                      {a.noTagFilterMatches}
                    </div>
                  ) : filteredTags.map((tag, tagIndex) => {
                    const selected = selectedTagFilters.includes(tag);
                    const index = (hasTagFilters ? 3 : 2) + tagIndex;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTagFilter(tag)}
                        ref={(node) => { tagFilterItemRefs.current[index] = node; }}
                        onKeyDown={(event) => handleTagFilterItemKeyDown(event, index)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            selected ? 'border-dark bg-dark text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                          }`}
                          aria-hidden="true"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="flex-1 truncate">{tag}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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
            className="min-w-[150px]"
          />
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {filteredApps.length} {ui.nav.apps.toLowerCase()} {t.of} {apps.length}
          </div>
        </div>
      </div>

      {/* App table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800" />
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <PaginationControls
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            summary={`${pagination.page} / ${pagination.pages} · ${pagination.total} ${ui.nav.apps.toLowerCase()}`}
            previousLabel={ui.common.previous}
            nextLabel={ui.common.next}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
            variant="attached-top"
            className="mt-0 bg-white dark:bg-gray-900"
          />
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                    <span>{ui.nav.apps}</span> {sortIndicator('name')}
                    </button>
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('slug')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                      <span>{a.sortBySlug}</span> {sortIndicator('slug')}
                    </button>
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('target_url')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                      <span>{a.sortByTargetUrl}</span> {sortIndicator('target_url')}
                    </button>
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort('mode')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                    <span>{ui.admin.common.appMode}</span> {sortIndicator('mode')}
                    </button>
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('is_active')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                    <span>{ui.admin.common.active}</span> {sortIndicator('is_active')}
                    </button>
                  </th>
                <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedApps.map((app) => (
                <tr key={app.id} className="border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-800/55">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <AppIcon app={app} className="w-8 h-8" textClassName="text-2xl" />
                      <span className="font-semibold text-dark dark:text-gray-100">{app.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono">{app.slug}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{app.target_url}</td>
                  <td className="px-6 py-4 text-center whitespace-nowrap">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
                      app.mode === 'redirect' ? 'bg-blue-100 text-blue-700'
                        : app.mode === 'internal-link' ? 'bg-emerald-100 text-emerald-700'
                        : app.mode === 'shared-cookie' ? 'bg-accent/10 text-accent-dark'
                        : app.mode === 'entra-app' ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                    }`}>
                      {app.mode === 'redirect' ? t.redirectSso : app.mode === 'internal-link' ? t.internalLink : app.mode === 'shared-cookie' ? t.sharedCookie : app.mode === 'entra-app' ? t.entraApp : t.link}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleToggle(app)}
                      disabled={!canEdit}
                      className={`w-10 h-6 rounded-full transition-colors relative inline-flex items-center ${
                        app.is_active ? 'bg-accent dark:bg-accent-dark' : 'bg-gray-200 dark:bg-gray-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span
                        className={`absolute w-4 h-4 rounded-full shadow transition-transform ${
                          app.is_active
                            ? 'translate-x-5 bg-white'
                            : 'translate-x-1 bg-white dark:bg-gray-400'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => jumpToGroupsForApp(app)}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={a.goToGroupsSearch}
                      >
                        <Users className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => duplicateApp(app)}
                        disabled={!canEdit || cloning}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={cloning ? a.duplicating : a.duplicate}
                        aria-label={cloning ? a.duplicating : a.duplicate}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            summary={`${pagination.page} / ${pagination.pages} · ${pagination.total} ${ui.nav.apps.toLowerCase()}`}
            previousLabel={ui.common.previous}
            nextLabel={ui.common.next}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
            variant="attached-bottom"
            className="mt-0 bg-white dark:bg-gray-900"
          />
        </div>
      )}

      <PluginSurface surface={PLUGIN_SURFACES.ADMIN_PAGE_BOTTOM} variant="stack" className="mt-6" />

      {/* Modal */}
      {editing !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-6xl shadow-xl my-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-dark dark:text-gray-100">
                {editing === 'new' ? ui.admin.apps.newApp : ui.admin.apps.editApp}
              </h2>
              <button onClick={close} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/50 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.icon}</label>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {a.iconHelp}
                    </p>
                  </div>
                  <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
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
                        iconMode === 'emoji' ? 'bg-dark text-white' : 'text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white'
                      }`}
                    >
                      {a.useEmoji}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIconMode('asset')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        iconMode === 'asset' ? 'bg-dark text-white' : 'text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white'
                      }`}
                    >
                      {a.useImage}
                    </button>
                  </div>
                </div>

                {iconMode === 'emoji' ? (
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] items-center">
                    <div className="w-16 h-16 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center justify-center">
                      <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.emojiOrSymbol}</label>
                      <input
                        type="text"
                        value={form.icon}
                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                        placeholder="📦"
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
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
                      className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4 text-center cursor-pointer hover:border-accent transition-colors outline-none min-h-[180px] flex flex-col items-center justify-center gap-3"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                        {iconAssetPreview ? (
                          <img src={iconAssetPreview} alt={a.uploadedIconPreview} className="w-full h-full object-contain" />
                        ) : (
                          <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-dark dark:text-gray-100">{a.iconUploadCta}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{a.iconUploadHint}</p>
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
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.pasteSvgLabel}</label>
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
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500 resize-y"
                        />
                      </div>

                      {iconAssetPreview && (
                        <div className="flex items-center justify-between gap-3 text-xs text-gray-400 dark:text-gray-500">
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
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {a.iconPasteHint}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.nameLabel}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={a.nameExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.slugLabel}</label>
                <input
                  type="text"
                  value={form.slug}
                  maxLength={63}
                  onChange={(e) => {
                    slugAutoFillRef.current = true;
                    setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
                  }}
                  placeholder={a.slugExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
                <p className="mt-1 flex items-center justify-between gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span>{a.slugHelp}</span>
                  <span className="shrink-0 font-mono">
                    {form.slug.length}/63
                  </span>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {a.slugLimitHelp}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.descriptionLabel}</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={a.descriptionPlaceholder}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.targetUrlLabel}</label>
                <input
                  type="url"
                  value={form.target_url}
                  onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                  placeholder={a.targetUrlExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
                {form.mode === 'internal-link' && (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    {a.internalLinkHelp}
                  </p>
                )}
              </div>

                {editing === 'new' && (
                  <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/50 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDefaultGroup}
                        onChange={(e) => setIncludeDefaultGroup(e.target.checked)}
                        className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-dark dark:text-gray-100">{a.addToDefaultGroup}</span>
                          <span className="text-[10px] bg-accent/20 text-dark dark:text-gray-100 px-1.5 py-0.5 rounded font-medium">
                            {ui.common.defaultRecommended}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {a.defaultGroupIncludedHelp}
                        </p>
                      </div>
                    </label>
                  </div>
                )}

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.connection}</label>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {visibleModeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleModeChange(opt.value)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        form.mode === opt.value ? opt.active : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {currentModeOption && !visibleModeOptions.some((opt) => opt.value === form.mode) && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    {a.currentMode}: <span className="font-semibold text-gray-500 dark:text-gray-400">{currentModeOption.label}</span>. {a.currentModeHelp}
                  </p>
                )}
              </div>

              {form.mode === 'entra-app' && (
                <div className="p-3 bg-violet-50 dark:bg-violet-950/40 rounded-xl border border-violet-100 dark:border-violet-900/50">
                    <label className="block text-sm font-medium text-violet-700 dark:text-violet-300 mb-1">{ui.admin.apps.entraApplicationId}</label>
                  <input
                    type="text"
                    value={form.sso_endpoint}
                    onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                    onBlur={(e) => {
                      const normalized = normalizeEntraApplicationId(e.target.value);
                      if (normalized !== e.target.value) {
                        setForm((prev) => ({ ...prev, sso_endpoint: normalized }));
                      }
                    }}
                    placeholder={ui.admin.apps.enterApplicationId}
                    className="w-full px-3 py-2 border border-violet-200 dark:border-violet-800 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:focus-visible:ring-violet-600"
                  />
                  <p className="text-xs text-violet-500 dark:text-violet-400 mt-1">
                    {ui.admin.apps.applicationIdHelp}
                  </p>
                </div>
              )}

              {form.mode === 'redirect' && (
                <div className="grid grid-cols-[1fr_auto] gap-4 p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/50">
                    <div>
                    <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">{a.ssoEndpointLabel}</label>
                    <input
                      type="text"
                      value={form.sso_endpoint}
                      onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                      placeholder="/sso"
                      className="w-full px-3 py-2 border border-blue-200 dark:border-blue-800 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-600"
                    />
                    </div>
                    <div>
                    <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">{a.ssoMethodLabel}</label>
                    <select
                      value={form.sso_method}
                      onChange={(e) => setForm({ ...form, sso_method: e.target.value })}
                      className="w-full px-3 py-2 border border-blue-200 dark:border-blue-800 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-600"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                    {form.sso_method === 'GET' && (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-md p-2 leading-relaxed">
                        ⚠️ {a.ssoMethodGetWarning}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.tagsLabel}</label>
                  <TagInput
                    value={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    suggestions={allTags}
                    placeholder={a.tagsPlaceholder}
                    suggestionsLabel={a.tagSuggestionsTitle}
                    availableTagsLabel={a.availableTagsTitle}
                    useSuggestionLabel={a.useExistingTag}
                  />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{ui.admin.apps.enterToAddTags}</p>
                </div>

                <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.sortOrderLabel}</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.longDescriptionLabel}</label>
                <textarea
                  value={form.long_description}
                  onChange={(e) => setForm({ ...form, long_description: e.target.value })}
                  placeholder={a.longDescriptionPlaceholder}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500 resize-y"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{a.longDescriptionHelp}</p>
              </div>
            </div>

              <div className="flex flex-col gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-end">
                {editing !== 'new' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2">
                    <button
                      type="button"
                      onClick={handleSaveAndAssignGroups}
                      disabled={saving || !form.name || !form.slug || !form.target_url}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-dark dark:text-white bg-accent hover:bg-accent/80 dark:bg-accent-dark dark:hover:bg-accent-dark/90 shadow-sm shadow-accent/20 dark:shadow-black/30 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Users className="w-4 h-4" />
                      {saving ? a.saving : a.saveAndAssignGroups}
                    </button>
                    <button
                      type="button"
                      onClick={openClone}
                      disabled={cloning || !canEdit}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-violet-700 hover:text-violet-800 hover:bg-violet-50 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Copy className="w-4 h-4" />
                      {cloning ? a.duplicating : a.duplicate}
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={close}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                  >
                    {ui.common.cancel}
                  </button>
                  <button
                    type="button"
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
        </div>
      )}

      {pendingGroupAssignApp && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 px-4 py-4">
          <div className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => {
                if (hasPendingGroupAssignmentChanges) {
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
              className="absolute top-4 right-4 p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              aria-label={a.closeGroupSelection}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6 sm:p-8">
              <div className="mb-6">
                <h2 className="text-2xl font-extrabold text-dark dark:text-gray-100">{a.addToGroupsTitle}</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {a.addToGroupsHelp}
                </p>
                {pendingGroupAssignApp?.defaultIncluded ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    {a.defaultGroupAlreadyCreated}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
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
                  autoFocus
                  searchShortcutTarget="primary"
                  searchShortcutLabel={ui.common.searchShortcut}
                />
                <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-between gap-3">
                  <span>{groupAssignSelection.length} {a.selectedGroupSummary}</span>
                  <span>{filteredGroups.length} {t.groups}</span>
                </div>
                {hasGroupAssignSearch && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={selectVisibleGroups}
                      disabled={filteredGroups.length === 0}
                      className="text-xs font-medium text-accent-dark hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      {a.selectAllFiltered}
                    </button>
                  </div>
                )}
              </div>

              {groupsLoading ? (
                <div className="animate-pulse grid gap-2 sm:grid-cols-2">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-16 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800" />
                  ))}
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-3 py-4">
                  {ui.admin.apps.noGroupsFound}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 max-h-[48vh] overflow-y-auto pr-1">
                  {filteredGroups.map((group) => {
                    const selected = groupAssignSelection.includes(group.id);
                    const groupSourceLabel = group.source === 'entra' ? 'Entra' : 'Locale';
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
                          onChange={() => toggleGroupAssignment(group.id)}
                          className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{groupLabel(group)}</span>
                            <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium">
                              {groupSourceLabel}
                            </span>
                            {group.id === DEFAULT_GROUP_ID && (
                              <span className="text-[10px] bg-accent/30 text-dark dark:text-gray-100 px-1.5 py-0.5 rounded font-medium">
                                default
                              </span>
                            )}
                          </div>
                          {group.description && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{group.description}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={closeGroupAssignmentModal}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                >
                  Salta
                </button>
                <button
                  type="button"
                  onClick={saveGroupAssignment}
                  disabled={assigningGroups || (!hasPendingGroupAssignmentChanges && !groupAssignAllowNoChanges)}
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
