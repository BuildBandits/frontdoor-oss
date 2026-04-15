import { useState, useEffect, useCallback } from 'react';
import { Activity, ChevronLeft, ChevronRight, BarChart3, Users, AppWindow, AlertCircle } from 'lucide-react';
import api from '../services/api';
import UserAvatar from '../components/UserAvatar';
import AppIcon from '../components/AppIcon';

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState(null);
  const [topApps, setTopApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadLogs = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await api.get('/logs', { params: { page: p, limit: 50 } });
      setLogs(res.data.logs);
      setPagination(res.data.pagination);
      setStats(res.data.stats);
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  const loadTopApps = useCallback(async () => {
    try {
      const res = await api.get('/logs/top-apps', { params: { days: 30 } });
      setTopApps(res.data.topApps);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => { loadLogs(page); }, [loadLogs, page]);
  useEffect(() => { loadTopApps(); }, [loadTopApps]);

  const formatDate = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleDateString('it-IT', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-dark">Log di Accesso</h1>
        <p className="text-gray-500 mt-1">Registro degli accessi SSO alle applicazioni</p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-dark">{stats.total_accesses}</p>
                <p className="text-xs text-gray-400">Accessi totali</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-dark">{stats.unique_users}</p>
                <p className="text-xs text-gray-400">Utenti unici</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                <AppWindow className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-dark">{stats.unique_apps}</p>
                <p className="text-xs text-gray-400">App accedute</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top apps */}
      {topApps.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Top App (ultimi 30 giorni)
          </h2>
          <div className="space-y-2">
            {topApps.map((app, i) => {
              const maxCount = topApps[0]?.access_count || 1;
              return (
                <div key={app.slug} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
                  <AppIcon app={app} className="w-7 h-7" textClassName="text-lg" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-dark truncate">{app.name}</span>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                        {app.access_count} accessi &middot; {app.unique_users} utenti
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
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
            <p className="text-lg font-medium">Nessun log di accesso</p>
            <p className="text-sm mt-1">I log vengono generati quando gli utenti accedono alle app via SSO redirect</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Data</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Utente</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">App</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
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
                            <p className="text-dark font-medium truncate text-xs">{log.user_name || 'Utente rimosso'}</p>
                            <p className="text-gray-400 truncate text-[11px]">{log.user_email || '-'}</p>
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
                          <span className="text-dark text-xs font-medium truncate">{log.app_name || 'App rimossa'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400 hidden md:table-cell font-mono">{log.ip_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Pagina {pagination.page} di {pagination.pages} &middot; {pagination.total} log totali
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
