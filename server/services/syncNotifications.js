import { NOTIFICATION_TYPES, raiseNotification, resolveNotifications } from './notifications.js';

// Notifications raised by the Microsoft Entra sync (sign-in and force sync).

const MAX_ERRORS_IN_PAYLOAD = 5;

/**
 * One notification per sync path ('sign-in', 'force-sync'): raised while that path
 * fails, resolved on its own by the next run without errors. Error messages carry
 * no object IDs (see fetchGraphPage), so they are safe to show.
 */
export function recordEntraSyncOutcome(source, errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    resolveNotifications(NOTIFICATION_TYPES.ENTRA_SYNC_FAILED, source);
    return;
  }
  raiseNotification({
    type: NOTIFICATION_TYPES.ENTRA_SYNC_FAILED,
    subjectKey: source,
    severity: 'critical',
    payload: {
      source,
      errorCount: errors.length,
      errors: errors.slice(0, MAX_ERRORS_IN_PAYLOAD).map((error) => ({
        scope: error.scope || null,
        message: error.message || null,
        hint: error.hint || null,
      })),
    },
  });
}

/** One notification per user deactivated because Microsoft Entra no longer has the account. */
export function notifyUsersDeactivatedFromEntra(users) {
  for (const user of users) {
    raiseNotification({
      type: NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA,
      subjectKey: user.id,
      severity: 'warning',
      payload: { userId: user.id, email: user.email, displayName: user.display_name || null, role: user.role },
    });
  }
}
