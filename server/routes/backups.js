import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import db from '../db.js';
import { authenticate, isOwner } from '../middleware/auth.js';
import {
  analyzeBackupFile,
  assertValidPassphrase,
  createBackupFile,
  isEncryptedBackup,
  restoreBackupFile,
  writeDatabaseFile,
} from '../services/backup.js';
import { getBackupExportJob, getBackupExportJobArchive, startBackupExportJob, subscribeBackupExportJob } from '../services/backupJobs.js';
import { respondWithError, UserFacingError } from '../services/errors.js';

const router = express.Router();

function maxUploadBytes() {
  const megabytes = Number.parseInt(process.env.BACKUP_MAX_UPLOAD_MB || '', 10);
  return (Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 1024) * 1024 * 1024;
}

function tempPath(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${randomUUID()}`);
}

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

async function readHead(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    await handle.read(head, 0, 8, 0);
    return head;
  } finally {
    await handle.close();
  }
}

// Streams an uploaded backup to a temporary file instead of buffering it in memory.
async function receiveUpload(req) {
  const declared = Number.parseInt(req.get('content-length') || '', 10);
  const limit = maxUploadBytes();
  if (Number.isFinite(declared) && declared > limit) {
    throw new UserFacingError('The backup file is too large.', { statusCode: 413, code: 'backup_too_large' });
  }
  const filePath = tempPath('frontdoor-upload');
  let received = 0;
  try {
    await pipeline(
      req,
      async function* limitSize(source) {
        for await (const chunk of source) {
          received += chunk.length;
          if (received > limit) throw new UserFacingError('The backup file is too large.', { statusCode: 413, code: 'backup_too_large' });
          yield chunk;
        }
      },
      fs.createWriteStream(filePath),
    );
  } catch (error) {
    await fsp.rm(filePath, { force: true });
    throw error;
  }
  if (received === 0) {
    await fsp.rm(filePath, { force: true });
    throw new UserFacingError('Backup file is empty');
  }
  return filePath;
}

// Sends a file as a download and removes it afterwards when requested.
function sendFile(res, filePath, { contentType, fileName, headers = {}, removeAfter = false }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  const stream = fs.createReadStream(filePath);
  const done = () => {
    if (removeAfter) fs.rm(filePath, { force: true }, () => {});
  };
  stream.on('error', (error) => {
    done();
    res.destroy(error);
  });
  res.on('close', done);
  stream.pipe(res);
}

function summaryHeaders(version, summary) {
  return {
    'X-Backup-Version': String(version),
    'X-Backup-Table-Count': String(summary?.tableCount ?? 0),
    'X-Backup-File-Count': String(summary?.fileCount ?? 0),
    'X-Backup-File-Bytes': String(summary?.fileBytes ?? 0),
  };
}

router.get('/export', authenticate, isOwner, async (req, res) => {
  const outputPath = tempPath('frontdoor-export');
  try {
    const { excludeLogs, passphrase } = readExportOptions(req, { excludeLogs: req.query.excludeLogs });
    const { fileName, summary, version } = await createBackupFile({ excludeLogs, passphrase, outputPath });
    sendFile(res, outputPath, {
      contentType: passphrase ? 'application/octet-stream' : 'application/gzip',
      fileName,
      headers: summaryHeaders(version, summary),
      removeAfter: true,
    });
  } catch (error) {
    await fsp.rm(outputPath, { force: true });
    console.error('Backup export failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_create_backup' });
  }
});

// Raw SQLite copy for upgrade rehearsals; optional passphrase in X-Backup-Passphrase.
router.get('/database', authenticate, isOwner, async (req, res) => {
  const outputPath = tempPath('frontdoor-database');
  try {
    const passphrase = readPassphrase(req);
    const { fileName } = await writeDatabaseFile({ passphrase, outputPath });
    sendFile(res, outputPath, {
      contentType: passphrase ? 'application/octet-stream' : 'application/vnd.sqlite3',
      fileName,
      removeAfter: true,
    });
  } catch (error) {
    await fsp.rm(outputPath, { force: true });
    console.error('Database export failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_export_database' });
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

  // The job keeps the file until it expires, so the download can be retried.
  sendFile(res, job.filePath, {
    contentType: isEncryptedBackup(await readHead(job.filePath)) ? 'application/octet-stream' : 'application/gzip',
    fileName: job.fileName,
    headers: summaryHeaders(job.version, job.summary),
  });
});

// Dry run: describe what a restore would do without changing anything.
router.post('/verify', authenticate, isOwner, async (req, res) => {
  let uploadPath = null;
  try {
    uploadPath = await receiveUpload(req);
    res.json(await analyzeBackupFile(uploadPath, { passphrase: readPassphrase(req) }));
  } catch (error) {
    console.error('Backup verification failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_verify_backup' });
  } finally {
    if (uploadPath) await fsp.rm(uploadPath, { force: true });
  }
});

router.post('/restore', authenticate, isOwner, async (req, res) => {
  let uploadPath = null;
  try {
    uploadPath = await receiveUpload(req);
    const allowNewerVersion = req.query.allowNewer === 'true';
    const result = await restoreBackupFile(uploadPath, { allowNewerVersion, passphrase: readPassphrase(req) });
    // The restored users table may no longer contain the owner who started the restore.
    const sessionValid = Boolean(db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(req.user.id));
    res.json({ ...result, sessionValid });
  } catch (error) {
    console.error('Backup restore failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_restore_backup' });
  } finally {
    if (uploadPath) await fsp.rm(uploadPath, { force: true });
  }
});

export default router;
