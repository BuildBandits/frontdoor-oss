import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AlertCircle, AlertTriangle, Bell, CheckCheck, CheckCircle2, Info } from 'lucide-react';
import api from '../services/api';
import { formatMessage } from '../i18n';
import { formatLocalDateTime } from '../utils/dateTime';

const POLL_INTERVAL_MS = 60 * 1000;

const SEVERITY_STYLES = {
  critical: { icon: AlertCircle, className: 'text-red-600 dark:text-red-400' },
  warning: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' },
  info: { icon: Info, className: 'text-sky-600 dark:text-sky-400' },
};

// Text and target page of a notification, from its type and payload.
function describeNotification(notification, n) {
  const payload = notification.payload || {};
  const name = payload.displayName || payload.email || payload.groupName || '';
  switch (notification.type) {
    case 'user_deactivated_entra':
      return {
        title: n.types.user_deactivated_entra.title,
        body: formatMessage(n.types.user_deactivated_entra.body, { name, email: payload.email || '' }),
        to: { pathname: '/admin/users', state: { userSearch: payload.email || name } },
      };
    case 'user_first_sign_in':
      return {
        title: n.types.user_first_sign_in.title,
        body: formatMessage(n.types.user_first_sign_in.body, { name }),
        to: { pathname: '/admin/users', state: { userSearch: payload.email || name } },
      };
    case 'entra_sync_failed': {
      const first = Array.isArray(payload.errors) ? payload.errors[0] : null;
      return {
        title: n.types.entra_sync_failed.title,
        body: formatMessage(n.types.entra_sync_failed.body, {
          source: n.sources[payload.source] || payload.source || '',
          count: payload.errorCount || 0,
        }),
        detail: first?.hint || first?.message || null,
        to: { pathname: '/admin/groups' },
      };
    }
    case 'entra_group_deleted':
      return {
        title: n.types.entra_group_deleted.title,
        body: formatMessage(n.types.entra_group_deleted.body, {
          name,
          members: payload.memberCount ?? 0,
          apps: payload.appCount ?? 0,
        }),
        to: { pathname: '/admin/groups', state: { openGroupDetail: payload.groupId || payload.parentGroupId } },
      };
    default:
      return { title: notification.type, body: '', to: null };
  }
}

export default function NotificationBell({ ui, canResolve, timeZone, language }) {
  const n = ui.notifications;
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/notifications', { params: { include_resolved: 1 } });
      setNotifications(Array.isArray(res.data.notifications) ? res.data.notifications : []);
      setUnreadCount(Number(res.data.unreadCount) || 0);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Refresh on navigation and every minute while the tab is visible.
  useEffect(() => { void load(); }, [load, location.pathname]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markAllRead = async () => {
    try {
      const res = await api.post('/notifications/read', {});
      setUnreadCount(Number(res.data.unreadCount) || 0);
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch {
      // The next refresh shows the real state.
    }
  };

  const resolve = async (id) => {
    try {
      const res = await api.post(`/notifications/${id}/resolve`);
      setUnreadCount(Number(res.data.unreadCount) || 0);
      // It moves to the recently resolved list instead of disappearing.
      void load();
    } catch {
      void load();
    }
  };

  const openTarget = (notification, target) => {
    setOpen(false);
    if (!notification.is_read) {
      void api.post('/notifications/read', { ids: [notification.id] }).then((res) => {
        setUnreadCount(Number(res.data.unreadCount) || 0);
      }).catch(() => {});
      setNotifications((prev) => prev.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item)));
    }
    navigate(target.pathname, target.state ? { state: target.state } : undefined);
  };

  const label = unreadCount > 0 ? formatMessage(n.bellUnread, { count: unreadCount }) : n.bell;
  const openNotifications = notifications.filter((item) => !item.resolved_at);
  const resolvedNotifications = notifications.filter((item) => item.resolved_at);

  const renderNotification = (notification) => {
    const { title, body, detail, to } = describeNotification(notification, n);
    const resolved = Boolean(notification.resolved_at);
    const severity = SEVERITY_STYLES[notification.severity] || SEVERITY_STYLES.warning;
    const Icon = resolved ? CheckCircle2 : severity.icon;
    return (
      <li key={notification.id} className={`px-4 py-3 ${resolved ? 'opacity-70' : notification.is_read ? '' : 'bg-accent/5'}`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${resolved ? 'text-gray-400 dark:text-gray-500' : severity.className}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-dark dark:text-gray-100">
              {!resolved && !notification.is_read && <span className="sr-only">{n.unread}: </span>}
              {title}
            </p>
            {body && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300 wrap-anywhere">{body}</p>}
            {detail && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 wrap-anywhere">{detail}</p>}
            {resolved && (
              <p className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                {notification.resolved_by ? n.resolvedByAdmin : n.resolvedAutomatically}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              <span className="text-gray-400 dark:text-gray-500">
                {formatLocalDateTime(notification.resolved_at || notification.updated_at, { timeZone, locale: language })}
              </span>
              {to && (
                <button type="button" onClick={() => openTarget(notification, to)} className="font-medium text-accent-dark hover:underline">
                  {n.open}
                </button>
              )}
              {canResolve && !resolved && (
                <button type="button" onClick={() => resolve(notification.id)} className="font-medium text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white hover:underline">
                  {n.resolve}
                </button>
              )}
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative inline-flex items-center justify-center rounded-xl p-2.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.125rem] text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={n.title}
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-dark dark:text-gray-100">{n.title}</h2>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline">
                <CheckCheck className="h-3.5 w-3.5" />
                {n.markAllRead}
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {failed && notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 dark:text-gray-500">{n.loadFailed}</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 dark:text-gray-500">{n.empty}</p>
            ) : (
              <>
                {openNotifications.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500">{n.empty}</p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">{openNotifications.map(renderNotification)}</ul>
                )}
                {resolvedNotifications.length > 0 && (
                  <>
                    <h3 className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      {n.recentlyResolved}
                    </h3>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">{resolvedNotifications.map(renderNotification)}</ul>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
