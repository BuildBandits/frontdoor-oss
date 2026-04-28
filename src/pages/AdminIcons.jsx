import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Filter, Image, RefreshCw, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import ClearableSearchField from '../components/ClearableSearchField';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

const KIND_ORDER = ['app-icon', 'branding-logo'];

function AssetPreview({ asset, missingLabel }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [asset.id, asset.assetUrl]);

  if (imageFailed) {
    return (
      <div className="text-center text-gray-400">
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
  const [notice, setNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/media-assets', {
        params: {
          limit: 500,
          kind: kindFilter !== 'all' ? kindFilter : undefined,
          q: search.trim() || undefined,
        },
      });
      setAssets(Array.isArray(res.data?.assets) ? res.data.assets : []);
      setNotice(null);
      return true;
    } catch {
      setAssets([]);
      setNotice({ type: 'error', message: ui.admin.icons.loadFailed });
      return false;
    } finally {
      setLoading(false);
    }
  }, [kindFilter, search, ui.admin.icons.loadFailed]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const filteredAssets = useMemo(() => {
    return [...assets].sort((a, b) => {
      const kindA = KIND_ORDER.indexOf(a.kind);
      const kindB = KIND_ORDER.indexOf(b.kind);
      if (kindA !== kindB) return kindA - kindB;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [assets]);

  const counts = useMemo(() => ({
    total: assets.length,
    appIcon: assets.filter((asset) => asset.kind === 'app-icon').length,
    brandingLogo: assets.filter((asset) => asset.kind === 'branding-logo').length,
  }), [assets]);

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
      await loadAssets();
    } catch {
      setNotice({ type: 'error', message: ui.admin.icons.deleteFailed });
    } finally {
      setConfirmBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const ok = await loadAssets();
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
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <ShieldCheck className="w-3.5 h-3.5" />
            {ui.admin.icons.hiddenBadge}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold text-dark">{ui.admin.icons.pageTitle}</h1>
          <p className="mt-1 max-w-2xl text-gray-500">{ui.admin.icons.subtitle}</p>
        </div>
        <div className="text-sm text-gray-400">
          {ui.admin.icons.visibleOnlyOnDemand}
        </div>
      </div>

      {notice && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-medium ${
          notice.type === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {notice.message}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder={ui.admin.icons.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
            />
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <Filter className="w-4 h-4 text-gray-400" />
            <span>{ui.admin.icons.kindFilter}</span>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="bg-transparent text-sm font-medium text-dark focus:outline-none"
            >
              <option value="all">{ui.common.all}</option>
              <option value="app-icon">{ui.admin.icons.kindAppIcon}</option>
              <option value="branding-logo">{ui.admin.icons.kindBrandingLogo}</option>
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

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{ui.admin.icons.totalAssets}</p>
          <p className="mt-1 text-2xl font-bold text-dark">{counts.total}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{ui.admin.icons.totalAppIcons}</p>
          <p className="mt-1 text-2xl font-bold text-dark">{counts.appIcon}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{ui.admin.icons.totalBrandingLogos}</p>
          <p className="mt-1 text-2xl font-bold text-dark">{counts.brandingLogo}</p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center text-gray-400 shadow-sm">
          <Image className="mx-auto mb-3 w-12 h-12 opacity-40" />
          <p className="text-lg font-medium">{ui.admin.icons.emptyTitle}</p>
          <p className="mt-1 text-sm">{ui.admin.icons.emptyBody}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAssets.map((asset) => (
            <article key={asset.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="aspect-[4/3] bg-gradient-to-br from-gray-50 via-white to-gray-100 p-4">
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/70 p-4">
                  <AssetPreview asset={asset} missingLabel={ui.admin.icons.missingFile} />
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-dark">
                      {asset.original_name || asset.stored_file_name}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">{asset.stored_file_name}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                    {asset.kind === 'app-icon' ? ui.admin.icons.kindAppIcon : ui.admin.icons.kindBrandingLogo}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-400">{ui.admin.icons.sourceRef}</p>
                    <p className="truncate text-gray-700">{asset.source_ref || '-'}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-400">{ui.admin.icons.size}</p>
                    <p className="text-gray-700">{formatSize(asset.size_bytes)}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-400">{ui.admin.icons.mimeType}</p>
                    <p className="truncate text-gray-700">{asset.content_type}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-400">{ui.admin.icons.createdAt}</p>
                    <p className="truncate text-gray-700">{formatDate(asset.created_at)}</p>
                  </div>
                </div>

                {asset.kind === 'app-icon' && Array.isArray(asset.linkedApps) && asset.linkedApps.length > 0 && (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-3 py-3 text-xs text-emerald-800">
                    <p className="font-semibold uppercase tracking-wider text-emerald-600">{ui.admin.icons.linkedApp}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {asset.linkedApps.map((linkedApp) => (
                        <button
                          key={linkedApp.slug || linkedApp.id}
                          type="button"
                          onClick={() => linkedApp.slug && navigate(`/admin?edit=${encodeURIComponent(linkedApp.slug)}`)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                          title={linkedApp.target_url || linkedApp.slug || linkedApp.name}
                        >
                          <span className="truncate max-w-[180px]">{linkedApp.name}</span>
                          {linkedApp.slug && <span className="text-emerald-500">#{linkedApp.slug}</span>}
                          {linkedApp.slug && <span className="sr-only">{ui.admin.icons.openAppEditor}</span>}
                        </button>
                      ))}
                    </div>
                    {asset.duplicateCount > 1 && (
                      <p className="mt-2 text-emerald-700">{ui.admin.icons.duplicateCount.replace('{count}', asset.duplicateCount)}</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(asset.assetUrl)}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {ui.admin.icons.copyLink}
                  </button>
                  {asset.content_type === 'image/svg+xml' && (
                    <button
                      type="button"
                      onClick={() => copySvg(asset)}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {ui.admin.icons.copySvg}
                    </button>
                  )}
                  <a
                    href={asset.assetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {ui.admin.icons.openFile}
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteAsset(asset)}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {ui.admin.icons.deleteAsset}
                  </button>
                  {asset.sha256 && (
                    <div className="inline-flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
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
