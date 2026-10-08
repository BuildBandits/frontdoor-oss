import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Filter, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AuditDetails from '../components/AuditDetails';
import ClearableSearchField from '../components/ClearableSearchField';
import DropdownSelect from '../components/DropdownSelect';
import PaginationControls from '../components/PaginationControls';
import { useAuthStore } from '../stores/authStore';
import { formatMessage, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';
import { describeAuditLog } from '../utils/auditFormatters';
import { formatIsoDateTime } from '../utils/dateTime';
import { normalizeTimeZone, resolveAppTimeZone } from '../../shared/timeZones.js';

const PRIVILEGED_ROLES = new Set(['owner', 'admin', 'admin_readonly']);

export default function AdminAudit() {
  const { user } = useAuthStore();
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [refs, setRefs] = useState({});
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [adminUsers, setAdminUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  const [selectedActorIds, setSelectedActorIds] = useState([]);
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
        const admins = (res.data.users || []).filter((user) => PRIVILEGED_ROLES.has(user.role));
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
          actor_ids: selectedActorIds.length > 0 ? selectedActorIds.join(',') : undefined,
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
  }, [pageSize, retentionDays, search, selectedActorIds]);

  useEffect(() => {
    setPage(1);
  }, [search, retentionDays, pageSize, selectedActorIds]);

  useEffect(() => { loadLogs(page); }, [loadLogs, page]);

  const formatDate = (iso) => formatIsoDateTime(iso, timeZone) || iso || '-';

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.admin.audit.pageTitle}</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.admin.audit.subtitle}</p>
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
            value={selectedActorIds}
            onChange={setSelectedActorIds}
            label={ui.admin.audit.admin}
            icon={ShieldCheck}
            multi
            emptyLabel={ui.admin.audit.allAdmins}
            options={[
              { value: '__all__', label: ui.admin.audit.allAdmins, clearSelection: true },
              ...adminUsers.map((user) => ({
                value: user.id,
                label: user.display_name || user.email,
              })),
            ]}
            className="min-w-[240px]"
          />
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
            <p className="text-lg font-medium">{ui.admin.audit.emptyTitle}</p>
            <p className="text-sm mt-1">{ui.admin.audit.emptyBody}</p>
          </div>
        ) : (
          <>
            <PaginationControls
              page={pagination.page}
              pages={pagination.pages}
              total={pagination.total}
              summary={formatMessage(ui.admin.audit.pageSummary, { page: pagination.page, pages: pagination.pages, total: pagination.total })}
              previousLabel={ui.common.previous}
              nextLabel={ui.common.next}
              onPrevious={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              variant="attached-top"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.common.date}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.admin}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.action}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.target}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{ui.admin.audit.details}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const event = describeAuditLog(log, { ui, refs });
                    return (
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
                              <p className="text-dark dark:text-gray-100 font-medium truncate text-xs">{log.actor_name || ui.admin.audit.removedUser}</p>
                              <p className="text-gray-400 dark:text-gray-500 truncate text-[11px]">{log.actor_email || '-'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300"
                            title={log.action}
                          >
                            {event.actionLabel}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500" title={log.target_type}>{event.targetTypeLabel}</span>
                            {event.targetName && (
                              <span className="text-xs font-medium text-dark dark:text-gray-100 break-words">{event.targetName}</span>
                            )}
                            {log.target_id && (
                              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-mono break-all">{log.target_id}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 min-w-[280px]">
                          <AuditDetails event={event} ui={ui} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationControls
              page={pagination.page}
              pages={pagination.pages}
              total={pagination.total}
              summary={formatMessage(ui.admin.audit.pageSummary, { page: pagination.page, pages: pagination.pages, total: pagination.total })}
              previousLabel={ui.common.previous}
              nextLabel={ui.common.next}
              onPrevious={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              variant="attached-bottom"
            />
          </>
        )}
      </div>
    </div>
  );
}
