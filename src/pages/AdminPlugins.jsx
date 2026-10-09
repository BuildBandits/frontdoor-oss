import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  BookOpen,
  FileJson,
  PencilLine,
  PlugZap,
  RefreshCw,
  Route,
  Sparkles,
  ShieldCheck,
  Upload,
  Trash2,
  PlayCircle,
} from 'lucide-react';
import { Link } from 'react-router';
import api from '../services/api';
import Tooltip from '../components/Tooltip';
import { useAuthStore } from '../stores/authStore';
import { formatMessage, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import { apiErrorMessage } from '../utils/apiErrors';
import { usePluginRegistry } from '../pluginHost/registry';
import { moduleExample } from '../pluginHost/pluginDocsContent';
import {
  analyzePluginPackage,
  buildPluginPackageFromForm,
  buildPluginPackageFromRecord,
  serializePluginPackage,
} from '../pluginHost/packageUtils';
import {
  buildPluginPackageZip,
  extractPluginPackageZip,
} from '../../shared/packageZip';

const EMPTY_FORM = {
  id: '',
  name: '',
  version: '1.0.0',
  description: '',
  author: '',
  homepage: '',
  entry: '',
  permissions: '',
  roles: '',
  backendEnabled: false,
  backendUrl: '',
  eventSubscriptions: '',
  enabled: true,
  packageSource: '',
  moduleSource: '',
};

function formatList(values, emptyValue = '') {
  if (!Array.isArray(values) || values.length === 0) return emptyValue;
  return values.join(', ');
}

function splitInputList(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pluginToForm(plugin) {
  const manifest = plugin?.manifest || {};
  return {
    id: manifest.id || plugin?.id || '',
    name: manifest.name || plugin?.name || '',
    version: manifest.version || plugin?.version || '1.0.0',
    description: manifest.description || plugin?.description || '',
    author: manifest.author || '',
    homepage: manifest.homepage || '',
    entry: plugin?.entry || manifest.entry || '',
    permissions: formatList(manifest.permissions || plugin?.permissions || []),
    roles: formatList(manifest.roles || plugin?.roles || []),
    backendEnabled: Boolean(plugin?.backendEnabled),
    backendUrl: plugin?.backendUrl || '',
    eventSubscriptions: formatList(plugin?.eventSubscriptions || manifest.backend?.eventSubscriptions || []),
    enabled: plugin?.enabled !== false,
    packageSource: '',
    moduleSource: '',
  };
}

async function readTextFile(file) {
  if (!file) return '';
  return await file.text();
}

async function readArrayBufferFile(file) {
  if (!file) return new ArrayBuffer(0);
  return await file.arrayBuffer();
}

export default function AdminPlugins() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';
  // Read-only admins can browse plugins but not install, edit, test or delete them.
  const canEdit = user?.role !== 'admin_readonly';
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const snapshot = usePluginRegistry();
  const [serverPlugins, setServerPlugins] = useState([]);
  const [serverError, setServerError] = useState('');
  const [serverMessage, setServerMessage] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [reviewState, setReviewState] = useState(null);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const plugins = snapshot.plugins;
  const totalRoutes = plugins.reduce((sum, plugin) => sum + (plugin.routes?.length || 0), 0);
  const readyCount = plugins.filter((plugin) => plugin.status === 'ready').length;
  const errorCount = plugins.filter((plugin) => plugin.status === 'error').length;
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
  const t = ui.admin.plugins;
  const translateStatus = (status) => ({
    approved: t.pluginStatusApproved,
    disabled: t.pluginStatusDisabled,
    pending: t.pluginStatusPending,
  }[status] || status || t.pluginStatusUnknown);
  const translateRiskLevel = (riskLevel) => ({
    high: t.riskHigh,
    medium: t.riskMedium,
    low: t.riskLow,
  }[riskLevel] || riskLevel || t.pluginStatusUnknown);
  const translateBoolean = (value) => (value ? t.enabled : t.disabled);
  const translateCheckDetail = (check) => (
    check.detailKey
      ? formatMessage(t.analysis.details[check.detailKey] || check.detailKey, { value: check.detail })
      : check.detail
  );

  const backendEnabledCount = serverPlugins.filter((plugin) => plugin.backendEnabled).length;
  const enabledServerCount = serverPlugins.filter((plugin) => plugin.enabled && plugin.approved).length;

  const draftPackage = useMemo(() => buildPluginPackageFromForm(form), [form]);

  async function loadServerPlugins() {
    try {
      const res = await api.get('/plugins');
      setServerPlugins(Array.isArray(res.data?.plugins) ? res.data.plugins : []);
      setServerError('');
    } catch (error) {
      setServerPlugins([]);
      setServerError(apiErrorMessage(error, ui, t.failedLoadServerRegistry));
    }
  }

  const loadInitialPlugins = useEffectEvent(() => {
    void loadServerPlugins();
  });

  useEffect(() => {
    loadInitialPlugins();
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId('');
    setServerMessage(null);
  }

  function closeReviewWizard() {
    setReviewState(null);
    setReviewAcknowledged(false);
  }

  function openReviewWizard(packageData, meta = {}) {
    setReviewState({
      title: meta.title || t.packageValidation,
      pluginId: meta.pluginId || null,
      pluginName: meta.pluginName || packageData?.manifest?.name || packageData?.manifest?.id || t.packageName,
      canApprove: Boolean(meta.canApprove),
      packageData,
      analysis: analyzePluginPackage(packageData),
    });
    setReviewAcknowledged(false);
  }

  async function openReviewWizardForPlugin(plugin) {
    const packageData = buildPluginPackageFromRecord(plugin);
    if (typeof plugin.entry === 'string' && plugin.entry.startsWith('/api/plugins/files/')) {
      try {
        const response = await fetch(plugin.entry, { credentials: 'include' });
        if (response.ok) {
          packageData.moduleSource = await response.text();
        }
      } catch {
        // Best effort: keep the review available even if the bundle cannot be fetched.
      }
    }
    openReviewWizard(packageData, {
      title: formatMessage(t.packageReviewTitle, { name: plugin.name }),
      pluginId: plugin.id,
      pluginName: plugin.name,
      canApprove: isOwner && plugin.status === 'pending',
    });
  }

  function handleExportPackage(packageData, filename = 'plugin-package.json') {
    const blob = new Blob([serializePluginPackage(packageData)], { type: 'application/json;charset=utf-8' });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }

  function openForEdit(plugin) {
    setEditingId(plugin.id);
    setForm(pluginToForm(plugin));
    setServerMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleManifestFile(file) {
    if (!file) return;
    try {
      const text = await readTextFile(file);
      const manifest = JSON.parse(text);
      setForm((current) => ({
        ...current,
        id: manifest.id ?? current.id,
        name: manifest.name ?? current.name,
        version: manifest.version ?? current.version,
        description: manifest.description ?? current.description,
        author: manifest.author ?? current.author,
        homepage: manifest.homepage ?? current.homepage,
        entry: manifest.entry ?? current.entry,
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions.join('\n') : current.permissions,
        roles: Array.isArray(manifest.roles) ? manifest.roles.join('\n') : current.roles,
        backendEnabled: Boolean(manifest.backend?.enabled ?? current.backendEnabled),
        backendUrl: manifest.backend?.url ?? current.backendUrl,
        eventSubscriptions: Array.isArray(manifest.backend?.eventSubscriptions)
          ? manifest.backend.eventSubscriptions.join('\n')
          : current.eventSubscriptions,
        packageSource: '',
        moduleSource: '',
      }));
      setServerMessage({ type: 'success', text: t.manifestLoadedFrom.replace('{file}', file.name) });
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t.manifestReadFailed,
      });
    }
  }

  async function handleModuleFile(file) {
    if (!file) return;
    try {
      const text = await readTextFile(file);
      setForm((current) => ({
        ...current,
        moduleSource: text,
        packageSource: '',
      }));
      setServerMessage({ type: 'success', text: t.moduleLoadedFrom.replace('{file}', file.name) });
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t.moduleReadFailed,
      });
    }
  }

  async function handlePackageFile(file) {
    if (!file) return;
    try {
      const text = await readTextFile(file);
      const parsed = JSON.parse(text);
      const manifest = parsed.manifest && typeof parsed.manifest === 'object' ? parsed.manifest : parsed;
      setForm((current) => ({
        ...current,
        id: manifest.id ?? current.id,
        name: manifest.name ?? current.name,
        version: manifest.version ?? current.version,
        description: manifest.description ?? current.description,
        author: manifest.author ?? current.author,
        homepage: manifest.homepage ?? current.homepage,
        entry: manifest.entry || parsed.entry || (typeof parsed.moduleSource === 'string' ? '' : current.entry),
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions.join('\n') : current.permissions,
        roles: Array.isArray(manifest.roles) ? manifest.roles.join('\n') : current.roles,
        backendEnabled: Boolean(manifest.backend?.enabled ?? current.backendEnabled),
        backendUrl: manifest.backend?.url ?? current.backendUrl,
        eventSubscriptions: Array.isArray(manifest.backend?.eventSubscriptions)
          ? manifest.backend.eventSubscriptions.join('\n')
          : current.eventSubscriptions,
        packageSource: text,
        moduleSource: typeof parsed.moduleSource === 'string' ? parsed.moduleSource : '',
      }));
      setServerMessage({ type: 'success', text: t.packageLoadedFrom.replace('{file}', file.name) });
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t.packageReadFailed,
      });
    }
  }

  async function handlePackageZipFile(file) {
    if (!file) return;
    try {
      const bytes = await readArrayBufferFile(file);
      const parsed = extractPluginPackageZip(bytes);
      const manifest = parsed.manifest && typeof parsed.manifest === 'object' ? parsed.manifest : {};
      const packageData = {
        manifest,
        moduleSource: parsed.moduleSource,
      };
      setForm((current) => ({
        ...current,
        id: manifest.id ?? current.id,
        name: manifest.name ?? current.name,
        version: manifest.version ?? current.version,
        description: manifest.description ?? current.description,
        author: manifest.author ?? current.author,
        homepage: manifest.homepage ?? current.homepage,
        entry: manifest.entry ?? current.entry,
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions.join('\n') : current.permissions,
        roles: Array.isArray(manifest.roles) ? manifest.roles.join('\n') : current.roles,
        backendEnabled: Boolean(manifest.backend?.enabled ?? current.backendEnabled),
        backendUrl: manifest.backend?.url ?? current.backendUrl,
        eventSubscriptions: Array.isArray(manifest.backend?.eventSubscriptions)
          ? manifest.backend.eventSubscriptions.join('\n')
          : current.eventSubscriptions,
        packageSource: serializePluginPackage(packageData),
        moduleSource: parsed.moduleSource,
      }));
      setServerMessage({ type: 'success', text: t.archiveLoadedFrom.replace('{file}', file.name) });
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.archiveReadFailed),
      });
    }
  }

  function handleExportDraftPackage() {
    const filename = `${form.id.trim() || 'plugin'}-package.json`;
    handleExportPackage(draftPackage, filename);
    setServerMessage({
      type: 'success',
      text: t.packageExportedAs.replace('{filename}', filename),
    });
  }

  function handleExportDraftZip() {
    try {
      const bytes = buildPluginPackageZip(draftPackage, {
        packageName: form.id.trim() || form.name.trim() || 'plugin-package',
      });
      const filename = `${form.id.trim() || 'plugin'}-package.zip`;
      const blob = new Blob([bytes], { type: 'application/zip' });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setServerMessage({
        type: 'success',
        text: t.zipExportedAs.replace('{filename}', filename),
      });
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.failedExportZip),
      });
    }
  }

  async function handleWizardApprove() {
    if (!reviewState?.pluginId) return;
    setBusyId(`${reviewState.pluginId}:approval`);
    setServerMessage(null);
    try {
      const response = await api.post(`/plugins/${reviewState.pluginId}/approve`);
      setServerMessage({
        type: 'success',
        text: formatMessage(t.pluginApprovedAndActivated, { name: response.data?.plugin?.name || reviewState.pluginName }),
      });
      closeReviewWizard();
      await loadServerPlugins();
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.failedApprovePlugin),
      });
    } finally {
      setBusyId('');
    }
  }

  async function handleApproval(plugin, approved) {
    setBusyId(`${plugin.id}:approval`);
    setServerMessage(null);
    try {
      const response = await api.post(`/plugins/${plugin.id}/${approved ? 'approve' : 'revoke'}`);
      setServerMessage({
        type: 'success',
        text: approved
          ? formatMessage(t.pluginApprovedAndActivated, { name: response.data?.plugin?.name || plugin.name })
          : formatMessage(t.pluginApprovalRevoked, { name: response.data?.plugin?.name || plugin.name }),
      });
      await loadServerPlugins();
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.failedUpdatePluginApproval),
      });
    } finally {
      setBusyId('');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusyId('submit');
    setServerMessage(null);

    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      version: form.version.trim() || '1.0.0',
      description: form.description.trim(),
      author: form.author.trim(),
      homepage: form.homepage.trim(),
      entry: form.entry.trim(),
      permissions: splitInputList(form.permissions),
      roles: splitInputList(form.roles),
      backendEnabled: form.backendEnabled,
      backendUrl: form.backendUrl.trim(),
      eventSubscriptions: splitInputList(form.eventSubscriptions),
      enabled: form.enabled,
      packageSource: form.packageSource.trim(),
      moduleSource: form.moduleSource.trim(),
    };

    try {
      const response = await api.post('/plugins/import', payload);
      const plugin = response.data?.plugin;
      setServerMessage({
        type: 'success',
        text: plugin
          ? formatMessage(t.pluginInstalledPendingApprovalNamed, { name: plugin.name || plugin.id })
          : t.pluginInstalledPendingApproval,
      });
      resetForm();
      await loadServerPlugins();
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.failedInstallPlugin),
      });
    } finally {
      setBusyId('');
    }
  }

  async function handleDelete(plugin) {
    if (!window.confirm(formatMessage(t.deletePluginConfirm, { name: plugin.name }))) return;
    setBusyId(plugin.id);
    setServerMessage(null);
    try {
      await api.delete(`/plugins/${plugin.id}`);
      setServerMessage({ type: 'success', text: formatMessage(t.pluginDeleted, { name: plugin.name }) });
      if (editingId === plugin.id) resetForm();
      await loadServerPlugins();
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.failedDeletePlugin),
      });
    } finally {
      setBusyId('');
    }
  }

  async function handleTestBackend(plugin) {
    setBusyId(`${plugin.id}:test`);
    setServerMessage(null);
    try {
      const response = await api.post(`/plugins/${plugin.id}/test-event/auth.login`, {
        payload: {
          reason: 'manual admin test',
          pluginId: plugin.id,
        },
      });
      const summary = response.data?.summary;
      setServerMessage({
        type: 'success',
        text: summary
          ? t.testEventSentWithCounts.replace('{delivered}', summary.delivered).replace('{failed}', summary.failed)
          : t.testEventSent,
      });
    } catch (error) {
      setServerMessage({
        type: 'error',
        text: apiErrorMessage(error, ui, t.failedTestPluginBackend),
      });
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="pb-24">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <PlugZap className="h-3.5 w-3.5" />
            {ui.admin.plugins.badge}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.plugins.title}</h1>
          <p className="mt-1 max-w-3xl text-gray-500 dark:text-gray-400">{ui.admin.plugins.subtitle}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/plugins/docs"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30"
          >
            <BookOpen className="h-4 w-4" />
            {ui.admin.plugins.pluginDocsAction}
          </Link>
          {isOwner && (
            <Link
              to="/admin/plugins/audit"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-dark dark:text-gray-100 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <ShieldCheck className="h-4 w-4" />
              {ui.admin.plugins.pluginAuditAction}
            </Link>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            <RefreshCw className="h-4 w-4" />
            {ui.common.refresh}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-8">
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/35 text-violet-600 dark:text-violet-300">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.loadedLabel}</div>
              <div className="text-2xl font-extrabold text-dark dark:text-gray-100">{plugins.length}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/35 text-emerald-600 dark:text-emerald-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.readyLabel}</div>
              <div className="text-2xl font-extrabold text-dark dark:text-gray-100">{readyCount}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/35 text-amber-600 dark:text-amber-300">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.errorLabel}</div>
              <div className="text-2xl font-extrabold text-dark dark:text-gray-100">{errorCount}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/35 text-sky-600 dark:text-sky-300">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.routesLabel}</div>
              <div className="text-2xl font-extrabold text-dark dark:text-gray-100">{totalRoutes}</div>
            </div>
          </div>
        </div>
      </div>

      {serverError && (
        <div className="mb-6 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {serverError}
        </div>
      )}

      {serverMessage && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
          serverMessage.type === 'error'
            ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
            : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
        }`}>
          {serverMessage.text}
        </div>
      )}

      <div className="mb-8 space-y-6">
        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 font-bold text-dark dark:text-gray-100">
            <Upload className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            {editingId ? t.updatePlugin : t.installPlugin}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t.installIntro}
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            {!canEdit && (
              <p className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/40 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">{ui.admin.apps.readOnly}</p>
            )}
            <fieldset disabled={!canEdit} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.pluginIdLabel}</span>
                <input
                  value={form.id}
                  onChange={(event) => setForm((current) => ({ ...current, id: event.target.value, packageSource: '' }))}
                  placeholder="ticket-plugin"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.versionLabel}</span>
                <input
                  value={form.version}
                  onChange={(event) => setForm((current) => ({ ...current, version: event.target.value, packageSource: '' }))}
                  placeholder="1.0.0"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.nameLabel}</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, packageSource: '' }))}
                  placeholder={t.namePlaceholder}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.authorLabel}</span>
                <input
                  value={form.author}
                  onChange={(event) => setForm((current) => ({ ...current, author: event.target.value, packageSource: '' }))}
                  placeholder="Frontdoor"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.descriptionLabel}</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value, packageSource: '' }))}
                rows="3"
                placeholder={t.descriptionPlaceholder}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.homepageLabel}</span>
                <input
                  value={form.homepage}
                  onChange={(event) => setForm((current) => ({ ...current, homepage: event.target.value, packageSource: '' }))}
                  placeholder="https://example.com/plugin"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.entryUrlLabel}</span>
                <input
                  value={form.entry}
                  onChange={(event) => setForm((current) => ({ ...current, entry: event.target.value, packageSource: '' }))}
                  placeholder="/api/plugins/files/ticket-plugin/1.0.0/latest/index.mjs"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.permissionsFormLabel}</span>
                <textarea
                  value={form.permissions}
                  onChange={(event) => setForm((current) => ({ ...current, permissions: event.target.value, packageSource: '' }))}
                  rows="3"
                  placeholder="actions.write&#10;routes.write&#10;surfaces.write"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.rolesFormLabel}</span>
                <textarea
                  value={form.roles}
                  onChange={(event) => setForm((current) => ({ ...current, roles: event.target.value, packageSource: '' }))}
                  rows="3"
                  placeholder="owner&#10;admin"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked, packageSource: '' }))}
                    className="h-4 w-4 rounded-sm border-gray-300 text-violet-600 focus:ring-violet-500"
                  />
                  {t.enabledLabel}
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={form.backendEnabled}
                    onChange={(event) => setForm((current) => ({ ...current, backendEnabled: event.target.checked, packageSource: '' }))}
                    className="h-4 w-4 rounded-sm border-gray-300 text-violet-600 focus:ring-violet-500"
                  />
                  {t.backendWebhookLabel}
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.backendUrlLabel}</span>
                  <input
                    value={form.backendUrl}
                    onChange={(event) => setForm((current) => ({ ...current, backendUrl: event.target.value, packageSource: '' }))}
                    placeholder="https://plugins.example.com/frontdoor-webhook"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.eventSubscriptionsLabel}</span>
                  <textarea
                    value={form.eventSubscriptions}
                    onChange={(event) => setForm((current) => ({ ...current, eventSubscriptions: event.target.value, packageSource: '' }))}
                    rows="3"
                    placeholder="auth.login&#10;app.access"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2.5 text-sm text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.packageLabel}</span>
                <input
                  type="file"
                  accept="application/json,.json,.frontdoor-plugin"
                  onChange={(event) => {
                    void handlePackageFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-xl file:border-0 file:bg-violet-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-violet-500 dark:text-gray-300"
                />
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{t.packageHelp}</p>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.archiveLabel}</span>
                <input
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onChange={(event) => {
                    void handlePackageZipFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-xl file:border-0 file:bg-violet-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-violet-500 dark:text-gray-300"
                />
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{t.archiveHelp}</p>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.manifestFileLabel}</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    void handleManifestFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-xl file:border-0 file:bg-gray-900 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-gray-800 dark:text-gray-300"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.moduleFileLabel}</span>
                <input
                  type="file"
                  accept=".js,.mjs,.ts,.tsx,text/javascript"
                  onChange={(event) => {
                    void handleModuleFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-xl file:border-0 file:bg-gray-900 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-gray-800 dark:text-gray-300"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-dark dark:text-gray-100">{t.moduleSourceLabel}</span>
              <textarea
                value={form.moduleSource}
                onChange={(event) => setForm((current) => ({ ...current, moduleSource: event.target.value, packageSource: '' }))}
                rows="10"
                placeholder={moduleExample()}
                className="w-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-3 font-mono text-[12px] leading-6 text-dark dark:text-gray-100 outline-hidden transition focus:border-violet-400"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busyId === 'submit'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyId === 'submit' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {editingId ? t.updatePlugin : t.installPlugin}
              </button>
              <button
                type="button"
                onClick={handleExportDraftPackage}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <FileJson className="h-4 w-4" />
                {t.exportPackage}
              </button>
              <Tooltip content={t.zipNeedsModuleSource} enabled={!draftPackage.moduleSource}>
                <button
                  type="button"
                  onClick={handleExportDraftZip}
                  disabled={!draftPackage.moduleSource}
                  aria-label={t.exportZip}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 dark:border-violet-900/60 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Boxes className="h-4 w-4" />
                  {t.exportZip}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={() => openReviewWizard(draftPackage, {
                  title: t.draftPackageValidation,
                  pluginId: form.id.trim() || null,
                  pluginName: form.name.trim() || form.id.trim() || t.draftPackageName,
                  canApprove: false,
                })}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 dark:border-violet-900/60 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30"
              >
                <ShieldCheck className="h-4 w-4" />
                {t.reviewPackage}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t.reset}
              </button>
            </div>
            </fieldset>
          </form>
        </section>
      </div>

      <section className="mb-8 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
          <Boxes className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          {ui.admin.plugins.serverRegistryTitle}
        </div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{ui.admin.plugins.serverRegistrySubtitle}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.serverRegistryTotal}</div>
            <div className="mt-1 text-xl font-extrabold text-dark dark:text-gray-100">{serverPlugins.length}</div>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.serverRegistryEnabled}</div>
            <div className="mt-1 text-xl font-extrabold text-dark dark:text-gray-100">{enabledServerCount}</div>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.serverRegistryBackend}</div>
            <div className="mt-1 text-xl font-extrabold text-dark dark:text-gray-100">{backendEnabledCount}</div>
          </div>
        </div>
      </section>

      {serverPlugins.length > 0 ? (
        <div className="space-y-4">
          {serverPlugins.map((plugin) => (
            <article key={plugin.id} className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-xs">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-dark dark:text-gray-100">{plugin.name}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      plugin.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : plugin.status === 'disabled'
                          ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                    }`}>
                      {translateStatus(plugin.status)}
                    </span>
                    <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                      v{plugin.version}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{plugin.description || ui.admin.plugins.noDescription}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400 dark:text-gray-500">
                    <span><strong className="text-gray-600 dark:text-gray-300">{ui.admin.plugins.idLabel}:</strong> {plugin.id}</span>
                    <span><strong className="text-gray-600 dark:text-gray-300">{ui.admin.plugins.entryLabel}:</strong> {plugin.entry || t.none}</span>
                    <span><strong className="text-gray-600 dark:text-gray-300">{ui.admin.plugins.sourceLabel}:</strong> {plugin.source || ui.admin.plugins.localSource}</span>
                    <span><strong className="text-gray-600 dark:text-gray-300">{ui.admin.plugins.permissionsLabel}:</strong> {formatList(plugin.permissions, t.none)}</span>
                    <span><strong className="text-gray-600 dark:text-gray-300">{ui.admin.plugins.rolesLabel}:</strong> {formatList(plugin.roles, t.none)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 lg:min-w-[280px]">
                  <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.actionsLabel}</div>
                    <div className="mt-1 text-xl font-extrabold text-dark dark:text-gray-100">{plugin.actions.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.surfacesLabel}</div>
                    <div className="mt-1 text-xl font-extrabold text-dark dark:text-gray-100">{plugin.surfaces.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{ui.admin.plugins.routesLabel}</div>
                    <div className="mt-1 text-xl font-extrabold text-dark dark:text-gray-100">{plugin.routes.length}</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                  <button
                  type="button"
                  onClick={() => void openReviewWizardForPlugin(plugin)}
                  className="inline-flex items-center gap-2 rounded-xl border border-violet-200 dark:border-violet-900/60 px-3 py-2 text-sm font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {t.reviewPackageButton}
                </button>
                  <button
                  type="button"
                  onClick={() => openForEdit(plugin)}
                  disabled={!canEdit}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PencilLine className="h-4 w-4" />
                  {t.edit}
                </button>
                {isOwner && plugin.status !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => void handleApproval(plugin, true)}
                    disabled={busyId === `${plugin.id}:approval`}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900/60 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === `${plugin.id}:approval` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {t.approve}
                  </button>
                )}
                {isOwner && plugin.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => void handleApproval(plugin, false)}
                    disabled={busyId === `${plugin.id}:approval`}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-900/60 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === `${plugin.id}:approval` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                    {t.revokeApproval}
                  </button>
                )}
                <Tooltip content={t.testBackendDisabledTitle} enabled={plugin.status !== 'approved'}>
                  <button
                    type="button"
                    onClick={() => void handleTestBackend(plugin)}
                    disabled={!canEdit || !plugin.backendEnabled || plugin.status !== 'approved' || busyId === `${plugin.id}:test`}
                    aria-label={t.testBackend}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === `${plugin.id}:test` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                    {t.testBackend}
                  </button>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => void handleDelete(plugin)}
                  disabled={!canEdit || busyId === plugin.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/60 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {t.delete}
                </button>
              </div>

              {plugin.backendEnabled && (
                <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                  <strong className="text-gray-700 dark:text-gray-200">{ui.admin.plugins.serverRegistryBackend}:</strong> {plugin.backendUrl || t.configured} · <strong className="text-gray-700 dark:text-gray-200">{ui.admin.plugins.eventsLabel}:</strong> {formatList(plugin.eventSubscriptions, t.none)}
                </div>
              )}

              {plugin.error && (
                <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  <div className="font-semibold">{ui.admin.plugins.pluginErrorTitle}</div>
                  <div className="mt-0.5">{plugin.error}</div>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-8 text-center">
          <PlugZap className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
          <h2 className="mt-4 text-lg font-bold text-dark dark:text-gray-100">{ui.admin.plugins.emptyTitle}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{ui.admin.plugins.emptyBody}</p>
        </div>
      )}

      {reviewState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/70 p-4">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-800 px-6 py-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t.validationWizard}
                </div>
                <h2 className="mt-3 text-2xl font-extrabold text-dark dark:text-gray-100">{reviewState.title}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.reviewPackageIntro}</p>
              </div>
              <button
                type="button"
                onClick={closeReviewWizard}
                className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t.close}
              </button>
            </div>

            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="border-b border-gray-100 dark:border-gray-800 lg:border-b-0 lg:border-r">
                <div className="p-6">
                  <div className={`rounded-2xl px-4 py-3 ${
                    reviewState.analysis.riskLevel === 'high'
                      ? 'bg-red-50 dark:bg-red-950/30'
                      : reviewState.analysis.riskLevel === 'medium'
                        ? 'bg-amber-50 dark:bg-amber-950/30'
                        : 'bg-emerald-50 dark:bg-emerald-950/30'
                  }`}>
                    <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t.riskLevel}</div>
                    <div className="mt-1 text-2xl font-extrabold text-dark dark:text-gray-100">{translateRiskLevel(reviewState.analysis.riskLevel)}</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {t.scoreLabel} {reviewState.analysis.score} · {reviewState.analysis.valid ? t.packageStructureValid : t.packageStructureInvalid}
                    </div>
                  </div>

                  <div className="mt-5 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                    <div><strong className="text-gray-700 dark:text-gray-200">{t.pluginLabel}:</strong> {reviewState.pluginName}</div>
                    <div><strong className="text-gray-700 dark:text-gray-200">{t.entrySummaryLabel}:</strong> {reviewState.analysis.summary.entry || t.none}</div>
                    <div><strong className="text-gray-700 dark:text-gray-200">{t.moduleSourceSummaryLabel}:</strong> {reviewState.analysis.summary.moduleSource ? t.present : t.missing}</div>
                    <div><strong className="text-gray-700 dark:text-gray-200">{t.backendSummaryLabel}:</strong> {translateBoolean(reviewState.analysis.summary.backendEnabled)}</div>
                  </div>

                  {reviewState.analysis.warnings.length > 0 && (
                    <div className="mt-5 space-y-2">
                      {reviewState.analysis.warnings.map((warning) => (
                        <div key={warning} className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/25 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
                          {t.analysis.warnings[warning] || warning}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4">
                    <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.checklist}</div>
                    <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                      {reviewState.analysis.checks.map((check) => (
                        <div key={check.key} className="flex items-start gap-3">
                          <span className={`mt-0.5 inline-flex h-2.5 w-2.5 rounded-full ${
                            check.status === 'fail'
                              ? 'bg-red-500'
                              : check.status === 'warn'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`} />
                          <div>
                            <div className="font-semibold text-gray-700 dark:text-gray-200">{t.analysis.checks[check.key] || check.key}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{translateCheckDetail(check)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {reviewState.canApprove && isOwner && (
                    <label className="mt-5 flex items-start gap-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950/40 p-4 text-sm text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={reviewAcknowledged}
                        onChange={(event) => setReviewAcknowledged(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded-sm border-gray-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span>
                        {t.iReviewed}
                      </span>
                    </label>
                  )}

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleExportPackage(reviewState.packageData, `${reviewState.pluginId || 'plugin'}-package.json`)}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <FileJson className="h-4 w-4" />
                      {t.exportPackage}
                    </button>
                    {reviewState.packageData.moduleSource && (
                      <button
                        type="button"
                        onClick={() => {
                          const bytes = buildPluginPackageZip(reviewState.packageData, {
                            packageName: reviewState.pluginId || reviewState.packageData.manifest?.id || 'plugin-package',
                          });
                          const filename = `${reviewState.pluginId || 'plugin'}-package.zip`;
                          const blob = new Blob([bytes], { type: 'application/zip' });
                          const objectUrl = window.URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = objectUrl;
                          link.download = filename;
                          link.rel = 'noreferrer';
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                          window.URL.revokeObjectURL(objectUrl);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 dark:border-violet-900/60 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30"
                      >
                        <Boxes className="h-4 w-4" />
                        {t.exportZip}
                      </button>
                    )}
                    {reviewState.canApprove && isOwner && (
                      <button
                        type="button"
                        onClick={() => void handleWizardApprove()}
                        disabled={!reviewAcknowledged || !reviewState.analysis.valid || busyId === `${reviewState.pluginId}:approval`}
                        className="inline-flex items-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyId === `${reviewState.pluginId}:approval` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {t.approvePlugin}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
                  <FileJson className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                  {t.rawPackage}
                </div>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t.rawPackageHelp}</p>
                <pre className="mt-4 overflow-x-auto rounded-2xl bg-gray-950 px-4 py-3 text-[12px] leading-6 text-gray-100">
                  {serializePluginPackage(reviewState.packageData)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {snapshot.loadErrors.length > 0 && (
        <div className="mt-8 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4">
          <div className="mb-3 flex items-center gap-2 text-red-700 dark:text-red-300 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            {ui.admin.plugins.errorsTitle}
          </div>
          <div className="space-y-2">
            {snapshot.loadErrors.map((error) => (
              <div key={error.id} className="rounded-xl border border-red-100 dark:border-red-900/50 bg-white/70 dark:bg-gray-900/80 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                <div className="font-semibold">{error.source || error.pluginId || ui.admin.plugins.unknownSource}</div>
                <div className="mt-0.5 text-red-600/90 dark:text-red-200/90">{error.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
