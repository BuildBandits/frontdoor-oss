import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertCircle, Filter, PlugZap, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AuditDetails from '../components/AuditDetails';
import ClearableSearchField from '../components/ClearableSearchField';
import DataTable from '../components/DataTable';
import { tableQueryParams } from '../utils/tableQuery';
import { useAuthStore } from '../stores/authStore';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useBrandingLanguage, useBrandingTimeZone } from '../stores/brandingStore';
import { formatMessage, getUiStrings, resolveAppLanguage } from '../i18n';
import { describeAuditLog } from '../utils/auditFormatters';
import { formatIsoDateTime } from '../utils/dateTime';
import { sortOptionsByLabel } from '../utils/sortOptions';
import { resolveAppTimeZone } from '../../shared/timeZones.js';

const ACTION_OPTIONS = ['approve', 'revoke'];
// Columns the audit API can filter on, and the parameter each one uses.
const QUERY_COLUMNS = {
  admin: { param: 'actor_ids', type: 'values' },
  action: { param: 'actions', type: 'values' },
  plugin: { param: 'target_q', type: 'text' },
};
// Server-side sorting: any truthy value marks the column as sortable.
const SORTABLE = { date: true, admin: true, action: true };

export default function AdminPluginAudit() {
  const { user } = useAuthStore();
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [refs, setRefs] = useState({});
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // The skeleton is shown only before the first answer: later reloads keep the table (and an open filter) mounted.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Admins present in the period, for the admin filter; requested again when the period changes.
  const [facets, setFacets] = useState({ actors: [] });
  const facetsKeyRef = useRef(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const [search, setSearch] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  const brandingLanguage = useBrandingLanguage();
  const brandingTimeZone = useBrandingTimeZone();
  const timeZone = resolveAppTimeZone(user?.preferredTimeZone, brandingTimeZone);

  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const ui = getUiStrings(language);

  const debouncedSearch = useDebouncedValue(search);
  const debouncedFilters = useDebouncedValue(columnFilters);
  const { begin: beginLogsRequest } = useLatestRequest();
  const loadLogs = useCallback(async (p = 1) => {
    const isLatest = beginLogsRequest();
    const facetsKey = String(retentionDays);
    setLoading(true);
    try {
      const res = await api.get('/logs/audit', {
        params: {
          page: p,
          limit: pageSize,
          retention_days: retentionDays,
          q: debouncedSearch,
          target_type: 'plugin',
          facets: facetsKeyRef.current === facetsKey ? undefined : '1',
          ...tableQueryParams({ sorting, columnFilters: debouncedFilters, columns: QUERY_COLUMNS }),
        },
      });
      if (!isLatest()) return;
      setLogs(res.data.logs);
      if (res.data.facets) {
        setFacets(res.data.facets);
        facetsKeyRef.current = facetsKey;
      }
      setRefs(res.data.refs || {});
      setPagination(res.data.pagination);
      setLoadFailed(false);
      setHasLoaded(true);
    } catch {
      if (!isLatest()) return;
      setLoadFailed(true);
    }
    setLoading(false);
  }, [beginLogsRequest, pageSize, retentionDays, debouncedSearch, sorting, debouncedFilters]);

  useEffect(() => { loadLogs(pageIndex + 1); }, [loadLogs, pageIndex]);

  const formatDate = (iso) => formatIsoDateTime(iso, timeZone) || iso || '-';

  const pa = ui.admin.pluginAudit;
  const tt = ui.common.table;
  const tableLabels = {
    ...tt,
    filterColumn: (column) => formatMessage(tt.filterColumn, { column }),
    pageSummary: (summary) => formatMessage(pa.pageSummary, summary),
    previous: ui.common.previous,
    next: ui.common.next,
    noRows: pa.emptyTitle,
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
      id: 'admin',
      header: ui.admin.audit.admin,
      filter: {
        type: 'values',
        options: sortOptionsByLabel(facets.actors.map((actor) => ({
          value: actor.id,
          label: actor.name || actor.email || ui.admin.audit.actorLabels?.[actor.id] || `${ui.admin.audit.removedUser} (${actor.id})`,
        })), language),
      },
      cellClassName: CELL,
      cell: (log) => (
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
      ),
    },
    {
      id: 'action',
      header: ui.admin.audit.action,
      filter: {
        type: 'values',
        options: sortOptionsByLabel(ACTION_OPTIONS.map((value) => ({ value, label: pa.actionLabels[value] || value })), language),
      },
      cellClassName: CELL,
      cell: (log) => (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
          log.action === 'approve'
            ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
        }`}>
          {pa.actionLabels[log.action] || log.action}
        </span>
      ),
    },
    {
      id: 'plugin',
      header: pa.plugin,
      filter: { type: 'text' },
      cellClassName: CELL,
      cell: (log) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-dark dark:text-gray-100">{log.target_id || '-'}</span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{log.details?.name || log.details?.version || pa.pluginFallback}</span>
        </div>
      ),
    },
    {
      id: 'details',
      header: ui.admin.audit.details,
      cellClassName: `${CELL} min-w-[280px]`,
      cell: (log) => <AuditDetails event={describeAuditLog(log, { ui, refs })} ui={ui} />,
    },
  ];

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

      {!hasLoaded && !loadFailed ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 animate-pulse p-6 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-50 dark:bg-gray-900 rounded-lg" />
          ))}
        </div>
      ) : loadFailed ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 text-center py-16 text-gray-500 dark:text-gray-400" role="alert">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">{ui.admin.audit.loadFailed}</p>
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
          headerPaddingClassName="px-5"
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
          storageKey="frontdoor.admin.pluginAudit.columns"
          labels={tableLabels}
          rowClassName="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 align-top text-sm"
        />
      )}
    </div>
  );
}
