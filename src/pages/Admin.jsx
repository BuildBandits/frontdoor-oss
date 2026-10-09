import { useCallback, useState, useEffect, useEffectEvent, useRef, useMemo } from 'react';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useBranding } from '../stores/brandingStore';
import AppIcon from '../components/AppIcon';
import PageNotice from '../components/PageNotice';
import TopToastNotice from '../components/TopToastNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import { apiErrorMessage } from '../utils/apiErrors';
import { normalizeEntraApplicationId } from '../../shared/entra.js';
import { normalizeAppSlug, suggestAppSlug } from '../../shared/appSlug.js';
import PluginSurface from '../pluginHost/PluginSurface';
import { PLUGIN_SURFACES } from '../pluginHost/constants';
import { MAX_RASTER_ICON_BYTES, MAX_SVG_ICON_BYTES, estimateDataUrlBytes } from '../../shared/iconLimits.js';
import { MAX_ICON_SOURCE_BYTES, downscaleIconDataUrl, isResizableIconType } from '../utils/iconImages';
import { DEFAULT_GROUP_ID, UNLABELED_TAG_FILTER, emptyApp } from './apps/constants';
import AppsFilterBar from './apps/AppsFilterBar';
import AppsTable from './apps/AppsTable';
import AppFormModal from './apps/AppFormModal';
import GroupAssignmentModal from './apps/GroupAssignmentModal';


