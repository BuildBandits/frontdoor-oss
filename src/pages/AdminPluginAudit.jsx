import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, Filter, PlugZap, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AuditDetails from '../components/AuditDetails';
import ClearableSearchField from '../components/ClearableSearchField';
import { useAuthStore } from '../stores/authStore';
import { formatMessage, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import { describeAuditLog } from '../utils/auditFormatters';
import { formatIsoDateTime } from '../utils/dateTime';
import { normalizeTimeZone, resolveAppTimeZone } from '../../shared/timeZones.js';

const PRIVILEGED_ROLES = new Set(['owner', 'admin', 'admin_readonly']);
const ACTION_OPTIONS = ['approve', 'revoke'];

export default function AdminPluginAudit() {
  const { user } = useAuthStore();
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [refs, setRefs] = useState({});
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [adminUsers, setAdminUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  const [selectedActorId, setSelectedActorId] = useState('');
  const [brandingLanguage, setBrandingLanguage] = useState('en');
  const [brandingTimeZone, setBrandingTimeZone] = useState('UTC');
  const timeZone = resolveAppTimeZone(user?.preferredTimeZone, brandingTimeZone);

  useEffect(() => {
    let cancelled = false;
    api.get('/branding')
      .then((res) => {
        if (!cancelled) {
          setBrandingLanguage(normalizeLanguage(res.data?.branding?.defaultLanguage));
          setBrandingTimeZone(normalizeTimeZone(res.data?.branding?.defaultTimeZone, 'UTC'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrandingLanguage('en');
          setBrandingTimeZone('UTC');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));

  useEffect(() => {
    let cancelled = false;

    const loadAdmins = async () => {
      try {
        const res = await api.get('/users');
        if (cancelled) return;
        const admins = (res.data.users || []).filter((currentUser) => PRIVILEGED_ROLES.has(currentUser.role));
        setAdminUsers(admins);
      } catch {
        if (!cancelled) setAdminUsers([]);
      }
    };

    loadAdmins();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadLogs = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await api.get('/logs/audit', {
        params: {
          page: p,
          limit: pageSize,
          retention_days: retentionDays,
          q: search,
          target_type: 'plugin',
          action: action || undefined,
          actor_id: selectedActorId || undefined,
        },
      });
      setLogs(res.data.logs);
      setRefs(res.data.refs || {});
      setPagination(res.data.pagination);
    } catch {
      setLogs([]);
      setRefs({});
    }
    setLoading(false);
  }, [action, pageSize, retentionDays, search, selectedActorId]);

  useEffect(() => {
    setPage(1);
  }, [action, search, retentionDays, pageSize, selectedActorId]);

  useEffect(() => { loadLogs(page); }, [loadLogs, page]);

  const formatDate = (iso) => formatIsoDateTime(iso, timeZone) || iso || '-';

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {ui.admin.pluginAudit.badge}
            </div>
          </div>
          <h1 className="mt-3 text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.pluginAudit.pageTitle}</h1>
          <p className="mt-1 max-w-3xl text-gray-500 dark:text-gray-400">{ui.admin.pluginAudit.subtitle}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/plugins"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-dark dark:text-gray-100 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <PlugZap className="h-4 w-4" />
            {ui.admin.pluginAudit.backToPlugins}
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            <ShieldCheck className="h-4 w-4" />
            {ui.common.refresh}
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-violet-100 dark:border-violet-900/40 bg-violet-50/70 dark:bg-violet-950/20 p-4 text-sm text-violet-800 dark:text-violet-200">
        {ui.admin.pluginAudit.notice}
      </div>

      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder={ui.admin.pluginAudit.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="text-gray-400 dark:text-gray-500">{ui.admin.audit.admin}</span>
            <select
              value={selectedActorId}
              onChange={(e) => setSelectedActorId(e.target.value)}
              className="h-12 bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-hidden max-w-[220px]"
            >
              <option value="">{ui.admin.audit.allAdmins}</option>
              {adminUsers.map((currentUser) => (
                <option key={currentUser.id} value={currentUser.id}>
                  {currentUser.display_name || currentUser.email}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-gray-600 dark:text-gray-300">
            <Filter className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span>{ui.admin.audit.action}</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="h-12 bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-hidden"
            >
              <option value="">{ui.admin.pluginAudit.allActions}</option>
              {ACTION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {ui.admin.pluginAudit.actionLabels[value] || value}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-gray-600 dark:text-gray-300">
            <Filter className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span>{ui.admin.audit.period}</span>
            <select
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value, 10))}
              className="h-12 bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-hidden"
            >
              {periodOptions.map((days) => (
                <option key={days} value={days}>
                  {days === 1 ? `1 ${ui.common.day}` : `${days} ${ui.common.days}`}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="text-gray-400 dark:text-gray-500">{ui.admin.audit.rows}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-12 bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-hidden"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={150}>150</option>
              <option value={200}>200</option>
              <option value={250}>250</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="animate-pulse p-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-50 dark:bg-gray-900 rounded-lg" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">{ui.admin.pluginAudit.emptyTitle}</p>
            <p className="text-sm mt-1">{ui.admin.pluginAudit.emptyBody}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.common.date}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.admin}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.action}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.pluginAudit.plugin}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.details}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 align-top">
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(log.created_at)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            userId={log.actor_id}
                            displayName={log.actor_name}
                            email={log.actor_email}
                            avatarColor={null}
                            className="w-6 h-6"
                            initialsClassName="text-[10px]"
                          />
                          <div className="min-w-0">
                            <p className="text-dark dark:text-gray-100 font-medium truncate text-xs">{log.actor_name || ui.admin.audit.actorLabels?.[log.actor_id] || ui.admin.audit.removedUser}</p>
                            <p className="text-gray-400 dark:text-gray-500 truncate text-[11px]">{log.actor_email || '-'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          log.action === 'approve'
                            ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                        }`}>
                          {ui.admin.pluginAudit.actionLabels[log.action] || log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-dark dark:text-gray-100">{log.target_id || '-'}</span>
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{log.details?.name || log.details?.version || ui.admin.pluginAudit.pluginFallback}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 min-w-[280px]">
                        <AuditDetails event={describeAuditLog(log, { ui, refs })} ui={ui} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {formatMessage(ui.admin.pluginAudit.pageSummary, { page: pagination.page, pages: pagination.pages, total: pagination.total })}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={pagination.page <= 1}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
                    disabled={pagination.page >= pagination.pages}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
