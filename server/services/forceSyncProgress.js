// In-memory state of the admin "Sync groups" run, so the page can show progress
// while it runs, pick it up again after a reload, and refuse a second parallel run.
// Single process only: the state is lost on restart, which also ends any run.
// It holds counters and the final summary only, never user e-mails or names.

import { randomUUID } from 'node:crypto';

// A run that reports no progress for this long is treated as hung: a new run may
// start, and the hung one can no longer change the state.
export const FORCE_SYNC_STALE_AFTER_MS = 5 * 60 * 1000;

const RUN_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

let state = idleState();

function idleState() {
  return {
    runId: null,
    running: false,
    phase: null,
    processed: 0,
    total: 0,
    usersSynced: 0,
    usersNotFound: 0,
    errorCount: 0,
    startedAt: null,
    usersPhaseStartedAt: null,
    lastProgressAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
}

function isStale(now) {
  return state.running && now - state.lastProgressAt > FORCE_SYNC_STALE_AFTER_MS;
}

export function isForceSyncRunning(now = Date.now()) {
  return state.running && !isStale(now);
}

// Returns the id of the new run, or null when one is already running. The page
// sends its own id so it can tell its run's outcome from an earlier run's.
export function beginForceSync(requestedRunId = null, now = Date.now()) {
  if (isForceSyncRunning(now)) return null;
  const runId = typeof requestedRunId === 'string' && RUN_ID_RE.test(requestedRunId) ? requestedRunId : randomUUID();
  state = { ...idleState(), runId, running: true, phase: 'connecting', startedAt: now, lastProgressAt: now };
  return runId;
}

export function updateForceSyncProgress(runId, progress, now = Date.now()) {
  if (!state.running || state.runId !== runId) return;
  state = {
    ...state,
    phase: progress.phase,
    processed: progress.processed,
    total: progress.total,
    usersSynced: progress.usersSynced,
    usersNotFound: progress.usersNotFound,
    errorCount: progress.errorCount,
    usersPhaseStartedAt: progress.phase === 'users' && state.usersPhaseStartedAt == null ? now : state.usersPhaseStartedAt,
    lastProgressAt: now,
  };
}

export function finishForceSync(runId, { result = null, error = null } = {}, now = Date.now()) {
  if (state.runId !== runId) return;
  state = {
    ...state,
    running: false,
    phase: 'done',
    finishedAt: now,
    result,
    error,
    ...(result ? {
      processed: result.usersConsidered,
      total: result.usersConsidered,
      usersSynced: result.usersSynced,
      usersNotFound: result.usersNotFound,
      errorCount: result.errors.length,
    } : {}),
  };
}

// Remaining time from the average pace of the users done so far.
function estimateRemainingMs(now) {
  const { running, phase, processed, total, usersPhaseStartedAt } = state;
  if (!running || phase !== 'users' || usersPhaseStartedAt == null || processed < 1 || total <= processed) return null;
  return Math.round(((now - usersPhaseStartedAt) / processed) * (total - processed));
}

export function getForceSyncStatus(now = Date.now()) {
  const { startedAt, finishedAt, usersPhaseStartedAt: _usersPhase, lastProgressAt: _lastProgress, ...rest } = state;
  const stale = isStale(now);
  return {
    ...rest,
    running: state.running && !stale,
    // A hung run is reported as ended, with no result, so pages stop waiting for it.
    ...(stale ? { phase: 'done', error: { code: 'entra_sync_stalled' } } : {}),
    startedAt: startedAt != null ? new Date(startedAt).toISOString() : null,
    finishedAt: finishedAt != null ? new Date(finishedAt).toISOString() : null,
    elapsedMs: startedAt != null ? (finishedAt ?? now) - startedAt : 0,
    etaMs: stale ? null : estimateRemainingMs(now),
  };
}

// Tests only.
export function resetForceSyncProgress() {
  state = idleState();
}
