import { RefreshCw } from 'lucide-react';

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round((ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// Live view of a running "Sync groups": phase, users done out of total, running
// counters, elapsed time and an estimate of the time left. `status` is null until
// the first poll answers. Only the title and phase are announced to screen readers:
// counters and timers change every second and are read from the progress bar.
export default function ForceSyncProgress({ status, strings }) {
  const phase = status?.phase || 'connecting';
  const total = status?.total || 0;
  const processed = status?.processed || 0;
  const inUsersPhase = phase === 'users' && total > 0;
  const percent = inUsersPhase ? Math.round((processed / total) * 100) : null;
  const phaseLabel = strings.forceSyncPhases?.[phase] || strings.forceSyncPhases?.connecting;
  const countLabel = strings.forceSyncProgressCount.replace('{processed}', processed).replace('{total}', total);
  const hasEta = Number.isFinite(status?.etaMs);

  return (
    <div className="mb-6 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-dark shadow-xs dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent-dark dark:text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div role="status" aria-live="polite">
              <div className="text-sm font-semibold">{strings.forceSyncRunningTitle}</div>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{phaseLabel}</div>
            </div>
            <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400" aria-hidden="true">
              {strings.forceSyncElapsed.replace('{time}', formatDuration(status?.elapsedMs))}
              {hasEta && ` · ${strings.forceSyncEta.replace('{time}', formatDuration(status.etaMs))}`}
            </div>
          </div>

          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
            role="progressbar"
            aria-label={strings.forceSyncRunningTitle}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-valuetext={inUsersPhase ? countLabel : phaseLabel}
          >
            {percent === null ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
            ) : (
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
            )}
          </div>

          {inUsersPhase && (
            <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs tabular-nums" aria-hidden="true">
              <span className="font-semibold">{countLabel} ({percent}%)</span>
              <span className={status.errorCount > 0 ? 'font-semibold text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}>
                {strings.forceSyncProgressDetail
                  .replace('{usersSynced}', status.usersSynced)
                  .replace('{usersNotFound}', status.usersNotFound)
                  .replace('{errorCount}', status.errorCount)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
