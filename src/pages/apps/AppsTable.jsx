import { useMemo } from 'react';
import { Pencil, Trash2, Copy, Users } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import DataTable from '../../components/DataTable';
import { formatMessage } from '../../i18n';

const CELL = 'px-6 py-4';

export default function AppsTable({
  loading,
  apps,
  pageSize,
  pageResetKey,
  language,
  a,
  ui,
  t,
  handleToggle,
  canEdit,
  jumpToGroupsForApp,
  openEdit,
  duplicateApp,
  cloning,
  handleDelete,
}) {
  // Ascending comparators; ties fall back to the app name.
  const sortFns = useMemo(() => {
    const text = (key) => (x, y) => (x?.[key] || '').toString().localeCompare((y?.[key] || '').toString(), language, { sensitivity: 'base' });
    const byName = text('name');
    const thenName = (compare) => (x, y) => compare(x, y) || byName(x, y);
    return {
      name: byName,
      slug: thenName(text('slug')),
      target_url: thenName(text('target_url')),
      mode: thenName(text('mode')),
      is_active: thenName((x, y) => Number(Boolean(x.is_active)) - Number(Boolean(y.is_active))),
    };
  }, [language]);
  // Default order, shown until a header is clicked: sort order, then name.
  const rows = useMemo(
    () => [...apps].sort((x, y) => (Number(x?.sort_order || 0) - Number(y?.sort_order || 0)) || sortFns.name(x, y)),
    [apps, sortFns],
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800" />
        ))}
      </div>
    );
  }

  const columns = [
    {
      id: 'name',
      header: ui.nav.apps,
      cellClassName: CELL,
      cell: (app) => (
        <div className="flex items-center gap-3">
          <AppIcon app={app} className="w-8 h-8" textClassName="text-2xl" />
          <span className="font-semibold text-dark dark:text-gray-100">{app.name}</span>
        </div>
      ),
    },
    {
      id: 'slug',
      header: a.sortBySlug,
      cellClassName: `${CELL} text-sm text-gray-500 dark:text-gray-400 font-mono`,
      cell: (app) => app.slug,
    },
    {
      id: 'target_url',
      header: a.sortByTargetUrl,
      cellClassName: `${CELL} text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]`,
      cell: (app) => app.target_url,
    },
    {
      id: 'mode',
      header: ui.admin.common.appMode,
      headerClassName: 'text-center whitespace-nowrap',
      cellClassName: `${CELL} text-center whitespace-nowrap`,
      cell: (app) => (
        <span className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
          app.mode === 'redirect' ? 'bg-blue-100 text-blue-700'
            : app.mode === 'internal-link' ? 'bg-emerald-100 text-emerald-700'
            : app.mode === 'shared-cookie' ? 'bg-accent/10 text-accent-dark'
            : app.mode === 'entra-app' ? 'bg-violet-100 text-violet-700'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
        }`}>
          {app.mode === 'redirect' ? t.redirectSso : app.mode === 'internal-link' ? t.internalLink : app.mode === 'shared-cookie' ? t.sharedCookie : app.mode === 'entra-app' ? t.entraApp : t.link}
        </span>
      ),
    },
    {
      id: 'is_active',
      header: ui.admin.common.active,
      headerClassName: 'text-center',
      cellClassName: `${CELL} text-center`,
      cell: (app) => (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(app.is_active)}
          aria-label={`${t.active}: ${app.name}`}
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
      ),
    },
    {
      id: 'actions',
      header: t.actions,
      headerClassName: 'text-center',
      cellClassName: CELL,
      cell: (app) => (
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => jumpToGroupsForApp(app)}
            className="p-2 text-gray-400 dark:text-gray-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={a.goToGroupsSearch}
            aria-label={a.goToGroupsSearch}
          >
            <Users className="w-4 h-4" />
          </button>
          <button
            onClick={() => openEdit(app)}
            disabled={!canEdit}
            title={a.editApp}
            aria-label={`${a.editApp}: ${app.name}`}
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
            title={a.deleteTitle}
            aria-label={`${a.deleteTitle}: ${app.name}`}
            className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      sortFns={sortFns}
      rows={rows}
      getRowId={(app) => app.id}
      pageSize={pageSize}
      pageResetKey={pageResetKey}
      pageSummary={(pagination) => formatMessage(a.pageSummary, pagination)}
      previousLabel={ui.common.previous}
      nextLabel={ui.common.next}
      rowClassName="border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-800/55"
    />
  );
}
