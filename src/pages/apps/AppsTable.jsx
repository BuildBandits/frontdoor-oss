import { Pencil, Trash2, Copy, Users } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import PaginationControls from '../../components/PaginationControls';
import { formatMessage } from '../../i18n';

export default function AppsTable({
  loading,
  pagination,
  a,
  ui,
  setPage,
  toggleSort,
  sortIndicator,
  t,
  paginatedApps,
  handleToggle,
  canEdit,
  jumpToGroupsForApp,
  openEdit,
  duplicateApp,
  cloning,
  handleDelete,
}) {
  return (
    <>
      {/* App table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800" />
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <PaginationControls
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            summary={formatMessage(a.pageSummary, pagination)}
            previousLabel={ui.common.previous}
            nextLabel={ui.common.next}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
            variant="attached-top"
            className="mt-0 bg-white dark:bg-gray-900"
          />
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                    <span>{ui.nav.apps}</span> {sortIndicator('name')}
                    </button>
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('slug')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                      <span>{a.sortBySlug}</span> {sortIndicator('slug')}
                    </button>
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('target_url')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                      <span>{a.sortByTargetUrl}</span> {sortIndicator('target_url')}
                    </button>
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort('mode')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                    <span>{ui.admin.common.appMode}</span> {sortIndicator('mode')}
                    </button>
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    <button type="button" onClick={() => toggleSort('is_active')} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white">
                    <span>{ui.admin.common.active}</span> {sortIndicator('is_active')}
                    </button>
                  </th>
                <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedApps.map((app) => (
                <tr key={app.id} className="border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-800/55">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <AppIcon app={app} className="w-8 h-8" textClassName="text-2xl" />
                      <span className="font-semibold text-dark dark:text-gray-100">{app.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono">{app.slug}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{app.target_url}</td>
                  <td className="px-6 py-4 text-center whitespace-nowrap">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
                      app.mode === 'redirect' ? 'bg-blue-100 text-blue-700'
                        : app.mode === 'internal-link' ? 'bg-emerald-100 text-emerald-700'
                        : app.mode === 'shared-cookie' ? 'bg-accent/10 text-accent-dark'
                        : app.mode === 'entra-app' ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                    }`}>
                      {app.mode === 'redirect' ? t.redirectSso : app.mode === 'internal-link' ? t.internalLink : app.mode === 'shared-cookie' ? t.sharedCookie : app.mode === 'entra-app' ? t.entraApp : t.link}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleToggle(app)}
                      disabled={!canEdit}
                      className={`w-10 h-6 rounded-full transition-colors relative inline-flex items-center ${
                        app.is_active ? 'bg-accent dark:bg-accent-dark' : 'bg-gray-200 dark:bg-gray-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span
                        className={`absolute w-4 h-4 rounded-full shadow transition-transform ${
                          app.is_active
                            ? 'translate-x-5 bg-white'
                            : 'translate-x-1 bg-white dark:bg-gray-400'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => jumpToGroupsForApp(app)}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={a.goToGroupsSearch}
                      >
                        <Users className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => duplicateApp(app)}
                        disabled={!canEdit || cloning}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={cloning ? a.duplicating : a.duplicate}
                        aria-label={cloning ? a.duplicating : a.duplicate}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        disabled={!canEdit}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            summary={formatMessage(a.pageSummary, pagination)}
            previousLabel={ui.common.previous}
            nextLabel={ui.common.next}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.pages, current + 1))}
            variant="attached-bottom"
            className="mt-0 bg-white dark:bg-gray-900"
          />
        </div>
      )}
    </>
  );
}
