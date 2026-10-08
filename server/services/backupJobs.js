import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BACKUP_PROGRESS_STAGES, createBackupFile } from './backup.js';
import { BACKUP_FORMAT_V2 } from './backupFormat.js';

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
    errorCode: job.errorCode || null,
  };
}

function publish(job) {
  const state = createJobState(job);
  for (const listener of job.listeners) {
    listener(state);
  }
  return state;
}

function removeJob(job) {
  jobs.delete(job.id);
  cleanupTimers.delete(job.id);
  if (job.filePath) fs.rm(job.filePath, { force: true }, () => {});
}

function scheduleCleanup(job) {
  if (cleanupTimers.has(job.id)) {
    clearTimeout(cleanupTimers.get(job.id));
    cleanupTimers.delete(job.id);
  }

  if (job.status !== 'done' && job.status !== 'error') {
    return;
  }

  // The archive file lives in the temp dir until the job expires.
  const timer = setTimeout(() => removeJob(job), JOB_TTL_MS);
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
    version: BACKUP_FORMAT_V2,
    summary: null,
    filePath: null,
    error: null,
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  publish(job);

  job.promise = (async () => {
    const outputPath = path.join(os.tmpdir(), `frontdoor-export-${job.id}`);
    try {
      updateJob(job, {
        status: 'running',
        stage: 'database',
        progress: 5,
        message: 'Collecting database snapshot',
      });

      const { fileName, summary, version } = await createBackupFile({
        excludeLogs,
        passphrase,
        outputPath,
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
        version,
        summary,
        filePath: outputPath,
      });
    } catch (error) {
      fs.rm(outputPath, { force: true }, () => {});
      updateJob(job, {
        status: 'error',
        stage: 'error',
        message: error.message || 'Failed to create backup',
        error: error.message || 'Failed to create backup',
        errorCode: (error?.expose && error.code) || 'failed_to_create_backup',
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
  if (!job || job.status !== 'done' || !job.filePath) {
    return null;
  }

  return {
    filePath: job.filePath,
    fileName: job.fileName,
    version: job.version,
    summary: job.summary,
  };
}
