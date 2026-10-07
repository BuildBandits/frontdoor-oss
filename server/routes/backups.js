import express from 'express';
import db from '../db.js';
import { authenticate, isOwner } from '../middleware/auth.js';
import {
  analyzeBackupArchive,
  assertValidPassphrase,
  createBackupArchive,
  isEncryptedBackup,
  restoreBackupArchive,
} from '../services/backup.js';
import { getBackupExportJob, getBackupExportJobArchive, startBackupExportJob, subscribeBackupExportJob } from '../services/backupJobs.js';
import { respondWithError } from '../services/errors.js';

const router = express.Router();

// Passphrases travel in a header (never in the URL) and are never logged.
function readPassphrase(req) {
  const value = req.get('x-backup-passphrase');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readExportOptions(req, source) {
  const excludeLogs = source?.excludeLogs === true || source?.excludeLogs === 'true';
  const passphrase = typeof source?.passphrase === 'string' && source.passphrase.length > 0 ? source.passphrase : readPassphrase(req);
  if (passphrase) assertValidPassphrase(passphrase);
  return { excludeLogs, passphrase };
}

function archiveContentType(archive) {
  return isEncryptedBackup(archive) ? 'application/octet-stream' : 'application/gzip';
}

router.get('/export', authenticate, isOwner, async (req, res) => {
  try {
    const { excludeLogs, passphrase } = readExportOptions(req, { excludeLogs: req.query.excludeLogs });
    const { archive, snapshot, fileName } = await createBackupArchive({ excludeLogs, passphrase });
    res.setHeader('Content-Type', archiveContentType(archive));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Backup-Version', String(snapshot.version));
    res.setHeader('X-Backup-Table-Count', String(snapshot.summary.tableCount));
    res.setHeader('X-Backup-File-Count', String(snapshot.summary.fileCount));
    res.setHeader('X-Backup-File-Bytes', String(snapshot.summary.fileBytes));
    res.send(archive);
  } catch (error) {
    console.error('Backup export failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_create_backup' });
  }
});

router.post('/export-jobs', authenticate, isOwner, async (req, res) => {
  try {
    const job = startBackupExportJob(readExportOptions(req, req.body));
    res.status(202).json({
      jobId: job.jobId,
      eventsUrl: `/api/backups/export-jobs/${job.jobId}/events`,
      downloadUrl: `/api/backups/export-jobs/${job.jobId}/file`,
    });
  } catch (error) {
    console.error('Backup export job start failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_create_backup' });
  }
});

router.get('/export-jobs/:jobId/events', authenticate, isOwner, async (req, res) => {
  const job = getBackupExportJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Backup job not found' });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendState = (state) => {
    res.write(`event: progress\ndata: ${JSON.stringify(state)}\n\n`);
    if (state.status === 'done') {
      res.write(`event: done\ndata: ${JSON.stringify(state)}\n\n`);
      res.end();
    }
    if (state.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify(state)}\n\n`);
      res.end();
    }
  };

  const unsubscribe = subscribeBackupExportJob(req.params.jobId, sendState);
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get('/export-jobs/:jobId/file', authenticate, isOwner, async (req, res) => {
  const job = getBackupExportJobArchive(req.params.jobId);
  if (!job) {
    const backupJob = getBackupExportJob(req.params.jobId);
    if (!backupJob) {
      res.status(404).json({ error: 'Backup job not found' });
      return;
    }
    res.status(409).json({ error: 'Backup job is not ready yet' });
    return;
  }

  res.setHeader('Content-Type', archiveContentType(job.archive));
  res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"`);
  res.setHeader('X-Backup-Version', String(job.version));
  res.setHeader('X-Backup-Table-Count', String(job.summary.tableCount));
  res.setHeader('X-Backup-File-Count', String(job.summary.fileCount));
  res.setHeader('X-Backup-File-Bytes', String(job.summary.fileBytes));
  res.send(job.archive);
});

const rawBackupBody = express.raw({
  type: ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
  limit: '200mb',
});

// Dry run: describe what a restore would do without changing anything.
router.post('/verify', authenticate, isOwner, rawBackupBody, async (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    res.json(await analyzeBackupArchive(buffer, { passphrase: readPassphrase(req) }));
  } catch (error) {
    console.error('Backup verification failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_verify_backup' });
  }
});

router.post(
  '/restore',
  authenticate,
  isOwner,
  rawBackupBody,
  async (req, res) => {
    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      const allowNewerVersion = req.query.allowNewer === 'true';
      const { snapshot: _snapshot, ...result } = await restoreBackupArchive(buffer, { allowNewerVersion, passphrase: readPassphrase(req) });
      // The restored users table may no longer contain the owner who started the restore.
      const sessionValid = Boolean(db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(req.user.id));
      res.json({ ...result, sessionValid });
    } catch (error) {
      console.error('Backup restore failed:', error.message);
      respondWithError(res, error, { status: 500, code: 'failed_to_restore_backup' });
    }
  }
);

export default router;
