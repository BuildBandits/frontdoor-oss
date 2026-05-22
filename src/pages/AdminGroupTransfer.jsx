import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Copy, MoveRight, RefreshCw, ShieldAlert } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import PageNotice from '../components/PageNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

function groupLabel(group) {
  return group?.entra_display_name || group?.name || '';
}

export default function AdminGroupTransfer() {
  const { user } = useAuthStore();
  const [groups, setGroups] = useState([]);
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupSearch, setGroupSearch] = useState('');
  const [sourceGroupId, setSourceGroupId] = useState('');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [sourceDetail, setSourceDetail] = useState(null);
  const [loadingSourceDetail, setLoadingSourceDetail] = useState(false);
  const [mode, setMode] = useState('copy');
  const [saving, setSaving] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const ui = getUiStrings(language);
  const t = ui.admin.common;
  const g = ui.admin.groups;

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
  }, [user?.preferredLanguage]);

  useEffect(() => {
    let cancelled = false;
    api.get('/groups')
      .then((res) => {
        if (cancelled) return;
        const nextGroups = Array.isArray(res.data?.groups) ? res.data.groups : [];
        setGroups(nextGroups);
      })
      .catch(() => {
        if (!cancelled) {
          setGroups([]);
          setPageNotice({ type: 'error', message: g.transferLoadFailed });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingGroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [g.transferLoadFailed]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    return [...groups].filter((group) => {
      if (!q) return true;
      const searchable = [
        groupLabel(group),
        group.description || '',
        group.source || '',
        String(group.app_count || 0),
        String(group.member_count || 0),
      ].join(' ').toLowerCase();
      return searchable.includes(q);
    }).sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), language === 'it' ? 'it' : 'en', { sensitivity: 'base' }));
  }, [groups, groupSearch, language]);
  const sourceGroup = useMemo(
    () => groups.find((group) => group.id === sourceGroupId) || null,
    [groups, sourceGroupId],
  );
  const targetGroup = useMemo(
    () => groups.find((group) => group.id === targetGroupId) || null,
    [groups, targetGroupId],
  );
  const selectableGroups = useMemo(() => {
    const map = new Map(filteredGroups.map((group) => [group.id, group]));
    if (sourceGroup) map.set(sourceGroup.id, sourceGroup);
    if (targetGroup) map.set(targetGroup.id, targetGroup);
    return [...map.values()].sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), language === 'it' ? 'it' : 'en', { sensitivity: 'base' }));
  }, [filteredGroups, sourceGroup, targetGroup, language]);

  useEffect(() => {
    if (!sourceGroupId) {
      setSourceDetail(null);
      return undefined;
    }

    let cancelled = false;
    setLoadingSourceDetail(true);
    api.get(`/groups/${sourceGroupId}`)
      .then((res) => {
        if (!cancelled) setSourceDetail(res.data || null);
      })
      .catch(() => {
        if (!cancelled) {
          setSourceDetail(null);
          setPageNotice({ type: 'error', message: g.transferSourceLoadFailed });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSourceDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceGroupId, g.transferSourceLoadFailed]);

  useEffect(() => {
    if (!pageNotice) return undefined;
    const timer = setTimeout(() => setPageNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [pageNotice]);

  const sourceApps = Array.isArray(sourceDetail?.apps) ? sourceDetail.apps : [];
  const transferCount = sourceApps.length;
  const hasValidSelection = Boolean(sourceGroupId && targetGroupId && sourceGroupId !== targetGroupId && transferCount > 0);
  const actionLabel = mode === 'move' ? g.moveAppsAction : g.copyAppsAction;
  const actionIcon = mode === 'move' ? MoveRight : Copy;
  const ActionIcon = actionIcon;

  const openConfirm = () => {
    if (!hasValidSelection) return;
    setConfirmDialog({
      title: mode === 'move' ? g.moveConfirmTitle : g.copyConfirmTitle,
      message: (mode === 'move' ? g.moveConfirmMessage : g.copyConfirmMessage)
        .replace('{count}', String(transferCount))
        .replace('{source}', groupLabel(sourceGroup))
        .replace('{target}', groupLabel(targetGroup)),
      confirmLabel: actionLabel,
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          const res = await api.post(`/groups/${sourceGroupId}/apps/transfer`, {
            targetGroupId,
            mode,
          });
          setPageNotice({
            type: 'success',
            message: (mode === 'move' ? g.moveSuccess : g.copySuccess)
              .replace('{count}', String(mode === 'move' ? (res.data?.removedCount ?? transferCount) : (res.data?.addedCount ?? transferCount)))
              .replace('{source}', groupLabel(sourceGroup))
              .replace('{target}', groupLabel(targetGroup)),
          });
          const nextGroupsRes = await api.get('/groups');
          setGroups(Array.isArray(nextGroupsRes.data?.groups) ? nextGroupsRes.data.groups : []);
          if (sourceGroupId) {
            const refreshed = await api.get(`/groups/${sourceGroupId}`);
            setSourceDetail(refreshed.data || null);
          }
        } catch (error) {
          setPageNotice({
            type: 'error',
            message: error.response?.data?.error || g.transferFailed,
          });
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
          setSaving(false);
        }
      },
    });
  };

  const handleTransfer = () => {
    if (!hasValidSelection) {
      setPageNotice({
        type: 'warning',
        message: sourceGroupId && targetGroupId && sourceGroupId === targetGroupId
          ? g.sameGroupError
          : g.transferSelectionHelp,
      });
      return;
    }
    setSaving(true);
    openConfirm();
  };

  const previewApps = sourceApps.slice(0, 12);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
        <div>
          <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{g.transferAppsPageTitle}</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">{g.transferAppsPageSubtitle}</p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 max-sm:self-stretch max-sm:justify-center">
          <ShieldAlert className="h-4 w-4" />
          {g.transferAppsHiddenBadge}
        </div>
      </div>

      <PageNotice
        type="warning"
        title={g.transferAppsNoticeTitle}
        message={g.transferAppsNoticeHelp}
      />

      {pageNotice && (
        <div className="mt-6">
          <PageNotice
            type={pageNotice.type}
            message={pageNotice.message}
            onClose={() => setPageNotice(null)}
            closeLabel={ui.common.closeNotice}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-dark dark:text-gray-100">{g.transferAppsSelectionTitle}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{g.transferAppsSelectionHelp}</p>
            </div>

            <div className="space-y-4">
            <ClearableSearchField
              value={groupSearch}
              onChange={setGroupSearch}
              placeholder={g.transferAppsSearchPlaceholder}
              clearLabel={ui.common.clearSearch}
              tabIndex={1}
            />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{g.sourceGroupLabel}</span>
                  <select
                    value={sourceGroupId}
                    onChange={(e) => setSourceGroupId(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-dark dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent"
                    disabled={loadingGroups}
                  >
                    <option value="">{g.selectGroupPlaceholder}</option>
                    {selectableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {groupLabel(group)} ({group.app_count || 0} {g.appsCountSuffix})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{g.targetGroupLabel}</span>
                  <select
                    value={targetGroupId}
                    onChange={(e) => setTargetGroupId(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-dark dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent"
                    disabled={loadingGroups}
                  >
                    <option value="">{g.selectGroupPlaceholder}</option>
                    {selectableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {groupLabel(group)} ({group.app_count || 0} {g.appsCountSuffix})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-2">
                <button
                  type="button"
                  onClick={() => setMode('copy')}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    mode === 'copy' ? 'bg-dark text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-900 hover:text-dark dark:hover:text-white'
                  }`}
                >
                  <Copy className="h-4 w-4" />
                  {g.copyModeLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('move')}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    mode === 'move' ? 'bg-dark text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-900 hover:text-dark dark:hover:text-white'
                  }`}
                >
                  <MoveRight className="h-4 w-4" />
                  {g.moveModeLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <h2 className="text-lg font-bold text-dark dark:text-gray-100">{g.transferAppsSummaryTitle}</h2>
            {sourceGroup ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{g.sourceGroupLabel}</p>
                      <p className="mt-1 text-sm font-semibold text-dark dark:text-gray-100">{groupLabel(sourceGroup)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{sourceGroup.description || g.noDescription}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                      <div>{sourceGroup.app_count || 0} {g.appsCountSuffix}</div>
                      <div>{sourceGroup.member_count || 0} {g.membersCountSuffix}</div>
                    </div>
                  </div>
                </div>

                {loadingSourceDetail ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    {ui.common.loading}
                  </div>
                ) : transferCount === 0 ? (
                  <PageNotice type="info" message={g.noAppsToTransfer} />
                ) : (
                  <div className="rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        {g.transferAppsPreviewTitle} ({transferCount})
                      </h3>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{mode === 'move' ? g.moveModeLabel : g.copyModeLabel}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {previewApps.map((app) => (
                        <span
                          key={app.id}
                          className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200"
                        >
                          {app.name}
                        </span>
                      ))}
                      {transferCount > previewApps.length && (
                        <span className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                          +{transferCount - previewApps.length}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <PageNotice type="info" message={g.selectSourceGroupHelp} />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <h2 className="text-lg font-bold text-dark dark:text-gray-100">{g.transferAppsActionTitle}</h2>
            <div className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <div className="flex items-start gap-3">
                <ArrowRightLeft className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-dark" />
                <p>{g.transferAppsActionHelp}</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <p className="font-semibold">{g.transferAppsCautionTitle}</p>
                <p className="mt-1 text-sm leading-6">{g.transferAppsCautionHelp}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleTransfer}
                disabled={!hasValidSelection || saving || loadingSourceDetail}
                className="inline-flex items-center gap-2 rounded-2xl bg-dark px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ActionIcon className="h-4 w-4" />
                {actionLabel}
              </button>
              <div className="text-xs text-gray-400 dark:text-gray-500">
                {!sourceGroupId || !targetGroupId
                  ? g.transferSelectionHelp
                  : sourceGroupId === targetGroupId
                    ? g.sameGroupError
                    : transferCount === 0
                      ? g.noAppsToTransfer
                      : g.transferReadyHelp.replace('{count}', String(transferCount))}
              </div>
            </div>
          </div>

          {targetGroup ? (
            <div className="rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-dark dark:text-gray-100">{g.targetGroupLabel}</h2>
              <div className="mt-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-4">
                <p className="text-sm font-semibold text-dark dark:text-gray-100">{groupLabel(targetGroup)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{targetGroup.description || g.noDescription}</p>
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  {targetGroup.app_count || 0} {g.appsCountSuffix}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={ui.common.cancel}
        closeLabel={ui.common.closeDialog}
        busyLabel={ui.common.saving}
        busy={confirmBusy}
        onConfirm={confirmDialog?.onConfirm}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmDialog(null);
          setSaving(false);
        }}
      />
    </div>
  );
}
