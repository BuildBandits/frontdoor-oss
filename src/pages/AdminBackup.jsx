import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Database, Download, SearchCheck, Upload } from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import TopToastNotice from '../components/TopToastNotice';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(encrypted, now = new Date()) {
  return `frontdoor-backup-${now.toISOString().replace(/[:.]/g, '-')}.tar.gz${encrypted ? '.enc' : ''}`;
}

// Saves a download response under the name from Content-Disposition.
async function saveResponseAsFile(response, fallbackName) {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const fileName = disposition.match(/filename="([^"]+)"/i)?.[1] || fallbackName;
  const fileDownloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = fileDownloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(fileDownloadUrl), 1000);
}

export default function AdminBackup() {
  const { user } = useAuthStore();
  const fileInputRef = useRef(null);
  const exportEventSourceRef = useRef(null);
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStage, setDownloadStage] = useState('idle');
  const [completedStages, setCompletedStages] = useState([]);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [databaseBusy, setDatabaseBusy] = useState(false);
  const [verifyReport, setVerifyReport] = useState(null);
  const [excludeLogs, setExcludeLogs] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const downloadProgressResetTimer = useRef(null);

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

  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const ui = getUiStrings(language);
  const copy = ui.admin.backup;
  const backupSnapshotSteps = useMemo(() => ([
    { stage: 'database', label: copy.includesDatabase },
    { stage: 'app-icons', label: copy.includesAppIcons },
    { stage: 'branding', label: copy.includesBranding },
    { stage: 'avatars', label: copy.includesAvatars },
    { stage: 'plugins', label: copy.includesPlugins },
  ]), [copy]);

  useEffect(() => () => {
    if (downloadProgressResetTimer.current) {
      clearTimeout(downloadProgressResetTimer.current);
      downloadProgressResetTimer.current = null;
    }
    if (exportEventSourceRef.current) {
      exportEventSourceRef.current.close();
      exportEventSourceRef.current = null;
    }
  }, []);

  const pushNotice = (type, message) => setNotice({ type, message });
  const backupErrorMessage = (payload, fallback) => ({
    backup_passphrase_required: copy.passphraseRequired,
    backup_passphrase_invalid: copy.passphraseInvalid,
    backup_passphrase_too_short: copy.passphraseTooShort,
    backup_too_large: copy.backupTooLarge,
  })[payload?.code] || payload?.error || fallback;
  const passphraseHeaders = () => (restorePassphrase ? { 'X-Backup-Passphrase': restorePassphrase } : {});

  const closeExportStream = () => {
    if (exportEventSourceRef.current) {
      exportEventSourceRef.current.close();
      exportEventSourceRef.current = null;
    }
  };

  const updateExportProgress = (payload) => {
    const nextProgress = Number.isFinite(payload?.progress) ? Math.max(0, Math.min(100, payload.progress)) : 0;
    setDownloadProgress(nextProgress);
    setDownloadStage(payload?.stage || 'idle');
    setCompletedStages(Array.isArray(payload?.completedStages) ? payload.completedStages : []);
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setVerifyReport(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadBackup = async () => {
    if (downloadBusy) return;
    if (exportPassphrase && exportPassphrase.length < 12) {
      pushNotice('error', copy.passphraseTooShort);
      return;
    }
    if (exportPassphrase && exportPassphrase !== exportPassphraseConfirm) {
      pushNotice('error', copy.passphraseMismatch);
      return;
    }
    closeExportStream();
    if (downloadProgressResetTimer.current) {
      clearTimeout(downloadProgressResetTimer.current);
      downloadProgressResetTimer.current = null;
    }
    setDownloadProgress(5);
    setDownloadStage('database');
    setCompletedStages([]);
    setDownloadBusy(true);
    try {
      const startResponse = await api.post('/backups/export-jobs', { excludeLogs, passphrase: exportPassphrase || undefined });
      const { jobId, eventsUrl, downloadUrl: archiveUrl } = startResponse.data || {};
      if (!jobId || !eventsUrl || !archiveUrl) {
        throw new Error(copy.exportFailed);
      }

      await new Promise((resolve, reject) => {
        const source = new EventSource(eventsUrl);
        exportEventSourceRef.current = source;

        const finalize = () => {
          source.close();
          if (exportEventSourceRef.current === source) {
            exportEventSourceRef.current = null;
          }
        };

        source.addEventListener('progress', (event) => {
          let payload;
          try {
            payload = JSON.parse(event.data || '{}');
          } catch {
            payload = {};
          }

          updateExportProgress(payload);

          if (payload.status === 'done') {
            finalize();
            resolve(payload);
          }

          if (payload.status === 'error') {
            finalize();
            reject(new Error(payload.error || copy.exportFailed));
          }
        });

        source.addEventListener('error', () => {
          if (source.readyState === EventSource.CLOSED) {
            return;
          }
          finalize();
          reject(new Error(copy.exportFailed));
        });
      });

      const response = await fetch(archiveUrl, {
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || copy.exportFailed);
      }

      await saveResponseAsFile(response, safeFileName(Boolean(exportPassphrase)));

      const tables = Number.parseInt(response.headers.get('x-backup-table-count') || '0', 10) || 0;
      const files = Number.parseInt(response.headers.get('x-backup-file-count') || '0', 10) || 0;
      const bytes = Number.parseInt(response.headers.get('x-backup-file-bytes') || '0', 10) || 0;
      pushNotice('success', copy.exportSuccess
        .replace('{tables}', String(tables))
        .replace('{files}', String(files))
        .replace('{bytes}', formatBytes(bytes)));
    } catch (error) {
      pushNotice('error', error.response?.data ? backupErrorMessage(error.response.data, copy.exportFailed) : (error.message || copy.exportFailed));
    } finally {
      closeExportStream();
      setDownloadBusy(false);
      setDownloadProgress(100);
      if (downloadProgressResetTimer.current) {
        clearTimeout(downloadProgressResetTimer.current);
      }
      downloadProgressResetTimer.current = window.setTimeout(() => {
        setDownloadProgress(0);
        setDownloadStage('idle');
        setCompletedStages([]);
        downloadProgressResetTimer.current = null;
      }, 400);
    }
  };

  const handleRestoreFile = (event) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setVerifyReport(null);
  };

  const downloadDatabaseFile = async () => {
    if (databaseBusy) return;
    if (exportPassphrase && exportPassphrase.length < 12) {
      pushNotice('error', copy.passphraseTooShort);
      return;
    }
    if (exportPassphrase && exportPassphrase !== exportPassphraseConfirm) {
      pushNotice('error', copy.passphraseMismatch);
      return;
    }
    setDatabaseBusy(true);
    try {
      const response = await fetch('/api/backups/database', {
        credentials: 'include',
        headers: exportPassphrase ? { 'X-Backup-Passphrase': exportPassphrase } : {},
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(backupErrorMessage(payload, copy.databaseExportFailed));
      }
      await saveResponseAsFile(response, 'frontdoor-database.db');
    } catch (error) {
      pushNotice('error', error.message || copy.databaseExportFailed);
    } finally {
      setDatabaseBusy(false);
    }
  };

  const verifyBackup = async () => {
    if (!selectedFile || verifyBusy) {
      if (!selectedFile) pushNotice('error', copy.restoreMissingFile);
      return;
    }
    setVerifyBusy(true);
    try {
      const response = await fetch('/api/backups/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', ...passphraseHeaders() },
        body: selectedFile,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(backupErrorMessage(payload, copy.verifyFailed));
      setVerifyReport(payload);
    } catch (error) {
      setVerifyReport(null);
      pushNotice('error', error.message || copy.verifyFailed);
    } finally {
      setVerifyBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (!selectedFile || restoreBusy) {
      if (!selectedFile) {
        pushNotice('error', copy.restoreMissingFile);
      }
      return;
    }

    const describeRestore = (payload) => {
      const lines = [copy.restoreSuccess
        .replace('{tables}', String(payload.restoredTables || 0))
        .replace('{rows}', String(payload.restoredRows || 0))
        .replace('{files}', String(payload.restoredFiles || 0))];
      const droppedCount = Object.values(payload.droppedColumns || {}).reduce((total, columns) => total + columns.length, 0);
      if (droppedCount > 0) lines.push(copy.restoreDroppedColumns.replace('{count}', String(droppedCount)));
      if (payload.ignoredTables?.length) lines.push(copy.restoreIgnoredTables.replace('{tables}', payload.ignoredTables.join(', ')));
      if (payload.tablesNotInArchive?.length) lines.push(copy.restoreTablesNotInArchive.replace('{tables}', payload.tablesNotInArchive.join(', ')));
      const verification = payload.verification || {};
      if ((verification.integrity && verification.integrity !== 'ok') || verification.foreignKeyViolations > 0) {
        lines.push(copy.restoreVerificationIssues.replace('{count}', String(verification.foreignKeyViolations || 0)));
      }
      lines.push(payload.sessionValid ? copy.restoreReloading : copy.restoreSignInAgain);
      return lines.join(' ');
    };

    const runRestore = async ({ allowNewer = false } = {}) => {
      setRestoreBusy(true);
      try {
        const response = await fetch(`/api/backups/restore${allowNewer ? '?allowNewer=true' : ''}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...passphraseHeaders(),
          },
          body: selectedFile,
        });

        const payload = await response.json().catch(() => ({}));
        if (response.status === 409 && payload.code === 'backup_from_newer_version') {
          setConfirmDialog({
            title: copy.restoreNewerTitle,
            message: copy.restoreNewerMessage
              .replace('{source}', payload.details?.sourceVersion || '?')
              .replace('{current}', payload.details?.currentVersion || '?'),
            confirmLabel: copy.restoreAction,
            onConfirm: async () => runRestore({ allowNewer: true }),
          });
          return;
        }
        if (!response.ok) {
          throw new Error(backupErrorMessage(payload, copy.restoreFailed));
        }

        const hasWarnings = Object.keys(payload.droppedColumns || {}).length > 0
          || payload.ignoredTables?.length > 0
          || payload.verification?.foreignKeyViolations > 0
          || (payload.verification?.integrity && payload.verification.integrity !== 'ok');
        pushNotice(hasWarnings ? 'warning' : 'success', describeRestore(payload));
        clearSelectedFile();
        window.setTimeout(() => {
          if (payload.sessionValid) {
            window.location.reload();
          } else {
            window.location.assign('/login');
          }
        }, hasWarnings ? 6000 : 2500);
      } catch (error) {
        pushNotice('error', error.message || copy.restoreFailed);
      } finally {
        setRestoreBusy(false);
      }
    };

    setConfirmDialog({
      title: copy.restoreConfirmTitle,
      message: copy.restoreConfirmMessage,
      confirmLabel: copy.restoreAction,
      onConfirm: async () => runRestore(),
    });
  };

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-3 text-2xl font-extrabold text-dark dark:text-gray-100">{copy.pageTitle}</h1>
          <p className="mt-1 max-w-3xl text-gray-500 dark:text-gray-400">{copy.subtitle}</p>
        </div>
      </div>

      <TopToastNotice
        notice={notice}
        onClose={() => setNotice(null)}
        closeLabel={ui.common.closeNotice}
        positionClassName="top-4 sm:top-6"
      />

      {confirmDialog && (
        <ConfirmDialog
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={ui.common.cancel}
          closeLabel={ui.common.closeDialog}
          busyLabel={ui.common.saving}
          busy={restoreBusy}
          onConfirm={async () => {
            const run = confirmDialog.onConfirm;
            setConfirmDialog(null);
            await run?.();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <section className="flex h-full flex-col rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xs">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Download className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-dark dark:text-gray-100">{copy.exportTitle}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy.exportHelp}</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
            <p className="text-sm font-semibold text-dark dark:text-gray-100">{copy.includesTitle}</p>
            <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
              {backupSnapshotSteps.map((item) => {
                const isCompleted = completedStages.includes(item.stage);
                const isActive = downloadBusy && downloadStage === item.stage && !isCompleted;

                return (
                  <li key={item.stage} className={`flex items-start gap-2 ${isCompleted ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                    <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 transition-colors ${isCompleted ? 'text-emerald-600' : isActive ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}`} />
                    <span>{item.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-6 space-y-4">
            <p className="rounded-2xl border border-amber-100 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-950 dark:text-amber-200">
              {copy.privacyNotice}
            </p>
            <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={excludeLogs}
                onChange={(event) => setExcludeLogs(event.target.checked)}
                disabled={downloadBusy}
                className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
              />
              <span>
                <span className="block font-medium">{copy.excludeLogsLabel}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{copy.excludeLogsHelp}</span>
              </span>
            </label>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="backup-export-passphrase">{copy.passphraseLabel}</label>
              <input
                id="backup-export-passphrase"
                type="password"
                autoComplete="new-password"
                value={exportPassphrase}
                onChange={(event) => setExportPassphrase(event.target.value)}
                disabled={downloadBusy}
                className="block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-accent focus:ring-accent"
              />
              {exportPassphrase && (
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-label={copy.passphraseConfirmLabel}
                  placeholder={copy.passphraseConfirmLabel}
                  value={exportPassphraseConfirm}
                  onChange={(event) => setExportPassphraseConfirm(event.target.value)}
                  disabled={downloadBusy}
                  className="block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-accent focus:ring-accent"
                />
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">{copy.passphraseHelp}</p>
            </div>
          </div>

          {(downloadBusy || downloadProgress > 0) && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                <span>{backupSnapshotSteps.find((item) => item.stage === downloadStage)?.label || copy.exportBusy}</span>
                <span>{downloadProgress >= 100 ? '100%' : `${downloadProgress}%`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all duration-200 ease-out"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={downloadBackup}
            disabled={downloadBusy}
            className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-dark px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloadBusy ? copy.exportBusy : copy.exportAction}
          </button>
          <button
            type="button"
            onClick={downloadDatabaseFile}
            disabled={databaseBusy || downloadBusy}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database className="h-4 w-4" />
            {databaseBusy ? copy.databaseExportBusy : copy.databaseExportAction}
          </button>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{copy.databaseExportHelp}</p>
        </section>

        <section className="flex h-full flex-col rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xs">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white">
              <Upload className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-dark dark:text-gray-100">{copy.restoreTitle}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy.restoreHelp}</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-950">
            {copy.restoreWarning}
          </div>

          <div className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">{copy.restoreSelectLabel}</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tar.gz,.tgz,.json.gz,.enc,application/gzip,application/x-gzip,application/octet-stream"
              onChange={handleRestoreFile}
              className="block w-full cursor-pointer rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
            />
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
              {selectedFile ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-dark dark:text-gray-100">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{formatBytes(selectedFile.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelectedFile}
                    className="text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900"
                  >
                    {copy.clearFile}
                  </button>
                </div>
              ) : (
                <span>{copy.restoreNoFile}</span>
              )}
            </div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="backup-restore-passphrase">{copy.restorePassphraseLabel}</label>
            <input
              id="backup-restore-passphrase"
              type="password"
              autoComplete="off"
              value={restorePassphrase}
              onChange={(event) => setRestorePassphrase(event.target.value)}
              className="block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-accent focus:ring-accent"
            />
          </div>

          <button
            type="button"
            onClick={verifyBackup}
            disabled={verifyBusy || !selectedFile}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SearchCheck className="h-4 w-4" />
            {verifyBusy ? copy.verifyBusy : copy.verifyAction}
          </button>

          {verifyReport && (
            <div className="mt-4 space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 text-sm text-gray-700 dark:text-gray-200" role="status">
              <p className="font-semibold text-dark dark:text-gray-100">{copy.verifyTitle}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-gray-500 dark:text-gray-400">{copy.verifyCreated}</dt>
                <dd>{verifyReport.createdAt ? new Date(verifyReport.createdAt).toLocaleString(language) : '-'}</dd>
                <dt className="text-gray-500 dark:text-gray-400">{copy.verifySourceVersion}</dt>
                <dd>{verifyReport.sourceVersion ? `${verifyReport.sourceVersion}${verifyReport.sourceCommit ? ` (${verifyReport.sourceCommit})` : ''}` : copy.verifyUnknownVersion}</dd>
                <dt className="text-gray-500 dark:text-gray-400">{copy.verifyCurrentVersion}</dt>
                <dd>{verifyReport.currentVersion || '-'}</dd>
                <dt className="text-gray-500 dark:text-gray-400">{copy.verifyData}</dt>
                <dd>{copy.verifyTotals.replace('{tables}', String(verifyReport.tables.length)).replace('{rows}', String(verifyReport.totalRows))}</dd>
                {verifyReport.buckets.map((bucket) => (
                  <Fragment key={bucket.key}>
                    <dt className="text-gray-500 dark:text-gray-400">{({ database: copy.includesDatabase, 'app-icons': copy.includesAppIcons, branding: copy.includesBranding, avatars: copy.includesAvatars, plugins: copy.includesPlugins })[bucket.key] || bucket.key}</dt>
                    <dd>{copy.verifyFiles.replace('{files}', String(bucket.files)).replace('{bytes}', formatBytes(bucket.bytes))}</dd>
                  </Fragment>
                ))}
              </dl>
              {verifyReport.newerThanCurrent && (
                <p className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-800 dark:text-amber-200">
                  {copy.restoreNewerMessage.replace('{source}', verifyReport.sourceVersion).replace('{current}', verifyReport.currentVersion)}
                </p>
              )}
              {verifyReport.tables.some((table) => table.droppedColumns.length > 0) && (
                <p>{copy.verifyDroppedColumns} {verifyReport.tables.filter((table) => table.droppedColumns.length > 0).map((table) => `${table.name}: ${table.droppedColumns.join(', ')}`).join('; ')}</p>
              )}
              {verifyReport.ignoredTables.length > 0 && <p>{copy.verifyIgnoredTables} {verifyReport.ignoredTables.join(', ')}</p>}
              {verifyReport.tablesNotInArchive.length > 0 && <p>{copy.verifyTablesNotInArchive} {verifyReport.tablesNotInArchive.join(', ')}</p>}
              {verifyReport.warnings.length === 0 && verifyReport.tablesNotInArchive.length === 0 && (
                <p className="text-emerald-700 dark:text-emerald-300">{copy.verifyNoIssues}</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={restoreBackup}
            disabled={restoreBusy}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database className="h-4 w-4" />
            {restoreBusy ? copy.restoreBusy : copy.restoreAction}
          </button>
        </section>
      </div>
    </div>
  );
}
