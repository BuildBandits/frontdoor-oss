import { randomUUID } from 'crypto';
import { BACKUP_PROGRESS_STAGES, BACKUP_VERSION, createBackupArchive } from './backup.js';

const jobs = new Map();
const cleanupTimers = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;
const STEP_ORDER = BACKUP_PROGRESS_STAGES;

function createJobState(job) {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    completedStages: job.completedStages,
    message: job.message,
    fileName: job.fileName,
    version: job.version,
    summary: job.summary,
    error: job.error,
  };
}

function publish(job) {
  const state = createJobState(job);
  for (const listener of job.listeners) {
    listener(state);
  }
  return state;
}

function scheduleCleanup(job) {
  if (cleanupTimers.has(job.id)) {
    clearTimeout(cleanupTimers.get(job.id));
    cleanupTimers.delete(job.id);
  }

  if (job.status !== 'done' && job.status !== 'error') {
    return;
  }

  const timer = setTimeout(() => {
    jobs.delete(job.id);
    cleanupTimers.delete(job.id);
  }, JOB_TTL_MS);
  timer.unref?.();
  cleanupTimers.set(job.id, timer);
}

function updateJob(job, patch) {
  Object.assign(job, patch);
  const state = publish(job);
  scheduleCleanup(job);
  return state;
}

function createBackupJob({ excludeLogs = false, passphrase = null } = {}) {
  const job = {
    id: randomUUID(),
    status: 'queued',
    stage: 'queued',
    progress: 0,
    completedStages: [],
    message: 'Preparing backup',
    fileName: null,
    version: BACKUP_VERSION,
    summary: null,
    archive: null,
    error: null,
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  publish(job);

  job.promise = (async () => {
    try {
      updateJob(job, {
        status: 'running',
        stage: 'database',
        progress: 5,
        message: 'Collecting database snapshot',
      });

      const { archive, snapshot, fileName } = await createBackupArchive({
        excludeLogs,
        passphrase,
        onProgress: ({ stage, progress, completedStages }) => {
          updateJob(job, {
            status: 'running',
            stage,
            progress,
            completedStages: completedStages || STEP_ORDER.slice(0, STEP_ORDER.indexOf(stage) + 1),
            message: stage,
          });
        },
      });

      updateJob(job, {
        status: 'done',
        stage: 'complete',
        progress: 100,
        completedStages: STEP_ORDER,
        message: 'Backup ready',
        fileName,
        version: snapshot.version,
        summary: snapshot.summary,
        archive,
      });
    } catch (error) {
      updateJob(job, {
        status: 'error',
        stage: 'error',
        message: error.message || 'Failed to create backup',
        error: error.message || 'Failed to create backup',
      });
    }
  })();

  return createJobState(job);
}

export function startBackupExportJob(options = {}) {
  return createBackupJob(options);
}

export function getBackupExportJob(jobId) {
  return jobs.get(jobId) || null;
}

export function subscribeBackupExportJob(jobId, listener) {
  const job = jobs.get(jobId);
  if (!job) {
    return () => {};
  }

  job.listeners.add(listener);
  listener(createJobState(job));

  return () => {
    job.listeners.delete(listener);
  };
}

export function getBackupExportJobArchive(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'done' || !job.archive) {
    return null;
  }

  return {
    archive: job.archive,
    fileName: job.fileName,
    version: job.version,
    summary: job.summary,
  };
}
