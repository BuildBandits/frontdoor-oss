import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Database, Download, Upload } from 'lucide-react';
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

function safeFileName(now = new Date()) {
  return `frontdoor-backup-${now.toISOString().replace(/[:.]/g, '-')}.json.gz`;
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

  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));
  const copy = ui.admin.backup;
  const backupSnapshotSteps = useMemo(() => ([
    { stage: 'database', label: copy.includesDatabase },
    { stage: 'app-icons', label: copy.includesAppIcons },
    { stage: 'branding', label: copy.includesBranding },
    { stage: 'avatars', label: copy.includesAvatars },
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadBackup = async () => {
    if (downloadBusy) return;
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
      const startResponse = await api.post('/backups/export-jobs');
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

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/i);
      const fileName = match?.[1] || safeFileName();
      const fileDownloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = fileDownloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileDownloadUrl), 1000);

      const tables = Number.parseInt(response.headers.get('x-backup-table-count') || '0', 10) || 0;
      const files = Number.parseInt(response.headers.get('x-backup-file-count') || '0', 10) || 0;
      const bytes = Number.parseInt(response.headers.get('x-backup-file-bytes') || '0', 10) || 0;
      pushNotice('success', copy.exportSuccess
        .replace('{tables}', String(tables))
        .replace('{files}', String(files))
        .replace('{bytes}', formatBytes(bytes)));
    } catch (error) {
      pushNotice('error', error.message || copy.exportFailed);
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
  };

  const restoreBackup = async () => {
    if (!selectedFile || restoreBusy) {
      if (!selectedFile) {
        pushNotice('error', copy.restoreMissingFile);
      }
      return;
    }

    setConfirmDialog({
      title: copy.restoreConfirmTitle,
      message: copy.restoreConfirmMessage,
      confirmLabel: copy.restoreAction,
      onConfirm: async () => {
        setRestoreBusy(true);
        try {
          const body = await selectedFile.arrayBuffer();
          const response = await fetch('/api/backups/restore', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': selectedFile.type || 'application/gzip',
            },
            body,
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || copy.restoreFailed);
          }

          pushNotice('success', copy.restoreSuccess
            .replace('{tables}', String(payload.restoredTables || 0))
            .replace('{rows}', String(payload.restoredRows || 0))
            .replace('{files}', String(payload.restoredFiles || 0)));
          clearSelectedFile();
          window.setTimeout(() => {
            window.location.assign('/login');
          }, 1500);
        } catch (error) {
          pushNotice('error', error.message || copy.restoreFailed);
        } finally {
          setRestoreBusy(false);
        }
      },
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
        <section className="flex h-full flex-col rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
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
        </section>

        <section className="flex h-full flex-col rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
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
              accept=".json.gz,application/gzip,application/x-gzip"
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
          </div>

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
