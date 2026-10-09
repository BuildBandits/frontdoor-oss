import { useState, useEffect, useEffectEvent, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Eye, Plus, Shield, Trash2, X, Save, Users, ChevronDown, ChevronRight, AppWindow, Pencil, Clock, RefreshCw, Layers3, ArrowRightLeft, Filter } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useBrandingLanguage } from '../stores/brandingStore';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';
import PageNotice from '../components/PageNotice';
import TopToastNotice from '../components/TopToastNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import Modal from '../components/Modal';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
import PaginationControls from '../components/PaginationControls';
import { formatMessage, getUiStrings, resolveAppLanguage } from '../i18n';
import { apiErrorMessage } from '../utils/apiErrors';

const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';

export default function AdminGroups() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [scrollTargetGroupId, setScrollTargetGroupId] = useState(null);
  const [groupDetail, setGroupDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const groupRowRefs = useRef(new Map());

  const [pageNotice, setPageNotice] = useState(null);
  const { dialog: confirmDialog, open: openConfirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [groupSearch, setGroupSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [activeGroupPanel, setActiveGroupPanel] = useState('members');

  const showToast = (message, type = 'success') => setPageNotice({ message, type });

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

  // Add linked groups modal
  const [showAddGroups, setShowAddGroups] = useState(false);
  const [groupLinkSearch, setGroupLinkSearch] = useState('');
  const [selectedLinkedGroupIds, setSelectedLinkedGroupIds] = useState([]);
  const [selectedLinkedEntraGroupIds, setSelectedLinkedEntraGroupIds] = useState([]);

  // Add apps modal
  const [showAddApps, setShowAddApps] = useState(false);
  const [allApps, setAllApps] = useState([]);
  const [appSearch, setAppSearch] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [showOnlyProblemGroups, setShowOnlyProblemGroups] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Entra import modal
  const [showEntraImport, setShowEntraImport] = useState(false);
  const [entraCandidates, setEntraCandidates] = useState([]);
  const [entraCandidatesLoading, setEntraCandidatesLoading] = useState(false);
  const [entraSearch, setEntraSearch] = useState('');
  const [selectedEntraGroups, setSelectedEntraGroups] = useState([]);
  const [importingEntra, setImportingEntra] = useState(false);
  const [forceSyncing, setForceSyncing] = useState(false);
  const brandingLanguage = useBrandingLanguage();
  const canEdit = user?.role !== 'admin_readonly';
  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));
  const t = ui.admin.common;
  const g = ui.admin.groups;

  const groupLabel = (group) => group.entra_display_name || group.name;
  const isEntraGroup = (group) => group.source === 'entra';
  const setGroupRowRef = useCallback((groupId) => (node) => {
    if (!node) {
      groupRowRefs.current.delete(groupId);
      return;
    }
    groupRowRefs.current.set(groupId, node);
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.get('/groups');
      setGroups(res.data.groups);
    } catch {
      showToast(t.errorLoadingGroups, 'error');
    }
    setLoading(false);
  }, [t]);

  const loadEntraCandidates = useCallback(async () => {
    setEntraCandidatesLoading(true);
    try {
      const res = await api.get('/groups/entra/candidates');
      setEntraCandidates(res.data.groups || []);
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorLoadingGroups), 'error');
    }
    setEntraCandidatesLoading(false);
  }, [t, ui]);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  // Effect events: run the latest handlers without re-running the route-state effects.
  const openIncomingGroup = useEffectEvent((groupId) => openGroupAndScroll(groupId, true));
  const openIncomingEntraImport = useEffectEvent((groupIds, search) => openEntraImport(groupIds, search));
  useEffect(() => {
    const incomingSearch = location.state?.groupSearch;
    const incomingGroupId = location.state?.openGroupDetail;
    if (!incomingSearch && !incomingGroupId) return;
    if (incomingSearch) setGroupSearch(incomingSearch);
    if (incomingGroupId) {
      void openIncomingGroup(incomingGroupId);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
  useEffect(() => {
    if (!scrollTargetGroupId || expandedGroup !== scrollTargetGroupId) return undefined;
    const node = groupRowRefs.current.get(scrollTargetGroupId);
    if (!node) return undefined;
    const timer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollTargetGroupId(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [expandedGroup, groupDetail, groupSearch, scrollTargetGroupId, groups.length]);
  useEffect(() => {
    if (!showCreateMenu) return undefined;
    const closeMenu = () => setShowCreateMenu(false);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [showCreateMenu]);

  const closeCurrentModal = useCallback(() => {
    if (showCreate) {
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setSaving(false);
      return;
    }
    if (showEntraImport) {
      setShowEntraImport(false);
      setSelectedEntraGroups([]);
      setEntraSearch('');
      setImportingEntra(false);
      return;
    }
    if (showAddMembers) {
      setShowAddMembers(false);
      setAllUsers([]);
      setMemberSearch('');
      return;
    }
    if (showAddGroups) {
      setShowAddGroups(false);
      setGroupLinkSearch('');
      setSelectedLinkedGroupIds([]);
      setSelectedLinkedEntraGroupIds([]);
      return;
    }
    if (showAddApps) {
      setShowAddApps(false);
      setAllApps([]);
      setAppSearch('');
    }
  }, [showCreate, showEntraImport, showAddMembers, showAddGroups, showAddApps]);

  const activeModal = showCreate
    ? 'create'
    : showEntraImport
      ? 'entraImport'
      : showAddMembers
        ? 'addMembers'
        : showAddGroups
          ? 'addGroups'
          : showAddApps
          ? 'addApps'
          : null;

  const activeModalDirty = (() => {
    if (activeModal === 'create') return Boolean(newName.trim() || newDesc.trim());
    if (activeModal === 'entraImport') return selectedEntraGroups.length > 0;
    if (activeModal === 'addGroups') return selectedLinkedGroupIds.length > 0 || selectedLinkedEntraGroupIds.length > 0;
    return false;
  })();

  // Escape, the backdrop and the X all close through here, so unsaved changes always ask first.
  const requestCloseActiveModal = useCallback(() => {
    if (activeModalDirty) {
      openConfirm({
        title: t.closeWithoutSavingTitle,
        message: t.closeWithoutSavingMessage,
        confirmLabel: t.close,
        onConfirm: async () => {
          closeCurrentModal();
        },
      });
      return;
    }
    closeCurrentModal();
  }, [activeModalDirty, closeCurrentModal, openConfirm, t]);

  useEffect(() => {
    if (!activeModal || confirmDialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestCloseActiveModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModal, confirmDialog, requestCloseActiveModal]);

  // Only the latest detail request may update the panel: a slower answer for a
  // group that is no longer expanded must not show up (and be acted on) under another one.
  const detailRequest = useLatestRequest();
  const loadGroupDetail = async (groupId) => {
    const isLatest = detailRequest.begin();
    setDetailLoading(true);
    try {
      const res = await api.get(`/groups/${groupId}`);
      if (isLatest()) setGroupDetail(res.data);
    } catch {
      if (isLatest()) showToast(t.errorLoadingGroupDetails, 'error');
    }
    if (isLatest()) setDetailLoading(false);
  };

  const toggleExpand = async (groupId) => {
    if (expandedGroup === groupId) {
      detailRequest.cancel();
      setExpandedGroup(null);
      setGroupDetail(null);
      setEditingGroup(null);
      setDetailLoading(false);
    } else {
      setExpandedGroup(groupId);
      setGroupDetail(null);
      setActiveGroupPanel('members');
      setEditingGroup(null);
      await loadGroupDetail(groupId);
    }
  };

  const openGroupAndScroll = async (groupId, preserveSearch = false) => {
    if (!preserveSearch && !filteredGroups.some((group) => group.id === groupId) && groupSearch.trim()) {
      setGroupSearch('');
    }
    setScrollTargetGroupId(groupId);
    if (expandedGroup !== groupId) {
      await toggleExpand(groupId);
    }
  };

  const handleCreate = async () => {
    if (!canEdit) {
      showToast(ui.admin.groups.readOnly, 'error');
      return;
    }
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.post('/groups', { name: newName.trim(), description: newDesc.trim() });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      showToast(g.groupCreated);
      await loadGroups();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorCreatingGroup), 'error');
    }
    setSaving(false);
  };

  const handleForceSyncGroups = async () => {
    if (!canEdit) {
      showToast(ui.admin.groups.readOnly, 'error');
      return;
    }
    setForceSyncing(true);
    try {
      const res = await api.post('/groups/entra/force-sync');
      const summary = res.data;
      const errorCount = summary.errors?.length || 0;
      const firstError = summary.errors?.[0];
      const parts = [g.forceSyncComplete
        .replace('{usersSynced}', summary.usersSynced)
        .replace('{usersConsidered}', summary.usersConsidered)
        .replace('{discoveredGroups}', summary.discoveredGroups)];
      const usersDeactivated = summary.usersDeactivated || 0;
      const usersKeptActive = (summary.usersNotFound || 0) - usersDeactivated;
      if (usersDeactivated > 0) {
        parts.push(g.forceSyncUsersDeactivated.replace('{count}', usersDeactivated));
      }
      if (usersKeptActive > 0) {
        parts.push(g.forceSyncUsersKeptActive.replace('{count}', usersKeptActive));
      }
      if (errorCount > 0) {
        const hintText = (firstError?.hintCode && g.graphHints?.[firstError.hintCode]) || firstError?.hint;
        const detail = `${firstError?.message ? `: ${firstError.message}` : ''}${hintText ? ` (${hintText})` : ''}`;
        parts.push(`${g.forceSyncErrors.replace('{count}', errorCount)}${detail}`);
      }
      showToast(parts.join('. '), errorCount > 0 ? 'error' : summary.usersNotFound > 0 ? 'warning' : 'success');
      await loadGroups();
      await loadEntraCandidates();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, g.forceSyncError), 'error');
    }
    setForceSyncing(false);
  };

  const openEntraImport = async (prefillGroupIds = [], prefillSearch = '') => {
    if (!canEdit) {
      showToast(ui.admin.groups.readOnly, 'error');
      return;
    }
    setShowCreateMenu(false);
    setEntraSearch(prefillSearch);
    setSelectedEntraGroups(prefillGroupIds);
    setShowEntraImport(true);
    await loadEntraCandidates();
  };

  useEffect(() => {
    const incomingGroupId = location.state?.openEntraImport;
    if (!incomingGroupId) return;
    openIncomingEntraImport([incomingGroupId], location.state?.entraSearch || '');
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const toggleEntraGroupSelection = (groupId) => {
    setSelectedEntraGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleLinkedGroupSelection = (groupId) => {
    setSelectedLinkedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleLinkedEntraGroupSelection = (groupId) => {
    setSelectedLinkedEntraGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const selectVisibleEntraGroups = () => {
    const visibleIds = filteredEntraCandidates
      .filter((group) => !group.is_imported)
      .map((group) => group.entra_group_id);
    setSelectedEntraGroups((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const handleImportEntraGroups = async () => {
    if (selectedEntraGroups.length === 0) return;
    setImportingEntra(true);
    try {
      const res = await api.post('/groups/entra/import', { groupIds: selectedEntraGroups });
      const importedGroups = Number(res.data.importedGroups ?? selectedEntraGroups.length);
      const importMessage = importedGroups === 1 ? g.entraGroupImported : g.entraGroupsImported;
      showToast(importMessage);
      setShowEntraImport(false);
      setSelectedEntraGroups([]);
      await loadGroups();
      await loadEntraCandidates();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, g.importEntraGroupsError), 'error');
    }
    setImportingEntra(false);
  };

  const handleDelete = async (group) => {
    if (!canEdit) {
      showToast(ui.admin.groups.readOnly, 'error');
      return;
    }
    const groupName = groupLabel(group);
    const sourceLabel = group.source === 'entra' ? g.importedFromEntra : g.local;
    openConfirm({
      title: g.deleteGroupTitle.replace('{source}', sourceLabel).replace('{name}', groupName),
      message: g.deleteGroupMessage,
      confirmLabel: g.deleteGroup,
      onConfirm: async () => {
        try {
          await api.delete(`/groups/${group.id}`);
          if (expandedGroup === group.id) {
            setExpandedGroup(null);
            setGroupDetail(null);
          }
          setSelectedGroupIds((prev) => prev.filter((id) => id !== group.id));
          showToast(g.groupDeleted.replace('{name}', groupName));
          await loadGroups();
        } catch (err) {
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
        }
      },
    });
  };

  const toggleGroupSelection = (groupId) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const clearSelection = () => setSelectedGroupIds([]);

  const selectAllGroups = () => {
    const groupIds = groups
      .filter((group) => group.id !== DEFAULT_GROUP_ID)
      .map((group) => group.id);
    setSelectedGroupIds((prev) => Array.from(new Set([...prev, ...groupIds])));
  };

  const selectVisibleGroups = () => {
    const visibleIds = visibleGroups
      .filter((group) => group.id !== DEFAULT_GROUP_ID)
      .map((group) => group.id);
    setSelectedGroupIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const selectAllEntraGroups = () => {
    const entraIds = groups
      .filter((group) => group.source === 'entra' && group.id !== DEFAULT_GROUP_ID)
      .map((group) => group.id);
    setSelectedGroupIds((prev) => Array.from(new Set([...prev, ...entraIds])));
  };

  const selectAllLocalGroups = () => {
    const localIds = groups
      .filter((group) => group.source !== 'entra' && group.id !== DEFAULT_GROUP_ID)
      .map((group) => group.id);
    setSelectedGroupIds((prev) => Array.from(new Set([...prev, ...localIds])));
  };

  const invertSelection = () => {
    setSelectedGroupIds((prev) => {
      const next = groups
        .filter((group) => group.id !== DEFAULT_GROUP_ID)
        .map((group) => group.id)
        .filter((groupId) => !prev.includes(groupId));
      return next.length === 0 ? [] : next;
    });
  };

  const deleteSelectedGroups = async () => {
    if (selectedGroupIds.length === 0) return;
    const selectedCount = selectedGroupIds.length;
    const selectedGroups = groups.filter((group) => selectedGroupIds.includes(group.id));
    const groupsWithApps = selectedGroups.filter((group) => (group.app_count || 0) > 0).length;
    const confirmMessage = [
      g.bulkDeleteTitle.replace('{count}', selectedCount),
      groupsWithApps > 0 ? g.bulkDeleteWithApps.replace('{count}', groupsWithApps) : null,
      g.bulkDeleteMessage,
    ].filter(Boolean).join('\n\n');
    openConfirm({
      title: g.bulkDeleteTitle.replace('{count}', selectedCount),
      message: confirmMessage,
      confirmLabel: g.bulkDeleteConfirm,
      onConfirm: async () => {
        try {
          const res = await api.post('/groups/bulk-delete', { groupIds: selectedGroupIds });
          const deletedGroups = res.data.deletedGroups || [];
          const localDeleted = deletedGroups.filter((group) => group.source !== 'entra').length;
          const entraDeleted = deletedGroups.filter((group) => group.source === 'entra').length;
          clearSelection();
          setExpandedGroup(null);
          setGroupDetail(null);
          showToast(g.bulkDeleteSuccess.replace('{count}', selectedCount).replace('{localDeleted}', localDeleted).replace('{entraDeleted}', entraDeleted));
          await loadGroups();
        } catch (err) {
          showToast(apiErrorMessage(err, ui, g.bulkDeleteError), 'error');
        }
      },
    });
  };

  const selectedCount = selectedGroupIds.length;
  const selectedLocalCount = groups.filter((group) => selectedGroupIds.includes(group.id) && group.source !== 'entra').length;
  const selectedEntraCount = groups.filter((group) => selectedGroupIds.includes(group.id) && group.source === 'entra').length;
  // --- Edit group ---
  const startEdit = (group) => {
    setEditingGroup(group.id);
    setEditName(groupDetail?.group?.name || group.name);
    setEditDesc(groupDetail?.group?.description || group.description || '');
  };

  const saveEdit = async () => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    if (!editName.trim()) return;
    try {
      await api.put(`/groups/${editingGroup}`, { name: editName.trim(), description: editDesc.trim() });
      setEditingGroup(null);
      showToast(g.groupUpdated);
      await loadGroups();
      if (expandedGroup === editingGroup) await loadGroupDetail(editingGroup);
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
    }
  };

  // --- Members ---
  const openAddMembers = async () => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    try {
      const res = await api.get('/users');
      setAllUsers(res.data.users);
      setMemberSearch('');
      setShowAddMembers(true);
    } catch {
      showToast(t.errorLoadingUsers, 'error');
    }
  };

  const openAddGroups = async () => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    setGroupLinkSearch('');
    setSelectedLinkedGroupIds([]);
    setSelectedLinkedEntraGroupIds([]);
    setShowAddGroups(true);
    await loadEntraCandidates();
  };

  const addMember = async (userId) => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    try {
      await api.post(`/groups/${expandedGroup}/members`, { userIds: [userId] });
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
    }
  };

  const removeMember = async (userId, displayName) => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    openConfirm({
      title: g.removeMemberTitle.replace('{name}', displayName || g.thisUser),
      message: g.removeMemberMessage,
      confirmLabel: t.removeFromGroup,
      onConfirm: async () => {
        try {
          await api.delete(`/groups/${expandedGroup}/members/${userId}`);
          await loadGroupDetail(expandedGroup);
          await loadGroups();
        } catch (err) {
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
        }
      },
    });
  };

  const addLinkedGroups = async () => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    if (selectedLinkedGroupIds.length === 0 && selectedLinkedEntraGroupIds.length === 0) return;
    try {
      if (selectedLinkedGroupIds.length > 0) {
        await api.post(`/groups/${expandedGroup}/groups`, { groupIds: selectedLinkedGroupIds });
      }
      if (selectedLinkedEntraGroupIds.length > 0) {
        await api.post(`/groups/${expandedGroup}/entra-groups`, { entraGroupIds: selectedLinkedEntraGroupIds });
      }
      closeCurrentModal();
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
    }
  };

  const removeLinkedGroup = async (childGroupId, childGroupName) => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    openConfirm({
      title: g.removeLinkedGroupTitle.replace('{name}', childGroupName || g.thisGroup),
      message: g.removeLinkedGroupMessage,
      confirmLabel: g.removeLinkedGroup,
      onConfirm: async () => {
        try {
          await api.delete(`/groups/${expandedGroup}/groups/${childGroupId}`);
          await loadGroupDetail(expandedGroup);
          await loadGroups();
        } catch (err) {
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
        }
      },
    });
  };

  // --- Apps ---
  const openAddApps = async () => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    try {
      const res = await api.get('/apps/all');
      setAllApps(res.data.apps);
      setAppSearch('');
      setShowAddApps(true);
    } catch {
      showToast(t.errorLoadingGroups, 'error');
    }
  };

  const addApp = async (appId) => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    try {
      await api.post(`/groups/${expandedGroup}/apps`, { appIds: [appId] });
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
    }
  };

  const removeLinkedEntraGroup = async (entraGroupId, groupName) => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    try {
      await api.delete(`/groups/${expandedGroup}/entra-groups/${entraGroupId}`);
      showToast(g.linkedEntraGroupRemoved.replace('{name}', groupName));
      await loadGroupDetail(expandedGroup);
      await loadGroups();
    } catch (err) {
      showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
    }
  };

  const removeApp = async (appId, appName) => {
    if (!canEdit) {
      showToast(t.readOnly, 'error');
      return;
    }
    openConfirm({
      title: g.removeAppTitle.replace('{name}', appName || g.thisApp),
      message: g.removeAppMessage,
      confirmLabel: g.deleteApp,
      onConfirm: async () => {
        try {
          await api.delete(`/groups/${expandedGroup}/apps/${appId}`);
          await loadGroupDetail(expandedGroup);
          await loadGroups();
        } catch (err) {
          showToast(apiErrorMessage(err, ui, t.errorSaving), 'error');
        }
      },
    });
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

  const linkedGroups = groupDetail?.childGroups || [];
  const linkedGroupIds = new Set(linkedGroups.map((group) => group.id));
  const linkedEntraGroups = groupDetail?.childEntraGroups || [];
  const linkedEntraGroupIds = new Set(linkedEntraGroups.map((group) => group.entra_group_id));
  const totalLinkedGroupCount = Number(groupDetail?.childGroups?.length || 0) + Number(groupDetail?.childEntraGroups?.length || 0);
  const linkableGroups = groups.filter((group) => {
    if (!expandedGroup || group.id === expandedGroup) return false;
    if (group.id === DEFAULT_GROUP_ID) return false;
    if (linkedGroupIds.has(group.id)) return false;
    return true;
  });
  const filteredLinkableGroups = linkableGroups.filter((group) => {
    if (!groupLinkSearch.trim()) return true;
    const q = groupLinkSearch.toLowerCase();
    return [
      groupLabel(group),
      group.description || '',
      group.entra_display_name || '',
      group.entra_group_id || '',
    ].join(' ').toLowerCase().includes(q);
  });
  const hasGroupLinkSearch = groupLinkSearch.trim().length > 0;

  const entraLinkableGroups = entraCandidates.filter((group) => {
    if (!expandedGroup) return false;
    if (group.is_imported) return false;
    if (linkedEntraGroupIds.has(group.entra_group_id)) return false;
    return true;
  });
  const filteredLinkableEntraGroups = entraLinkableGroups.filter((group) => {
    if (!groupLinkSearch.trim()) return true;
    const q = groupLinkSearch.toLowerCase();
    return [
      group.display_name || '',
      group.description || '',
      group.entra_group_id || '',
    ].join(' ').toLowerCase().includes(q);
  });
  const selectVisibleLinkedGroups = () => {
    const visibleIds = filteredLinkableGroups.map((group) => group.id);
    setSelectedLinkedGroupIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const selectVisibleLinkedEntraGroups = () => {
    const visibleIds = filteredLinkableEntraGroups.map((group) => group.entra_group_id);
    setSelectedLinkedEntraGroupIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const filteredEntraCandidates = entraCandidates.filter((group) => {
    if (!entraSearch.trim()) return true;
    const q = entraSearch.toLowerCase();
    return (
      group.display_name?.toLowerCase().includes(q)
      || group.entra_group_id?.toLowerCase().includes(q)
      || group.local_name?.toLowerCase().includes(q)
    );
  });
  const hasEntraSearch = entraSearch.trim().length > 0;

  // The default group and every non-Entra group count as local.
  const groupSource = (group) => (group.source === 'entra' ? 'entra' : 'local');
  const sourceCounts = useMemo(() => groups.reduce((counts, group) => {
    counts[groupSource(group)] += 1;
    return counts;
  }, { local: 0, entra: 0 }), [groups]);
  const filteredGroups = useMemo(() => {
    const bySource = sourceFilter === 'all' ? groups : groups.filter((group) => groupSource(group) === sourceFilter);
    if (!groupSearch.trim()) return bySource;
    const q = groupSearch.toLowerCase();
    return bySource.filter((group) => {
      const searchable = [
        groupLabel(group),
        group.description || '',
        group.source || '',
        group.app_search_text || '',
        group.group_search_text || '',
      ].join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }, [groups, groupSearch, sourceFilter]);
  const groupsWithoutApps = useMemo(
    () => groups.filter((group) => Number(group.app_count || 0) === 0 && Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0) === 0),
    [groups],
  );
  const groupsWithoutMembers = useMemo(
    () => groups.filter((group) => Number(group.member_count || 0) === 0 && Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0) === 0),
    [groups],
  );
  const problemGroups = useMemo(
    () => groups.filter((group) => Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0) === 0 && (Number(group.app_count || 0) === 0 || Number(group.member_count || 0) === 0)),
    [groups],
  );
  const hasIncompleteGroupsNotice = problemGroups.length > 0;
  const visibleGroups = showOnlyProblemGroups
    ? filteredGroups.filter((group) => Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0) === 0 && (Number(group.app_count || 0) === 0 || Number(group.member_count || 0) === 0))
    : filteredGroups;
  const hasGroupFilter = groupSearch.trim().length > 0 || showOnlyProblemGroups || sourceFilter !== 'all';
  const pagination = useMemo(() => ({
    page,
    pages: Math.max(1, Math.ceil(visibleGroups.length / pageSize)),
    total: visibleGroups.length,
  }), [page, pageSize, visibleGroups.length]);
  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleGroups.slice(start, start + pageSize);
  }, [page, pageSize, visibleGroups]);

  useEffect(() => {
    if (showOnlyProblemGroups && problemGroups.length === 0) {
      setShowOnlyProblemGroups(false);
    }
  }, [showOnlyProblemGroups, problemGroups.length]);

  useEffect(() => {
    setPage(1);
  }, [groupSearch, showOnlyProblemGroups, pageSize, sourceFilter]);
  useEffect(() => {
    if (page > pagination.pages) {
      setPage(pagination.pages);
    }
  }, [page, pagination.pages]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-8 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.groups.pageTitle}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.admin.groups.subtitle}</p>
        </div>

        <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-sm max-sm:w-full dark:bg-red-950/30 dark:border-red-900/60">
              <span className="font-medium text-red-700">
                {selectedCount} {t.selected}
                <span className="ml-2 text-red-500 font-normal">
                  ({selectedLocalCount} {g.localSuffix}, {selectedEntraCount} {g.entraSuffix})
                </span>
              </span>
              <button
                onClick={clearSelection}
                disabled={!canEdit}
                className="text-red-600 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ui.common.cancel}
              </button>
              <button
                onClick={deleteSelectedGroups}
                disabled={!canEdit}
                className="px-3 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.deleteSelected}
              </button>
            </div>
          )}
          <div className="relative max-sm:w-full">
            <button
              onClick={(e) => { e.stopPropagation(); setShowCreateMenu((value) => !value); }}
              disabled={!canEdit}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed max-sm:w-full"
            >
              <Plus className="w-4 h-4" />
              {g.newGroup}
              <ChevronDown className="w-4 h-4" />
            </button>

            {showCreateMenu && (
              <div
                className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setShowCreateMenu(false);
                    setShowCreate(true);
                  }}
                  disabled={!canEdit}
                  className="w-full px-4 py-3 text-left text-sm text-dark dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  {g.newLocalGroup}
                </button>
                <button
                  onClick={() => openEntraImport()}
                  disabled={!canEdit}
                  className="w-full px-4 py-3 text-left text-sm text-dark dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Users className="w-4 h-4" />
                  {g.newEntraGroup}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleForceSyncGroups}
            disabled={forceSyncing || !canEdit}
            className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-dark dark:text-gray-100 rounded-xl font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-sm:w-full"
          >
            <RefreshCw className={`w-4 h-4 ${forceSyncing ? 'animate-spin' : ''}`} />
            {g.syncGroups}
          </button>
          {canEdit && (
            <button
              onClick={() => navigate('/admin/group-transfer')}
              className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-dark dark:text-gray-100 rounded-xl font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors max-sm:w-full"
            >
              <ArrowRightLeft className="w-4 h-4" />
              {g.transferGroups}
            </button>
          )}
        </div>
      </div>
      {!canEdit && (
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

      {hasIncompleteGroupsNotice && (
        <div className="mb-6">
          <PageNotice
            type="warning"
            title={g.problemGroupsNoticeTitle}
            message={g.problemGroupsNoticeHelp}
            actionLabel={showOnlyProblemGroups ? g.showAllGroups : g.showOnlyProblemGroups}
            onAction={() => setShowOnlyProblemGroups((prev) => !prev)}
          >
            <div className="space-y-4">
              {groupsWithoutApps.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    {g.groupsWithoutAppsLabel} ({groupsWithoutApps.length})
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {groupsWithoutApps.map((group) => (
                      <button
                        key={`no-apps-${group.id}`}
                        type="button"
                        onClick={() => { void openGroupAndScroll(group.id); }}
                        className="inline-flex items-center rounded-full border border-amber-200 bg-white dark:bg-gray-900 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
                      >
                        {groupLabel(group)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groupsWithoutMembers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    {g.groupsWithoutMembersLabel} ({groupsWithoutMembers.length})
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {groupsWithoutMembers.map((group) => (
                      <button
                        key={`no-members-${group.id}`}
                        type="button"
                        onClick={() => { void openGroupAndScroll(group.id); }}
                        className="inline-flex items-center rounded-full border border-amber-200 bg-white dark:bg-gray-900 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
                      >
                        {groupLabel(group)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </PageNotice>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={groupSearch}
              onChange={setGroupSearch}
              placeholder={ui.admin.groups.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <DropdownSelect
            value={sourceFilter}
            onChange={setSourceFilter}
            label={g.sourceFilter}
            icon={Layers3}
            options={[
              { value: 'all', label: `${g.sourceAll} (${groups.length})` },
              { value: 'local', label: `${g.sourceLocal} (${sourceCounts.local})` },
              { value: 'entra', label: `${g.sourceEntra} (${sourceCounts.entra})` },
            ]}
            className="min-w-[220px]"
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
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {visibleGroups.length} {ui.nav.groups.toLowerCase()} {t.of} {groups.length}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">{g.noGroups}</p>
          <p className="text-sm mt-1">{g.firstGroupHelp}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex-1" />
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={selectAllGroups}
                disabled={!canEdit || groups.filter((group) => group.id !== DEFAULT_GROUP_ID).length === 0}
                className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {g.selectAll}
              </button>
              {hasGroupFilter && (
                <button
                  type="button"
                  onClick={selectVisibleGroups}
                  disabled={!canEdit || visibleGroups.filter((group) => group.id !== DEFAULT_GROUP_ID).length === 0}
                  className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {g.selectAllFiltered}
                </button>
              )}
              <button
                type="button"
                onClick={selectAllEntraGroups}
                disabled={!canEdit || groups.filter((group) => group.source === 'entra' && group.id !== DEFAULT_GROUP_ID).length === 0}
                className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {g.selectAllEntraGroups}
              </button>
              <button
                type="button"
                onClick={selectAllLocalGroups}
                disabled={!canEdit || groups.filter((group) => group.source !== 'entra' && group.id !== DEFAULT_GROUP_ID).length === 0}
                className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {g.selectAllLocalGroups}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={!canEdit}
                className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {g.deselectAll}
              </button>
              <button
                type="button"
                onClick={invertSelection}
                disabled={!canEdit}
                className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {g.invertSelection}
              </button>
            </div>
          </div>

          <PaginationControls
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            summary={formatMessage(ui.admin.groups.pageSummary, pagination)}
            previousLabel={ui.common.previous}
            nextLabel={ui.common.next}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
            className="mt-0"
          />

          {paginatedGroups.map((group) => (
            <div key={group.id} ref={setGroupRowRef(group.id)} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
              {/* Group row */}
              <div
                className={`flex items-center justify-between px-5 py-3.5 cursor-pointer transition-colors ${
                  expandedGroup === group.id
                    ? 'dark:hover:bg-gray-800/70'
                    : 'hover:bg-gray-50/90 dark:hover:bg-gray-800/50'
                }`}
                onClick={() => toggleExpand(group.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {group.id !== DEFAULT_GROUP_ID && (
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(group.id)}
                      disabled={!canEdit}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleGroupSelection(group.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                    />
                  )}
                  {expandedGroup === group.id
                    ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-sm text-dark dark:text-gray-100">{groupLabel(group)}</span>
                      {group.source !== 'entra' && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded-sm font-medium">{g.localBadge}</span>
                      )}
                      {group.source === 'entra' && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                      )}
                      {Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-accent/10 dark:bg-accent-dark/20 text-accent-dark dark:text-gray-100 px-1.5 py-0.5 rounded-sm font-medium">
                          <Layers3 className="w-3 h-3" />
                          {g.compositeBadge}
                        </span>
                      )}
                      {group.id === DEFAULT_GROUP_ID && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-accent/30 text-dark dark:text-gray-100 px-1.5 py-0.5 rounded-full font-medium">{g.defaultBadge}</span>
                      )}
                    </div>
                    {group.description && <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{group.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    <Users className="w-3.5 h-3.5 shrink-0" /> {group.member_count}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    <AppWindow className="w-3.5 h-3.5 shrink-0" /> {group.app_count}
                  </span>
                  {Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0) > 0 && (
                    <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                      <Layers3 className="w-3.5 h-3.5 shrink-0" /> {Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0)}
                    </span>
                  )}
                  {group.id !== DEFAULT_GROUP_ID && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(group); }}
                      disabled={!canEdit}
                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/35 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={g.deleteGroupTooltip}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedGroup === group.id && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-6 py-5">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-dark rounded-full" />
                    </div>
                  ) : groupDetail ? (
                    <>
                      {/* Edit group info */}
                      <div className="mb-5 pb-5 border-b border-gray-100 dark:border-gray-800">
                        {editingGroup === group.id ? (
                          <div className="flex flex-col sm:flex-row gap-3">
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{g.groupNameLabel}</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                disabled={group.id === DEFAULT_GROUP_ID || isEntraGroup(group)}
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{g.groupDescriptionLabel}</label>
                              <input
                                type="text"
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-accent"
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <button onClick={saveEdit} className="px-3 py-2 bg-dark text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                                <Save className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingGroup(null)} className="px-3 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-sm">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {groupDetail.group?.description || <span className="italic text-gray-300 dark:text-gray-600">{t.noDescription}</span>}
                              </span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEdit(group); }}
                              disabled={!canEdit || isEntraGroup(group)}
                              className={`flex items-center gap-1 text-xs transition-colors ${
                                !canEdit || isEntraGroup(group)
                                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                  : 'text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white'
                              }`}
                            >
                              <Pencil className="w-3 h-3" />
                              {g.edit}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className={`grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-6 ${isEntraGroup(group) ? 'xl:items-stretch' : ''}`}>
                        <div className={`flex flex-col gap-3 xl:min-h-0 ${isEntraGroup(group) ? 'xl:h-auto' : 'xl:h-[560px]'}`}>
                          {!isEntraGroup(group) && (
                            <section
                            className={`rounded-2xl border border-gray-100 dark:border-gray-800 p-4 transition-all duration-300 xl:flex xl:flex-col xl:min-h-0 ${
                              activeGroupPanel === 'linked'
                                ? 'xl:flex-[1.35] bg-white dark:bg-gray-900'
                                : 'xl:flex-[0.34] bg-white/80 dark:bg-gray-950/50'
                            }`}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => setActiveGroupPanel('linked')}
                              className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-3">
                                  <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                    {g.linkedGroups} ({totalLinkedGroupCount})
                                  </h3>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAddGroups();
                                    }}
                                    disabled={!canEdit || isEntraGroup(group) || group.id === DEFAULT_GROUP_ID}
                                    className={`text-xs font-semibold transition-colors ${
                                      !canEdit || isEntraGroup(group) || group.id === DEFAULT_GROUP_ID
                                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                        : 'text-accent-dark hover:text-accent-dark'
                                    }`}
                                  >
                                    + {t.add}
                                  </button>
                                </div>
                                <p className="text-xs text-sky-600 dark:text-sky-400 mt-1">{g.linkedGroupsHelp}</p>
                              </div>
                              <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${activeGroupPanel === 'linked' ? 'rotate-180 text-dark dark:text-gray-100' : ''}`} />
                            </div>
                            <div className={`overflow-hidden transition-all duration-300 ${activeGroupPanel === 'linked' ? 'mt-4 max-h-[430px] opacity-100 xl:flex-1 xl:min-h-0' : 'max-h-0 opacity-0'}`}>
                              {totalLinkedGroupCount === 0 ? (
                                <div className="flex flex-col items-center justify-center text-center py-6 text-gray-300 dark:text-gray-600 min-h-[140px]">
                                  <Layers3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                  <p className="text-sm">{g.noLinkedGroups}</p>
                                  <p className="text-xs mt-1">{g.linkedGroupsHint}</p>
                                </div>
                              ) : (
                                <div className="space-y-2 overflow-y-auto pr-3 scrollbar-gutter-stable xl:h-full">
                                  {linkedGroups.map((childGroup) => (
                                    <div key={childGroup.id} className="flex items-center justify-between py-1.5">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Layers3 className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm text-dark dark:text-gray-100 truncate">{groupLabel(childGroup)}</span>
                                            {childGroup.source === 'entra' && (
                                              <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                                            )}
                                          </div>
                                          {childGroup.description && (
                                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{childGroup.description}</p>
                                          )}
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => removeLinkedGroup(childGroup.id, groupLabel(childGroup))}
                                        disabled={!canEdit}
                                        className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        title={g.removeLinkedGroup}
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                  {linkedEntraGroups.length > 0 && (
                                    <div className="pt-3">
                                      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                        <Layers3 className="w-3.5 h-3.5" />
                                        {g.linkedEntraGroups}
                                      </div>
                                      <div className="space-y-2">
                                        {linkedEntraGroups.map((childGroup) => (
                                          <div key={childGroup.entra_group_id} className="flex items-center justify-between py-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <Layers3 className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                                              <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                  <span className="text-sm text-dark dark:text-gray-100 truncate">{childGroup.display_name || childGroup.entra_group_id}</span>
                                                  <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                                                </div>
                                                {childGroup.description && (
                                                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{childGroup.description}</p>
                                                )}
                                              </div>
                                            </div>
                                            <button
                                              onClick={() => removeLinkedEntraGroup(childGroup.entra_group_id, childGroup.display_name || childGroup.entra_group_id)}
                                              disabled={!canEdit}
                                              className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                              title={g.removeLinkedGroup}
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            </section>
                          )}

                          <section
                            className={`rounded-2xl border border-gray-100 dark:border-gray-800 p-4 transition-all duration-300 ${
                              isEntraGroup(group)
                                ? 'xl:flex xl:flex-col bg-white dark:bg-gray-900'
                                : 'xl:flex xl:flex-col xl:min-h-0 ' + (activeGroupPanel === 'members' ? 'xl:flex-[1.35] bg-white dark:bg-gray-900' : 'xl:flex-[0.34] bg-white/80 dark:bg-gray-950/50')
                            }`}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => setActiveGroupPanel('members')}
                              className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-3">
                                  <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                    {t.members} ({groupDetail.members.length})
                                  </h3>
                                  {isEntraGroup(group) ? (
                                    <span className="text-xs font-semibold text-gray-300 dark:text-gray-600 cursor-not-allowed select-none">
                                      + {t.add}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openAddMembers();
                                      }}
                                      disabled={!canEdit || group.id === DEFAULT_GROUP_ID}
                                    className={`text-xs font-semibold transition-colors ${
                                      !canEdit || group.id === DEFAULT_GROUP_ID
                                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                        : 'text-accent-dark hover:text-accent-dark'
                                    }`}
                                  >
                                    + {t.add}
                                  </button>
                                  )}
                                </div>
                                <p className="text-xs text-sky-600 dark:text-sky-400 mt-1">
                                  {groupDetail.members.length === 0
                                    ? (!isEntraGroup(group) && totalLinkedGroupCount > 0 ? g.linkedGroupsHint : t.memberAssignedHelp)
                                    : t.memberAssignedHelp}
                                </p>
                              </div>
                              <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${activeGroupPanel === 'members' ? 'rotate-180 text-dark dark:text-gray-100' : ''}`} />
                            </div>
                            <div className={`overflow-hidden transition-all duration-300 ${isEntraGroup(group)
                              ? 'mt-4 opacity-100'
                              : activeGroupPanel === 'members'
                                ? 'mt-4 opacity-100 xl:flex-1 xl:min-h-0'
                                : 'max-h-0 opacity-0'
                            }`}>
                              {groupDetail.members.length === 0 ? (
                                <div className={`flex flex-col items-center justify-center text-center py-6 text-gray-300 dark:text-gray-600 ${
                                  isEntraGroup(group) ? 'min-h-[140px]' : 'min-h-[140px]'
                                }`}>
                                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                  <p className="text-sm">{t.noMembers}</p>
                                  <p className="text-xs mt-1">{!isEntraGroup(group) && totalLinkedGroupCount > 0 ? g.linkedGroupsHint : t.memberAssignedHelp}</p>
                                </div>
                              ) : (
                                <div className={`space-y-2 overflow-y-auto pr-3 scrollbar-gutter-stable ${isEntraGroup(group) ? 'max-h-[260px]' : 'xl:h-full'}`}>
                                  {groupDetail.members.map((m) => (
                                    <div key={m.id} className="flex items-center justify-between py-1.5">
                                      <div className="flex items-center gap-2">
                                        <UserAvatar
                                          userId={m.id}
                                          displayName={m.display_name}
                                          email={m.email}
                                          avatarColor={m.avatar_color}
                                          className="w-7 h-7"
                                          initialsClassName="text-[10px]"
                                        />
                                        <div>
                                          <span className="text-sm text-dark dark:text-gray-100">{m.display_name || m.email}</span>
                                          {m.role === 'owner' && (
                                            <span className="ml-1.5 inline-flex items-center align-middle leading-none text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-rose-950/40 dark:text-rose-300">{g.ownerBadge}</span>
                                          )}
                                          {m.role === 'admin' && (
                                            <span className="ml-1.5 inline-flex items-center align-middle leading-none gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-amber-950/40 dark:text-amber-300">
                                              <Shield className="w-3 h-3" />
                                              {g.adminBadge}
                                            </span>
                                          )}
                                          {m.role === 'admin_readonly' && (
                                            <span className="ml-1.5 inline-flex items-center align-middle leading-none gap-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded-sm font-medium">
                                              <Eye className="w-3 h-3" />
                                              {t.readOnlyRole}
                                            </span>
                                          )}
                                          {!m.last_login && (
                                            <span className="ml-1.5 inline-flex items-center align-middle leading-none gap-0.5 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-sm font-medium dark:bg-purple-900/40">
                                              <Clock className="w-3 h-3" />{t.noLogin}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {!isEntraGroup(group) && (
                                        <button
                                          onClick={() => removeMember(m.id, m.display_name)}
                                          disabled={!canEdit}
                                          className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                          title={t.removeFromGroup}
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {isEntraGroup(group) && (
                                <p className="mt-2 text-xs text-sky-600 dark:text-sky-400">{t.syncedFromEntra}</p>
                              )}
                            </div>
                          </section>
                        </div>

                        <section className={`rounded-2xl border border-gray-100 dark:border-gray-800 p-4 xl:min-h-0 xl:flex xl:flex-col ${isEntraGroup(group) ? 'xl:h-auto' : 'xl:h-[560px]'}`}>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                              {t.visibleApps} ({groupDetail.apps.length})
                            </h3>
                            <button
                              onClick={openAddApps}
                              disabled={!canEdit}
                              className="text-xs font-semibold text-accent-dark hover:text-accent-dark disabled:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              + {t.add}
                            </button>
                          </div>
                          {groupDetail.apps.length === 0 ? (
                            <div className={`flex flex-col items-center justify-center text-center py-6 text-gray-300 dark:text-gray-600 ${isEntraGroup(group) ? 'min-h-[140px]' : 'flex-1 min-h-[140px]'}`}>
                              <AppWindow className="w-8 h-8 mx-auto mb-2 opacity-40" />
                              <p className="text-sm">{t.noAppsAssigned}</p>
                              <p className="text-xs mt-1">{(linkedGroups.length + linkedEntraGroups.length) > 0 ? g.linkedGroupsHelp : t.appAssignedHelp}</p>
                            </div>
                          ) : (
                            <div className={`space-y-2 overflow-y-auto pr-3 scrollbar-gutter-stable ${isEntraGroup(group) ? 'max-h-[260px]' : 'xl:flex-1 xl:min-h-0'}`}>
                              {groupDetail.apps.map((a) => (
                                <div key={a.id} className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-2">
                                    <AppIcon app={a} className="w-6 h-6" textClassName="text-lg" />
                                    <span className="text-sm text-dark dark:text-gray-100">{a.name}</span>
                                  </div>
                                  <button
                                    onClick={() => removeApp(a.id, a.name)}
                                    disabled={!canEdit}
                                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={g.removeAppFromGroup}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </div>
                    </>
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
        summary={formatMessage(ui.admin.groups.pageSummary, pagination)}
        previousLabel={ui.common.previous}
        nextLabel={ui.common.next}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
      />

      {/* Create group modal */}
      {showCreate && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-1-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-6">
              <h2 id="groups-dialog-1-title" className="text-xl font-bold text-dark dark:text-gray-100">{g.newLocalGroup}</h2>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{g.groupNameLabel}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder={g.groupNameExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-accent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{g.groupDescriptionLabel}</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder={g.optional}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                {ui.common.cancel}
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <Save className="w-4 h-4" />
                {saving ? ui.common.saving : g.create}
              </button>
            </div>
        </Modal>
      )}

      {/* Import Entra group modal */}
      {showEntraImport && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-2-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-2xl shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="groups-dialog-2-title" className="text-xl font-bold text-dark dark:text-gray-100">{g.newEntraGroup}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {t.entraHelp}
                </p>
              </div>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <ClearableSearchField
                  value={entraSearch}
                  onChange={setEntraSearch}
                  placeholder={g.searchEntraPlaceholder}
                  clearLabel={ui.common.clearSearch}
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {g.groupsFound.replace('{count}', filteredEntraCandidates.length)} · {g.selectedCount.replace('{count}', selectedEntraGroups.length)}
                </span>
                {hasEntraSearch && (
                  <button
                    onClick={selectVisibleEntraGroups}
                    className="font-medium text-accent-dark hover:underline"
                  >
                    {g.selectAllFiltered}
                  </button>
                )}
              </div>

              {entraCandidatesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="animate-spin w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-dark rounded-full" />
                </div>
              ) : filteredEntraCandidates.length === 0 ? (
                <div className="text-center py-10 text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium">{g.noEntraGroupsDetected}</p>
                  <p className="text-xs mt-1">{g.noEntraGroupsHelp}</p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-2 border border-gray-100 dark:border-gray-800 rounded-xl p-2">
                  {filteredEntraCandidates.map((group) => {
                    const selected = selectedEntraGroups.includes(group.entra_group_id);
                    return (
                      <label
                        key={group.entra_group_id}
                        className={`flex items-start gap-3 px-3 py-3 rounded-lg border transition-colors ${
                          group.is_imported ? 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 opacity-70' : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected || group.is_imported}
                          disabled={group.is_imported}
                          onChange={() => toggleEntraGroupSelection(group.entra_group_id)}
                          className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{group.display_name}</span>
                            <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                            {group.is_imported ? (
                              <span className="text-[10px] bg-accent/10 text-accent-dark px-1.5 py-0.5 rounded-sm font-medium">{g.alreadyImported}</span>
                            ) : (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-amber-950/40 dark:text-amber-300">{g.onlyEntraDetected}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{group.entra_group_id}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {g.knownMembersInCatalog.replace('{count}', group.synced_member_count)} · {group.local_name ? g.localNamePrefix.replace('{name}', group.local_name) : g.notYetImported}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setShowEntraImport(false)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {ui.common.cancel}
              </button>
                <button
                  onClick={handleImportEntraGroups}
                  disabled={importingEntra || selectedEntraGroups.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                  {importingEntra ? g.importing : g.importSelected}
                </button>
            </div>
        </Modal>
      )}

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

      {/* Add linked groups modal */}
      {showAddGroups && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-4-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="groups-dialog-4-title" className="text-lg font-bold text-dark dark:text-gray-100">{g.addLinkedGroupsTitle}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{g.linkedGroupsHelp}</p>
              </div>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ClearableSearchField
              value={groupLinkSearch}
              onChange={setGroupLinkSearch}
              placeholder={g.linkedGroupsSearchPlaceholder}
              className="mb-3"
              clearLabel={ui.common.clearSearch}
            />
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
              <span>
                {g.groupsFound.replace('{count}', filteredLinkableGroups.length + filteredLinkableEntraGroups.length)} · {g.selectedCount.replace('{count}', selectedLinkedGroupIds.length + selectedLinkedEntraGroupIds.length)}
              </span>
              {hasGroupLinkSearch && (
                <button
                  onClick={() => {
                    selectVisibleLinkedGroups();
                    selectVisibleLinkedEntraGroups();
                  }}
                  className="font-medium text-accent-dark hover:underline"
                >
                  {g.selectAllFiltered}
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredLinkableGroups.length === 0 && filteredLinkableEntraGroups.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{g.noGroupsAvailable}</p>
              ) : (
                <>
                  {filteredLinkableGroups.length > 0 && (
                    <div className="space-y-1">
                      {filteredLinkableGroups.map((group) => (
                        <label
                          key={group.id}
                          className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedLinkedGroupIds.includes(group.id)}
                            onChange={() => toggleLinkedGroupSelection(group.id)}
                            className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{groupLabel(group)}</span>
                              {group.source === 'entra' && (
                                <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{group.id}</div>
                            {group.description && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{group.description}</div>}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  {filteredLinkableEntraGroups.length > 0 && (
                    <div className="pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        {g.linkedEntraGroups}
                      </div>
                      <div className="space-y-1">
                        {filteredLinkableEntraGroups.map((group) => (
                          <label
                            key={group.entra_group_id}
                            className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedLinkedEntraGroupIds.includes(group.entra_group_id)}
                              onChange={() => toggleLinkedEntraGroupSelection(group.entra_group_id)}
                              className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{group.display_name || group.entra_group_id}</span>
                                <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                              </div>
                              <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{group.entra_group_id}</div>
                              {group.description && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{group.description}</div>}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={closeCurrentModal}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {ui.common.cancel}
              </button>
              <button
                onClick={addLinkedGroups}
                disabled={selectedLinkedGroupIds.length === 0 && selectedLinkedEntraGroupIds.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                {g.addLinkedGroupsConfirm}
              </button>
            </div>
        </Modal>
      )}

      {/* Add apps modal */}
      {showAddApps && (
        <Modal onClose={requestCloseActiveModal} closeOnEscape={false} labelledBy="groups-dialog-5-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl" overlayClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="flex items-center justify-between mb-4">
              <h2 id="groups-dialog-5-title" className="text-lg font-bold text-dark dark:text-gray-100">{g.addAppTitle}</h2>
              <button type="button" onClick={requestCloseActiveModal} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ClearableSearchField
              value={appSearch}
              onChange={setAppSearch}
              placeholder={g.searchAppsPlaceholder}
              className="mb-3"
              clearLabel={ui.common.clearSearch}
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filteredApps.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{g.noAppsAvailable}</p>
              ) : (
                filteredApps.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => addApp(a.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
                  >
                    <AppIcon app={a} className="w-6 h-6" textClassName="text-lg" />
                    <div>
                      <div className="text-sm font-medium text-dark dark:text-gray-100">{a.name}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{a.slug}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
        </Modal>
      )}

      <ConfirmDialog {...confirmDialogProps} ui={ui} />
    </div>
  );
}
