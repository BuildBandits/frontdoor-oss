import { useMemo } from 'react';
import { Pencil, Trash2, Copy, Users } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import DataTable, { EMPTY_FILTER_VALUE } from '../../components/DataTable';
import { formatMessage } from '../../i18n';

const CELL = 'px-6 py-4';

const appTags = (app) => (Array.isArray(app.tags) ? app.tags : [])
  .map((tag) => (tag ?? '').toString().trim().toLowerCase())
  .filter(Boolean);
// Filter value getters: module level so the table's column definitions stay stable.
const getName = (app) => app.name;
const getSlug = (app) => app.slug;
const getTargetUrl = (app) => app.target_url;
const getDescription = (app) => app.description;
const getMode = (app) => app.mode;
const getActive = (app) => (app.is_active ? 'active' : 'inactive');
const getGroups = (app) => (Number(app.group_count || 0) > 0 ? 'with' : 'without');

export default function AppsTable({
  loading,
  apps,
  catalogApps = apps,
  pageSize,
  pageResetKey,
  onFilteredCountChange,
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
      description: thenName(text('description')),
      is_active: thenName((x, y) => Number(Boolean(x.is_active)) - Number(Boolean(y.is_active))),
      group_count: thenName((x, y) => Number(x.group_count || 0) - Number(y.group_count || 0)),
      sort_order: thenName((x, y) => Number(x.sort_order || 0) - Number(y.sort_order || 0)),
    };
  }, [language]);
  // Default order, shown until a header is clicked: sort order, then name.
  const rows = useMemo(
    () => [...apps].sort((x, y) => (Number(x?.sort_order || 0) - Number(y?.sort_order || 0)) || sortFns.name(x, y)),
    [apps, sortFns],
  );

  const modeLabel = (mode) => (mode === 'redirect' ? t.redirectSso : mode === 'internal-link' ? t.internalLink : mode === 'shared-cookie' ? t.sharedCookie : mode === 'entra-app' ? t.entraApp : t.link);
  // Checklist options come from the whole catalog, not the searched rows: a checklist keeps
  // the checked values, so a value missing from the options would be filtered out unseen.
  const modeValues = [...new Set(catalogApps.map(getMode))].sort();
  const tagValues = [...new Set(catalogApps.flatMap(appTags))].sort();
  const tt = ui.common.table;
  const labels = {
    ...tt,
    filterColumn: (column) => formatMessage(tt.filterColumn, { column }),
    pageSummary: (pagination) => formatMessage(a.pageSummary, pagination),
    previous: ui.common.previous,
    next: ui.common.next,
  };

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
      hideable: false,
      filter: { type: 'text', getValue: getName },
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
      filter: { type: 'text', getValue: getSlug },
      cellClassName: `${CELL} text-sm text-gray-500 dark:text-gray-400 font-mono`,
      cell: (app) => app.slug,
    },
    {
      id: 'target_url',
      header: a.sortByTargetUrl,
      filter: { type: 'text', getValue: getTargetUrl },
      cellClassName: `${CELL} text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]`,
      cell: (app) => app.target_url,
    },
    {
      id: 'description',
      header: a.descriptionLabel,
      hiddenByDefault: true,
      filter: { type: 'text', getValue: getDescription },
      cellClassName: `${CELL} text-sm text-gray-500 dark:text-gray-400 truncate max-w-[260px]`,
      cell: (app) => app.description,
    },
    {
      id: 'mode',
      header: ui.admin.common.appMode,
      filter: { type: 'values', getValue: getMode, options: modeValues.map((mode) => ({ value: mode, label: modeLabel(mode) })) },
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
          {modeLabel(app.mode)}
        </span>
      ),
    },
    {
      id: 'tags',
      header: a.tagsLabel,
      hiddenByDefault: true,
      filter: {
        type: 'values',
        getValue: appTags,
        options: [{ value: EMPTY_FILTER_VALUE, label: a.appsWithoutTags }, ...tagValues.map((tag) => ({ value: tag, label: tag }))],
      },
      cellClassName: CELL,
      cell: (app) => (
        <div className="flex flex-wrap gap-1">
          {appTags(app).map((tag) => (
            <span key={tag} className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">{tag}</span>
          ))}
        </div>
      ),
    },
    {
      id: 'group_count',
      header: a.columnGroups,
      hiddenByDefault: true,
      headerClassName: 'text-center',
      filter: {
        type: 'values',
        getValue: getGroups,
        options: [{ value: 'with', label: a.withGroups }, { value: 'without', label: a.withoutGroups }],
      },
      cellClassName: `${CELL} text-center text-sm text-gray-500 dark:text-gray-400`,
      cell: (app) => Number(app.group_count || 0),
    },
    {
      id: 'sort_order',
      header: a.sortOrderLabel,
      hiddenByDefault: true,
      headerClassName: 'text-center',
      cellClassName: `${CELL} text-center text-sm text-gray-500 dark:text-gray-400`,
      cell: (app) => Number(app.sort_order || 0),
    },
    {
      id: 'is_active',
      header: ui.admin.common.active,
      filter: { type: 'values', getValue: getActive, options: [{ value: 'active', label: a.statusActive }, { value: 'inactive', label: a.statusInactive }] },
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
      hideable: false,
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
      storageKey="frontdoor.admin.apps.columns"
      labels={labels}
      onFilteredCountChange={onFilteredCountChange}
      rowClassName="border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-800/55"
    />
  );
}
