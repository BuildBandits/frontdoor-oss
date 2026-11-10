import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, Filter, ListFilter, UserRound, X } from 'lucide-react';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AuditDetails from '../components/AuditDetails';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
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
import DocsHelpLink from '../components/DocsHelpLink';

const SIGN_IN_TARGET_TYPE = 'auth';
const SHOW_SIGN_INS_KEY = 'frontdoor.audit.showSignIns';
// Which events to list: 'changes' hides sign-ins (default), 'all' includes them,
// 'impersonation' keeps only impersonation sessions. Only changes/all is remembered.
const EVENT_SCOPES = ['all', 'changes', 'impersonation'];

function readEventScope() {
  try {
    return window.localStorage.getItem(SHOW_SIGN_INS_KEY) === '1' ? 'all' : 'changes';
  } catch {
    return 'changes';
  }
}

function writeEventScope(scope) {
  if (scope === 'impersonation') return;
  try {
    window.localStorage.setItem(SHOW_SIGN_INS_KEY, scope === 'all' ? '1' : '0');
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

// Columns the audit API can filter on, and the parameter each one uses.
const QUERY_COLUMNS = {
  admin: { param: 'actor_ids', type: 'values' },
  action: { param: 'actions', type: 'values' },
  target: { param: 'target_types', type: 'values' },
};
// Server-side sorting: any truthy value marks the column as sortable.
const SORTABLE = { date: true, admin: true, action: true, target: true };

export default function AdminAudit() {
  const { user } = useAuthStore();
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [refs, setRefs] = useState({});
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // The skeleton is shown only before the first answer: later reloads keep the table (and an open filter) mounted.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  // Admins, actions and target types present in the period, for the column filters. They are
  // requested again only when the period or the event scope changes.
  const [facets, setFacets] = useState({ actions: [], targetTypes: [], actors: [] });
  const facetsKeyRef = useRef(null);
  const [search, setSearch] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  // Administrator sign-ins are hidden by default (they drown out the changes);
  // the choice is remembered per browser.
  const [eventScope, setEventScope] = useState(() => readEventScope());
  const showSignIns = eventScope === 'all';
  const onlyImpersonation = eventScope === 'impersonation';
  const [sessionFilter, setSessionFilter] = useState(null);
  const brandingLanguage = useBrandingLanguage();
  const brandingTimeZone = useBrandingTimeZone();
  const timeZone = resolveAppTimeZone(user?.preferredTimeZone, brandingTimeZone);

  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const ui = getUiStrings(language);

  const debouncedSearch = useDebouncedValue(search);
  const { begin: beginLogsRequest } = useLatestRequest();
  const loadLogs = useCallback(async (p = 1) => {
    const isLatest = beginLogsRequest();
    const facetsKey = JSON.stringify([retentionDays, showSignIns, onlyImpersonation, sessionFilter]);
    setLoading(true);
    try {
      const res = await api.get('/logs/audit', {
        params: {
          page: p,
          limit: pageSize,
          retention_days: retentionDays,
          q: debouncedSearch,
          target_type: onlyImpersonation || sessionFilter ? 'impersonation' : undefined,
          impersonation_session_id: sessionFilter || undefined,
          exclude_target_types: showSignIns || onlyImpersonation || sessionFilter ? undefined : SIGN_IN_TARGET_TYPE,
          facets: facetsKeyRef.current === facetsKey ? undefined : '1',
          ...tableQueryParams({ sorting, columnFilters, columns: QUERY_COLUMNS }),
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
  }, [beginLogsRequest, pageSize, retentionDays, debouncedSearch, showSignIns, onlyImpersonation, sessionFilter, sorting, columnFilters]);

  const changeEventScope = (scope) => {
    setEventScope(scope);
    writeEventScope(scope);
  };

  useEffect(() => { loadLogs(pageIndex + 1); }, [loadLogs, pageIndex]);

  const formatDate = (iso) => formatIsoDateTime(iso, timeZone) || iso || '-';

  const a = ui.admin.audit;
  const tt = ui.common.table;
  const tableLabels = {
    ...tt,
    filterColumn: (column) => formatMessage(tt.filterColumn, { column }),
    pageSummary: (summary) => formatMessage(a.pageSummary, summary),
    previous: ui.common.previous,
    next: ui.common.next,
    noRows: eventScope === 'changes' ? `${a.emptyTitle} ${a.signInsHidden}` : a.emptyTitle,
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
      header: a.admin,
      filter: {
        type: 'values',
        options: sortOptionsByLabel(facets.actors.map((actor) => ({
          value: actor.id,
          label: actor.name || actor.email || a.actorLabels?.[actor.id] || `${a.removedUser} (${actor.id})`,
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
            <p className="text-dark dark:text-gray-100 font-medium truncate text-xs">{log.actor_name || a.actorLabels?.[log.actor_id] || a.removedUser}</p>
            <p className="text-gray-400 dark:text-gray-500 truncate text-[11px]">{log.actor_email || '-'}</p>
            {log.impersonation_session_id && (
              <button
                type="button"
                onClick={() => setSessionFilter(log.impersonation_session_id)}
                className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-300"
                title={formatMessage(a.sessionFilter, { id: log.impersonation_session_id })}
              >
                <UserRound className="w-3 h-3" />
                {formatMessage(a.impersonatingBadge, { name: log.impersonated_user_name || a.removedUser })}
              </button>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'action',
      header: a.action,
      filter: {
        type: 'values',
        options: sortOptionsByLabel(facets.actions.map((action) => ({ value: action, label: a.actionLabels?.[action] || action })), language),
      },
      cellClassName: CELL,
      cell: (log) => (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300"
          title={log.action}
        >
          {describeAuditLog(log, { ui, refs }).actionLabel}
        </span>
      ),
    },
    {
      id: 'target',
      header: a.target,
      filter: {
        type: 'values',
        options: sortOptionsByLabel(facets.targetTypes.map((type) => ({ value: type, label: a.targetLabels?.[type] || type })), language),
      },
      cellClassName: CELL,
      cell: (log) => {
        const event = describeAuditLog(log, { ui, refs });
        return (
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500" title={log.target_type}>{event.targetTypeLabel}</span>
            {event.targetName && (
              <span className="text-xs font-medium text-dark dark:text-gray-100 break-words">{event.targetName}</span>
            )}
            {log.target_id && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-mono break-all">{log.target_id}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'details',
      header: a.details,
      cellClassName: `${CELL} min-w-[280px]`,
      cell: (log) => <AuditDetails event={describeAuditLog(log, { ui, refs })} ui={ui} />,
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.audit.pageTitle}</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.admin.audit.subtitle}</p>
            <DocsHelpLink page="admins/logs" className="mt-2" />
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder={ui.admin.audit.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <DropdownSelect
            value={retentionDays}
            onChange={(next) => setRetentionDays(parseInt(next, 10))}
            label={ui.admin.audit.period}
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
            label={ui.admin.audit.rows}
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
          <DropdownSelect
            value={eventScope}
            onChange={changeEventScope}
            label={ui.admin.audit.eventFilter}
            icon={ListFilter}
            options={EVENT_SCOPES.map((scope) => ({ value: scope, label: ui.admin.audit.eventScopes[scope] }))}
            className="min-w-[220px]"
          />
          {sessionFilter && (
            <button
              type="button"
              onClick={() => setSessionFilter(null)}
              title={ui.admin.audit.clearSessionFilter}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {formatMessage(ui.admin.audit.sessionFilter, { id: sessionFilter })}
              <X className="w-4 h-4" />
            </button>
          )}
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
          pageResetKey={JSON.stringify([debouncedSearch, retentionDays, eventScope, sessionFilter])}
          storageKey="frontdoor.admin.audit.columns"
          labels={tableLabels}
          rowClassName="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 align-top text-sm"
        />
      )}
    </div>
  );
}
