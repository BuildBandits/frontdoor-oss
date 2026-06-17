import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, ExternalLink, Filter, Image, RefreshCw, Tag, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';
import Tooltip from '../components/Tooltip';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

const KIND_ORDER = ['app-icon', 'branding-logo'];

function AssetPreview({ asset, missingLabel }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [asset.id, asset.assetUrl]);

  if (asset.fileExists === false || imageFailed) {
    return (
      <div className="text-center text-gray-400 dark:text-gray-500">
        <Image className="mx-auto mb-2 w-10 h-10 opacity-50" />
        <p className="text-xs">{missingLabel}</p>
      </div>
    );
  }

  return (
    <img
      src={asset.assetUrl}
      alt={asset.original_name || asset.id}
      className="max-h-full max-w-full object-contain"
      onError={() => setImageFailed(true)}
    />
  );
}

export default function AdminIcons() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 25 });
  const [summary, setSummary] = useState({ total: 0, appIcon: 0, brandingLogo: 0, orphanAssets: 0 });
  const [notice, setNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [expandedAssetIds, setExpandedAssetIds] = useState([]);

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

  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleKindChange = (value) => {
    setKindFilter(value);
    setPage(1);
  };

  const handlePageSizeChange = (value) => {
    setPageSize(value);
    setPage(1);
  };

  const loadAssets = useCallback(async (requestedPage = 1) => {
    setLoading(true);
    try {
      const res = await api.get('/media-assets', {
        params: {
          limit: pageSize,
          page: requestedPage,
          kind: kindFilter !== 'all' ? kindFilter : undefined,
          q: search.trim() || undefined,
        },
      });
      const nextAssets = Array.isArray(res.data?.assets) ? res.data.assets : [];
      const nextPagination = res.data?.pagination || {
        page: requestedPage,
        pages: 1,
        total: nextAssets.length,
        limit: pageSize,
      };
      setAssets(nextAssets);
      setPagination(nextPagination);
      setSummary(res.data?.summary || {
        total: nextAssets.length,
        appIcon: nextAssets.filter((asset) => asset.kind === 'app-icon').length,
        brandingLogo: nextAssets.filter((asset) => asset.kind === 'branding-logo').length,
        orphanAssets: 0,
      });
      if (nextPagination.page !== requestedPage) {
        setPage(nextPagination.page);
      }
      setNotice(null);
      return true;
    } catch {
      setAssets([]);
      setPagination({ page: 1, pages: 1, total: 0, limit: pageSize });
      setSummary({ total: 0, appIcon: 0, brandingLogo: 0, orphanAssets: 0 });
      setNotice({ type: 'error', message: ui.admin.icons.loadFailed });
      return false;
    } finally {
      setLoading(false);
    }
  }, [kindFilter, pageSize, search, ui.admin.icons.loadFailed]);

  useEffect(() => {
    loadAssets(page);
  }, [loadAssets, page]);

  const filteredAssets = useMemo(() => {
    return [...assets].sort((a, b) => {
      const kindA = KIND_ORDER.indexOf(a.kind);
      const kindB = KIND_ORDER.indexOf(b.kind);
      if (kindA !== kindB) return kindA - kindB;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [assets]);

  const visibleAssets = useMemo(() => (
    kindFilter === 'orphan'
      ? filteredAssets.filter((asset) => asset.hasOrphanMembers)
      : filteredAssets.filter((asset) => (asset.liveCount || 0) > 0)
  ), [filteredAssets, kindFilter]);

  const counts = useMemo(() => ({
    total: summary.total,
    appIcon: summary.appIcon,
    brandingLogo: summary.brandingLogo,
    orphanAssets: summary.orphanAssets,
  }), [summary]);

  const toggleAssetDetails = (assetId) => {
    setExpandedAssetIds((current) => (
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    ));
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ type: 'success', message: ui.admin.icons.copySuccess });
    } catch {
      setNotice({ type: 'error', message: ui.admin.icons.copyFailed });
    }
  };

  const copySvg = async (asset) => {
    try {
      const response = await fetch(asset.assetUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const svgText = await response.text();
      await navigator.clipboard.writeText(svgText);
      setNotice({ type: 'success', message: ui.admin.icons.copySvgSuccess });
    } catch {
      setNotice({ type: 'error', message: ui.admin.icons.copySvgFailed });
    }
  };

  const deleteAsset = async (asset) => {
    if (asset.inUse) {
      setNotice({ type: 'error', message: ui.admin.icons.deleteBlockedTooltip });
      return;
    }
    setConfirmDialog({
      title: ui.admin.icons.deleteTitle,
      message: ui.admin.icons.deleteConfirm.replace('{name}', asset.original_name || asset.stored_file_name),
      confirmLabel: ui.admin.icons.deleteAsset,
      assetId: asset.id,
    });
  };

  const closeConfirm = () => {
    if (confirmBusy) return;
    setConfirmDialog(null);
  };

  const runConfirm = async () => {
    if (!confirmDialog?.assetId) return;
    setConfirmBusy(true);
    try {
      await api.delete(`/media-assets/${confirmDialog.assetId}`);
      setNotice({ type: 'success', message: ui.admin.icons.deleteSuccess });
      setConfirmDialog(null);
      await loadAssets(page);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.response?.status === 409
          ? ui.admin.icons.deleteBlockedTooltip
          : ui.admin.icons.deleteFailed,
      });
    } finally {
      setConfirmBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const ok = await loadAssets(page);
      if (ok) {
        setNotice({ type: 'success', message: ui.admin.icons.refreshed });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString(ui.common.dateLocale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatSize = (bytes) => {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-3 text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.icons.pageTitle}</h1>
          <p className="mt-1 max-w-2xl text-gray-500 dark:text-gray-400">{ui.admin.icons.subtitle}</p>
        </div>
      </div>

      {notice && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-medium ${
          notice.type === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-accent/30 bg-accent/10 text-dark dark:text-gray-100'
        }`}>
          {notice.message}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={search}
              onChange={handleSearchChange}
              placeholder={ui.admin.icons.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
            <Filter className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span>{ui.admin.icons.kindFilter}</span>
            <select
              value={kindFilter}
              onChange={(e) => handleKindChange(e.target.value)}
              className="bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-none"
            >
              <option value="all">{ui.common.all}</option>
              <option value="app-icon">{ui.admin.icons.kindAppIcon}</option>
              <option value="branding-logo">{ui.admin.icons.kindBrandingLogo}</option>
              <option value="orphan">{ui.admin.icons.kindOrphan}</option>
            </select>
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
            <span>{ui.admin.icons.itemsPerPage}</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
              className="bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-none"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={75}>75</option>
              <option value={100}>100</option>
            </select>
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {ui.admin.icons.refresh}
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.icons.totalAssets}</p>
          <p className="mt-1 text-2xl font-bold text-dark dark:text-gray-100">{counts.total}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.icons.totalAppIcons}</p>
          <p className="mt-1 text-2xl font-bold text-dark dark:text-gray-100">{counts.appIcon}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.icons.totalBrandingLogos}</p>
          <p className="mt-1 text-2xl font-bold text-dark dark:text-gray-100">{counts.brandingLogo}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.icons.totalOrphanAssets}</p>
          <p className="mt-1 text-2xl font-bold text-dark dark:text-gray-100">{counts.orphanAssets}</p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-16 text-center text-gray-400 dark:text-gray-500 shadow-sm">
          <Image className="mx-auto mb-3 w-12 h-12 opacity-40" />
          <p className="text-lg font-medium">{ui.admin.icons.emptyTitle}</p>
          <p className="mt-1 text-sm">{ui.admin.icons.emptyBody}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleAssets.map((asset) => (
            <article key={asset.id} className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
              <div className="aspect-[4/3] bg-gradient-to-br from-gray-50 via-white to-gray-100 p-4">
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-white/70 p-4">
                  <AssetPreview asset={asset} missingLabel={ui.admin.icons.missingFile} />
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-dark dark:text-gray-100">
                      {asset.original_name || asset.stored_file_name}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{asset.stored_file_name}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {asset.kind === 'app-icon' ? ui.admin.icons.kindAppIcon : ui.admin.icons.kindBrandingLogo}
                    </span>
                    {asset.hasOrphanMembers && (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        {ui.admin.icons.containsOrphans}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div className="rounded-xl bg-gray-50 dark:bg-gray-900 px-3 py-2">
                    <p className="font-semibold text-gray-400 dark:text-gray-500">{ui.admin.icons.sourceRef}</p>
                    <p className="truncate text-gray-700 dark:text-gray-200">{asset.source_ref || '-'}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 dark:bg-gray-900 px-3 py-2">
                    <p className="font-semibold text-gray-400 dark:text-gray-500">{ui.admin.icons.size}</p>
                    <p className="text-gray-700 dark:text-gray-200">{formatSize(asset.size_bytes)}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 dark:bg-gray-900 px-3 py-2">
                    <p className="font-semibold text-gray-400 dark:text-gray-500">{ui.admin.icons.mimeType}</p>
                    <p className="truncate text-gray-700 dark:text-gray-200">{asset.content_type}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 dark:bg-gray-900 px-3 py-2">
                    <p className="font-semibold text-gray-400 dark:text-gray-500">{ui.admin.icons.createdAt}</p>
                    <p className="truncate text-gray-700 dark:text-gray-200">{formatDate(asset.created_at)}</p>
                  </div>
                </div>

                {asset.kind === 'app-icon' && Array.isArray(asset.linkedApps) && asset.linkedApps.length > 0 && (
                  <div className="rounded-2xl border border-accent/20 bg-accent/10 px-3 py-3 text-xs text-dark dark:text-gray-100">
                    <p className="font-semibold uppercase tracking-wider text-accent-dark">{ui.admin.icons.linkedApp}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {asset.linkedApps.map((linkedApp) => (
                        <Tooltip key={linkedApp.slug || linkedApp.id} content={linkedApp.target_url || linkedApp.slug || linkedApp.name}>
                          <button
                            type="button"
                            onClick={() => linkedApp.slug && navigate(`/admin?edit=${encodeURIComponent(linkedApp.slug)}`)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-white dark:bg-gray-900 px-3 py-1.5 font-semibold text-dark dark:text-gray-100 transition-colors hover:bg-accent/10"
                            aria-label={linkedApp.target_url || linkedApp.slug || linkedApp.name}
                          >
                            <span className="truncate max-w-[180px]">{linkedApp.name}</span>
                            {linkedApp.slug && <span className="text-accent-dark">#{linkedApp.slug}</span>}
                            {linkedApp.slug && <span className="sr-only">{ui.admin.icons.openAppEditor}</span>}
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                    {asset.duplicateCount > 1 && (
                      <div className="mt-3 rounded-xl border border-accent/20 bg-white/70 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleAssetDetails(asset.id)}
                          className="flex w-full items-center justify-between gap-3 text-left text-dark dark:text-gray-100"
                        >
                          <span className="font-semibold">{ui.admin.icons.duplicateCount.replace('{count}', asset.duplicateCount)}</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-accent-dark">
                            {expandedAssetIds.includes(asset.id) ? ui.admin.icons.hideDuplicates : ui.admin.icons.showDuplicates}
                            {expandedAssetIds.includes(asset.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                        {expandedAssetIds.includes(asset.id) && (
                          <div className="mt-3 space-y-2">
                            {Array.isArray(asset.duplicateAssets) && asset.duplicateAssets.map((member) => (
                              <div key={member.id} className="flex items-center gap-3 rounded-xl border border-accent/20 bg-white dark:bg-gray-900 px-3 py-2">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                                  <AssetPreview asset={member} missingLabel={ui.admin.icons.missingFile} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-dark dark:text-gray-100">{member.original_name || member.stored_file_name}</p>
                                  <p className="truncate text-gray-600 dark:text-gray-300">{member.stored_file_name}</p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                                  {member.fileExists === false ? (
                                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                                      {ui.admin.icons.orphanBadge}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-1 font-semibold text-accent-dark">
                                      {ui.admin.icons.liveBadge}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(asset.assetUrl)}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {ui.admin.icons.copyLink}
                  </button>
                  {asset.content_type === 'image/svg+xml' && (
                    <button
                      type="button"
                      onClick={() => copySvg(asset)}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {ui.admin.icons.copySvg}
                    </button>
                  )}
                  <a
                    href={asset.assetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {ui.admin.icons.openFile}
                  </a>
                  <Tooltip content={asset.inUse ? ui.admin.icons.deleteBlockedTooltip : ui.admin.icons.deleteAsset}>
                    <button
                      type="button"
                      onClick={() => deleteAsset(asset)}
                      disabled={asset.inUse}
                      aria-label={asset.inUse ? ui.admin.icons.deleteBlockedTooltip : ui.admin.icons.deleteAsset}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {asset.inUse ? ui.admin.icons.deleteBlockedByUsage : ui.admin.icons.deleteAsset}
                    </button>
                  </Tooltip>
                  {asset.sha256 && (
                    <div className="inline-flex items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-900 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                      <Tag className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[180px]">{asset.sha256}</span>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {ui.admin.icons.paginationSummary
              .replace('{page}', pagination.page)
              .replace('{pages}', pagination.pages)
              .replace('{total}', pagination.total)}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={pagination.page <= 1}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              {ui.admin.icons.previousPage}
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
              disabled={pagination.page >= pagination.pages}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ui.admin.icons.nextPage}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ui.common.confirm}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || ui.common.confirm}
        cancelLabel={ui.common.cancel}
        closeLabel={ui.common.closeDialog}
        busyLabel={ui.common.pleaseWait}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