export default function Admin() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [apps, setApps] = useState([]);
  const [groups, setGroups] = useState([]);
  const branding = useBranding();
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
  const { dialog: confirmDialog, open: openConfirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [cloning, setCloning] = useState(false);
  const iconFileInputRef = useRef(null);
  const slugAutoFillRef = useRef(false);
  const modeFilterRef = useRef(null);
  const tagFilterRef = useRef(null);
  const tagFilterSearchRef = useRef(null);
  const tagFilterItemRefs = useRef([]);
  const canEdit = user?.role !== 'admin_readonly';
  const brandingLanguage = normalizeLanguage(branding?.defaultLanguage);
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

  const pushNotice = useCallback((type, message) => setPageNotice({ type, message }), []);
  const pushAppSaveNotice = (type, message) => {
    const noticeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now());
    setAppSaveNotice({ id: noticeId, type, message });
  };
  const hasPendingGroupAssignmentChanges = groupAssignSelection.length !== groupAssignInitialSelection.length
    || groupAssignSelection.some((groupId) => !groupAssignInitialSelection.includes(groupId));

  const loadApps = () => {
    api.get('/apps/all')
      .then((res) => {
        setApps(res.data.apps);
      })
      .catch(() => {
        pushNotice('error', ui.admin.apps.loadFailed);
      })
      .finally(() => {
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

  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const ui = getUiStrings(language);
  const t = ui.admin.common;
  const a = ui.admin.apps;

  // Initial load only; the loaders read the current UI strings when they run.
  const loadInitialData = useEffectEvent(() => {
    loadApps();
    loadGroups();
  });
  useEffect(() => {
    loadInitialData();
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

  const openEdit = useCallback((app) => {
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
  }, [canEdit, pushNotice, t]);

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
      pushNotice('error', apiErrorMessage(err, ui, t.cloneFailed));
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
      pushNotice('error', apiErrorMessage(err, ui, t.cloneFailed));
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
  }, [editing, appModalDirty, confirmDialog, openConfirm, t]);

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
  }, [pendingGroupAssignApp, hasPendingGroupAssignmentChanges, confirmDialog, openConfirm, t]);

  const applyIconAssetFile = (file) => {
    if (!file) return;
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    // PNG, JPEG and WebP are shrunk to MAX_ICON_DIMENSION before upload, so only the
    // result has to fit the server limit; other types are checked as they are.
    const resizable = isResizableIconType(file.type);
    const maxSourceBytes = resizable ? MAX_ICON_SOURCE_BYTES : (isSvg ? MAX_SVG_ICON_BYTES : MAX_RASTER_ICON_BYTES);
    if (file.size > maxSourceBytes) {
      pushNotice('error', a.iconTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      let dataUrl = String(reader.result || '');
      if (resizable) {
        try {
          dataUrl = await downscaleIconDataUrl(dataUrl, file.type);
        } catch {
          pushNotice('error', a.iconTooLarge);
          return;
        }
        if (estimateDataUrlBytes(dataUrl) > MAX_RASTER_ICON_BYTES) {
          pushNotice('error', a.iconTooLarge);
          return;
        }
      }
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
      if (new Blob([svg]).size > MAX_SVG_ICON_BYTES) {
        pushNotice('error', a.iconTooLarge);
        event.preventDefault();
        return;
      }
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
      pushAppSaveNotice('error', apiErrorMessage(err, ui, t.errorSaving));
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
          pushNotice('error', apiErrorMessage(err, ui, t.errorSaving));
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
      pushNotice('error', apiErrorMessage(err, ui, t.errorSaving));
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
    // Keep the same array when no tag disappeared: a new array would count as a
    // filter change and send the list back to page 1 after every reload (e.g. a save).
    setSelectedTagFilters((prev) => {
      const next = prev.filter((tag) => tag === UNLABELED_TAG_FILTER || allTags.includes(tag));
      return next.length === prev.length ? prev : next;
    });
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

    const compareText = (a, b, key) => (a?.[key] || '').toString().localeCompare((b?.[key] || '').toString(), language, { sensitivity: 'base' });
    const compareNumber = (a, b, key) => (Number(a?.[key] || 0) - Number(b?.[key] || 0));
    const direction = appSort.direction === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      let result;
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
  }, [apps, appSearch, appModeFilter, appSort, showOnlyOrphanApps, selectedTagFilters, language]);
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
      pushNotice('error', apiErrorMessage(err, ui, a.groupAssignmentError));
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

      <AppsFilterBar
        appSearch={appSearch}
        setAppSearch={setAppSearch}
        ui={ui}
        modeFilterRef={modeFilterRef}
        setModeFilterOpen={setModeFilterOpen}
        filterButtonMinWidth={filterButtonMinWidth}
        a={a}
        currentModeFilterOption={currentModeFilterOption}
        modeFilterOpen={modeFilterOpen}
        visibleModeFilterOptions={visibleModeFilterOptions}
        appModeFilter={appModeFilter}
        setAppModeFilter={setAppModeFilter}
        tagFilterRef={tagFilterRef}
        setTagFilterOpen={setTagFilterOpen}
        hasTagFilters={hasTagFilters}
        tagFilterOpen={tagFilterOpen}
        selectedTagFilters={selectedTagFilters}
        tagFilterSearch={tagFilterSearch}
        setTagFilterSearch={setTagFilterSearch}
        tagFilterSearchRef={tagFilterSearchRef}
        handleTagFilterSearchKeyDown={handleTagFilterSearchKeyDown}
        setSelectedTagFilters={setSelectedTagFilters}
        tagFilterItemRefs={tagFilterItemRefs}
        handleTagFilterItemKeyDown={handleTagFilterItemKeyDown}
        toggleTagFilter={toggleTagFilter}
        t={t}
        filteredTags={filteredTags}
        pageSize={pageSize}
        setPageSize={setPageSize}
        filteredApps={filteredApps}
        apps={apps}
      />

      <AppsTable
        loading={loading}
        pagination={pagination}
        a={a}
        ui={ui}
        setPage={setPage}
        toggleSort={toggleSort}
        sortIndicator={sortIndicator}
        t={t}
        paginatedApps={paginatedApps}
        handleToggle={handleToggle}
        canEdit={canEdit}
        jumpToGroupsForApp={jumpToGroupsForApp}
        openEdit={openEdit}
        duplicateApp={duplicateApp}
        cloning={cloning}
        handleDelete={handleDelete}
      />

      <PluginSurface surface={PLUGIN_SURFACES.ADMIN_PAGE_BOTTOM} variant="stack" className="mt-6" />

      {/* Modal */}
      <AppFormModal
        editing={editing}
        close={close}
        apps={apps}
        ui={ui}
        a={a}
        setIconMode={setIconMode}
        setIconAssetDataUrl={setIconAssetDataUrl}
        setIconAssetPreview={setIconAssetPreview}
        setIconSvgText={setIconSvgText}
        setRemoveIconAsset={setRemoveIconAsset}
        iconMode={iconMode}
        form={form}
        setForm={setForm}
        handleIconPaste={handleIconPaste}
        applyIconAssetFile={applyIconAssetFile}
        iconFileInputRef={iconFileInputRef}
        iconAssetPreview={iconAssetPreview}
        handleIconFileChange={handleIconFileChange}
        iconSvgText={iconSvgText}
        slugAutoFillRef={slugAutoFillRef}
        includeDefaultGroup={includeDefaultGroup}
        setIncludeDefaultGroup={setIncludeDefaultGroup}
        visibleModeOptions={visibleModeOptions}
        handleModeChange={handleModeChange}
        currentModeOption={currentModeOption}
        allTags={allTags}
        t={t}
        handleSaveAndAssignGroups={handleSaveAndAssignGroups}
        saving={saving}
        openClone={openClone}
        cloning={cloning}
        canEdit={canEdit}
        handleSave={handleSave}
      />

      <GroupAssignmentModal
        pendingGroupAssignApp={pendingGroupAssignApp}
        closeGroupAssignmentModal={closeGroupAssignmentModal}
        apps={apps}
        hasPendingGroupAssignmentChanges={hasPendingGroupAssignmentChanges}
        openConfirm={openConfirm}
        t={t}
        a={a}
        groupAssignSearch={groupAssignSearch}
        setGroupAssignSearch={setGroupAssignSearch}
        ui={ui}
        groupAssignSelection={groupAssignSelection}
        filteredGroups={filteredGroups}
        hasGroupAssignSearch={hasGroupAssignSearch}
        selectVisibleGroups={selectVisibleGroups}
        groupsLoading={groupsLoading}
        toggleGroupAssignment={toggleGroupAssignment}
        groupLabel={groupLabel}
        saveGroupAssignment={saveGroupAssignment}
        assigningGroups={assigningGroups}
        groupAssignAllowNoChanges={groupAssignAllowNoChanges}
      />

      <ConfirmDialog {...confirmDialogProps} ui={ui} />
    </div>
  );
}
