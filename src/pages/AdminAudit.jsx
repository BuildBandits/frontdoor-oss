import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, Filter, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import ClearableSearchField from '../components/ClearableSearchField';

const PRIVILEGED_ROLES = new Set(['superadmin', 'admin', 'admin_readonly']);

export default function AdminAudit() {
  const periodOptions = [1, 7, 14, 30, 60, 90];
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [adminUsers, setAdminUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [pageSize, setPageSize] = useState(50);
  const [selectedActorId, setSelectedActorId] = useState('');

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
          actor_id: selectedActorId || undefined,
        },
      });
      setLogs(res.data.logs);
      setPagination(res.data.pagination);
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, [pageSize, retentionDays, search, selectedActorId]);

  useEffect(() => {
    setPage(1);
  }, [search, retentionDays, pageSize, selectedActorId]);

  useEffect(() => { loadLogs(page); }, [loadLogs, page]);

  const formatDate = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleDateString('it-IT', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatDetails = (details) => {
    if (!details) return '-';
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-dark">Audit</h1>
            <p className="text-gray-500 mt-1">Traccia delle azioni amministrative e di accesso dei ruoli privilegiati</p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder="Cerca attore, azione o target..."
            />
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <span className="text-gray-400">Admin</span>
            <select
              value={selectedActorId}
              onChange={(e) => setSelectedActorId(e.target.value)}
              className="bg-transparent text-sm font-medium text-dark focus:outline-none max-w-[220px]"
            >
              <option value="">Tutti gli admin</option>
              {adminUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name || user.email}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <Filter className="w-4 h-4 text-gray-400" />
            <span>Periodo</span>
            <select
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value, 10))}
              className="bg-transparent text-sm font-medium text-dark focus:outline-none"
            >
              {periodOptions.map((days) => (
                <option key={days} value={days}>
                  {days === 1 ? '1 giorno' : `${days} giorni`}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <span className="text-gray-400">Righe</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="bg-transparent text-sm font-medium text-dark focus:outline-none"
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

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="animate-pulse p-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-50 rounded-lg" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">Nessun evento audit</p>
            <p className="text-sm mt-1">Le azioni dei ruoli privilegiati appariranno qui.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Data</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Attore</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Azione</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Target</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Dettagli</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{log.created_at_local || formatDate(log.created_at)}</td>
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
                            <p className="text-dark font-medium truncate text-xs">{log.actor_name || 'Utente rimosso'}</p>
                            <p className="text-gray-400 truncate text-[11px]">{log.actor_email || '-'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-dark">{log.target_type}</span>
                          <span className="text-[11px] text-gray-400 font-mono break-all">{log.target_id || '-'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 hidden lg:table-cell">
                        <pre className="max-w-[420px] whitespace-pre-wrap break-words text-[11px] text-gray-500 font-mono">
                          {formatDetails(log.details)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Pagina {pagination.page} di {pagination.pages} &middot; {pagination.total} eventi totali
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pagination.page <= 1}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-dark hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                    disabled={pagination.page >= pagination.pages}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-dark hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
