import { useState, useEffect, useCallback } from 'react';
import { Activity, BarChart3, Users, AppWindow, AlertCircle, Filter } from 'lucide-react';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
import DataTable from '../components/DataTable';
import { tableQueryParams } from '../utils/tableQuery';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { useAuthStore } from '../stores/authStore';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useBrandingLanguage, useBrandingTimeZone } from '../stores/brandingStore';
import { formatMessage, getUiStrings, resolveAppLanguage } from '../i18n';
import { formatLocalDateTime } from '../utils/dateTime';
import { resolveAppTimeZone } from '../../shared/timeZones.js';
import DocsHelpLink from '../components/DocsHelpLink';

// Columns the access log API can filter on, and the parameter each one uses.
const QUERY_COLUMNS = {
  user: { param: 'user_q', type: 'text' },
  app: { param: 'app_q', type: 'text' },
  ip: { param: 'ip_q', type: 'text' },
};
// Server-side sorting: any truthy value marks the column as sortable.
const SORTABLE = { date: true, user: true, app: true, ip: true };

export default function AdminLogs() {
  const { user } = useAuthStore();
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState(null);
  const [topApps, setTopApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const [search, setSearch] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  const brandingLanguage = useBrandingLanguage();
  const brandingTimeZone = useBrandingTimeZone();
  const timeZone = resolveAppTimeZone(user?.preferredTimeZone, brandingTimeZone);

  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));

  const debouncedSearch = useDebouncedValue(search);
  const debouncedFilters = useDebouncedValue(columnFilters);
  // Only the latest request may update the list (an older, slower answer would
  // otherwise overwrite newer results).
  const { begin: beginLogsRequest } = useLatestRequest();
  const loadLogs = useCallback(async (p = 1) => {
    const isLatest = beginLogsRequest();
    setLoading(true);
    try {
      const res = await api.get('/logs', {
        params: {
          page: p,
          limit: pageSize,
          retention_days: retentionDays,
          q: debouncedSearch,
          ...tableQueryParams({ sorting, columnFilters: debouncedFilters, columns: QUERY_COLUMNS }),
        },
      });
      if (!isLatest()) return;
      setLogs(res.data.logs);
      setPagination(res.data.pagination);
      setStats(res.data.stats);
      setLoadFailed(false);
    } catch {
      if (!isLatest()) return;
      setLoadFailed(true);
    }
    setLoading(false);
  }, [beginLogsRequest, pageSize, retentionDays, debouncedSearch, sorting, debouncedFilters]);

  const loadTopApps = useCallback(async () => {
    try {
      const res = await api.get('/logs/top-apps', { params: { days: retentionDays } });
      setTopApps(res.data.topApps);
    } catch {
      // silently fail
    }
  }, [retentionDays]);

  useEffect(() => { loadLogs(pageIndex + 1); }, [loadLogs, pageIndex]);
  useEffect(() => { loadTopApps(); }, [loadTopApps]);

  const formatDate = (iso) => (iso ? formatLocalDateTime(iso, { locale: ui.common.dateLocale, timeZone, seconds: true }) || iso : '-');

  const tt = ui.common.table;
  const tableLabels = {
    ...tt,
    filterColumn: (column) => formatMessage(tt.filterColumn, { column }),
    pageSummary: (summary) => formatMessage(ui.admin.logs.pageSummary, summary),
    previous: ui.common.previous,
    next: ui.common.next,
    noRows: ui.admin.logs.emptyTitle,
  };
  const CELL = 'px-5 py-3';
  const columns = [
    {
      id: 'date',
      header: ui.common.date,
      hideable: false,
      cellClassName: `${CELL} text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap`,
      cell: (log) => formatDate(log.created_at),
    },
    {
      id: 'user',
      header: ui.nav.users,
      filter: { type: 'text' },
      cellClassName: CELL,
      cell: (log) => (
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
      ),
    },
    {
      id: 'app',
      header: ui.nav.apps,
      filter: { type: 'text' },
      cellClassName: CELL,
      cell: (log) => (
        <div className="flex items-center gap-2">
          <AppIcon app={{ icon: log.app_icon, iconUrl: log.app_icon_url }} className="w-6 h-6" textClassName="text-base" />
          <span className="text-dark dark:text-gray-100 text-xs font-medium truncate">{log.app_name || ui.admin.logs.removedApp}</span>
        </div>
      ),
    },
    {
      id: 'ip',
      header: ui.admin.logs.ipAddress,
      filter: { type: 'text' },
      cellClassName: `${CELL} text-xs text-gray-400 dark:text-gray-500 font-mono`,
      cell: (log) => log.ip_address || '-',
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.logs.pageTitle}</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.admin.logs.subtitle}</p>
        <DocsHelpLink page="admins/logs" className="mt-2" />
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
          <DropdownSelect
            value={retentionDays}
            onChange={(next) => setRetentionDays(parseInt(next, 10))}
            label={ui.admin.logs.period}
            icon={Filter}
            options={periodOptions.map((days) => ({
              value: days,
              label: days === 1 ? `1 ${ui.common.day}` : `${days} ${ui.common.days}`,
            }))}
            className="min-w-[220px]"
          />
          <DropdownSelect
            value={pageSize}
            onChange={(next) => setPageSize(parseInt(next, 10))}
            label={ui.admin.logs.rows}
            icon={Filter}
            options={[
              { value: 50, label: '50' },
              { value: 100, label: '100' },
              { value: 150, label: '150' },
              { value: 200, label: '200' },
              { value: 250, label: '250' },
            ]}
            className="min-w-[140px]"
          />
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
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 shrink-0">
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
      {loading && logs.length === 0 && !loadFailed ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 animate-pulse p-6 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-50 dark:bg-gray-900 rounded-lg" />
          ))}
        </div>
      ) : loadFailed ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 text-center py-16 text-gray-500 dark:text-gray-400" role="alert">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">{ui.admin.logs.loadFailed}</p>
          <button
            type="button"
            onClick={() => loadLogs(pageIndex + 1)}
            className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-semibold text-dark dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {ui.common.retry}
          </button>
        </div>
      ) : (
        <DataTable
          server
          loading={loading}
          rows={logs}
          rowCount={pagination.total}
          getRowId={(log) => String(log.id)}
          columns={columns}
          sortFns={SORTABLE}
          sorting={sorting}
          onSortingChange={setSorting}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          pageIndex={pageIndex}
          onPageIndexChange={setPageIndex}
          pageSize={pageSize}
          pageResetKey={JSON.stringify([debouncedSearch, retentionDays])}
          storageKey="frontdoor.admin.logs.columns"
          labels={tableLabels}
          rowClassName="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 text-sm"
        />
      )}
    </div>
  );
}
