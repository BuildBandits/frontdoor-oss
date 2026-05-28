import { useState, useEffect, useCallback } from 'react';
import { Activity, ChevronLeft, ChevronRight, BarChart3, Users, AppWindow, AlertCircle, Filter } from 'lucide-react';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';
import ClearableSearchField from '../components/ClearableSearchField';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

export default function AdminLogs() {
  const { user } = useAuthStore();
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState(null);
  const [topApps, setTopApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  const [brandingLanguage, setBrandingLanguage] = useState('en');

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

  const loadLogs = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await api.get('/logs', {
        params: {
          page: p,
          limit: pageSize,
          retention_days: retentionDays,
          q: search,
        },
      });
      setLogs(res.data.logs);
      setPagination(res.data.pagination);
      setStats(res.data.stats);
    } catch {
      // silently fail
    }
    setLoading(false);
  }, [pageSize, retentionDays, search]);

  const loadTopApps = useCallback(async () => {
    try {
      const res = await api.get('/logs/top-apps', { params: { days: retentionDays } });
      setTopApps(res.data.topApps);
    } catch {
      // silently fail
    }
  }, [retentionDays]);

  useEffect(() => {
    setPage(1);
  }, [search, retentionDays, pageSize]);

  useEffect(() => { loadLogs(page); }, [loadLogs, page, search, retentionDays, pageSize]);
  useEffect(() => { loadTopApps(); }, [loadTopApps]);

  const formatDate = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleDateString(ui.common.dateLocale, {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.logs.pageTitle}</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.admin.logs.subtitle}</p>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder={ui.admin.logs.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-gray-600 dark:text-gray-300">
            <Filter className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span>{ui.admin.logs.period}</span>
            <select
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value, 10))}
              className="h-12 bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-none"
            >
              {periodOptions.map((days) => (
                <option key={days} value={days}>
                  {days === 1 ? `1 ${ui.common.day}` : `${days} ${ui.common.days}`}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="text-gray-400 dark:text-gray-500">{ui.admin.logs.rows}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-12 bg-transparent text-sm font-medium text-dark dark:text-gray-100 focus:outline-none"
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

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/50 rounded-xl flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-dark dark:text-gray-100">{stats.total_accesses}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{ui.admin.logs.statsTotal}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent/10 dark:bg-accent-dark/25 rounded-xl flex items-center justify-center">
                <Users className="w-5 h-5 text-accent-dark dark:text-gray-100" />
              </div>
              <div>
                <p className="text-2xl font-bold text-dark dark:text-gray-100">{stats.unique_users}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{ui.admin.logs.statsUsers}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/50 rounded-xl flex items-center justify-center">
                <AppWindow className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-dark dark:text-gray-100">{stats.unique_apps}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{ui.admin.logs.statsApps}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top apps */}
      {topApps.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> {ui.admin.logs.topApps} ({retentionDays} {ui.common.days})
          </h2>
          <div className="space-y-2">
            {topApps.map((app, i) => {
              const maxCount = topApps[0]?.access_count || 1;
              return (
                <div key={app.slug} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-5 text-right">{i + 1}.</span>
                  <AppIcon app={app} className="w-7 h-7" textClassName="text-lg" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-dark dark:text-gray-100 truncate">{app.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">
                        {app.access_count} {ui.admin.logs.accessSummary} &middot; {app.unique_users} {ui.admin.logs.usersSummary}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                      <div
                        className="bg-accent rounded-full h-1.5 transition-all"
                        style={{ width: `${(app.access_count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Log table */}
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
            <p className="text-lg font-medium">{ui.admin.logs.emptyTitle}</p>
            <p className="text-sm mt-1">{ui.admin.logs.emptyBody}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.common.date}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.nav.users}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.nav.apps}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hidden md:table-cell">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{log.created_at_local || formatDate(log.created_at)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            userId={log.user_id}
                            displayName={log.user_name}
                            email={log.user_email}
                            avatarColor={log.avatar_color}
                            className="w-6 h-6"
                            initialsClassName="text-[10px]"
                          />
                          <div className="min-w-0">
                            <p className="text-dark dark:text-gray-100 font-medium truncate text-xs">{log.user_name || ui.admin.logs.removedUser}</p>
                            <p className="text-gray-400 dark:text-gray-500 truncate text-[11px]">{log.user_email || '-'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <AppIcon
                            app={{ icon: log.app_icon, iconUrl: log.app_icon_url }}
                            className="w-6 h-6"
                            textClassName="text-base"
                          />
                          <span className="text-dark dark:text-gray-100 text-xs font-medium truncate">{log.app_name || ui.admin.logs.removedApp}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500 hidden md:table-cell font-mono">{log.ip_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Pagina {pagination.page} di {pagination.pages} &middot; {pagination.total} log totali
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pagination.page <= 1}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
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
