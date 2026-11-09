import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Layers3, Trash2 } from 'lucide-react';
import DataTable from '../../components/DataTable';
import { formatMessage } from '../../i18n';
import { DEFAULT_GROUP_ID } from '../../../shared/groups.js';

const CELL = 'px-4 py-3';
const COUNT_CELL = `${CELL} text-center text-xs text-gray-500 dark:text-gray-400`;

const linkedCount = (group) => Number(group.child_group_count || 0) + Number(group.entra_child_group_count || 0);
// Filter value getters: module level so the table's column definitions stay stable.
const getLabel = (group) => group.entra_display_name || group.name;
const getSearchText = (group) => `${getLabel(group)} ${group.description || ''}`;
const getSource = (group) => (group.source === 'entra' ? 'entra' : 'local');
const withOrWithout = (count) => (count > 0 ? 'with' : 'without');
const getMembers = (group) => withOrWithout(Number(group.member_count || 0));
const getApps = (group) => withOrWithout(Number(group.app_count || 0));
const getLinked = (group) => withOrWithout(linkedCount(group));

export default function GroupsTable({
  groups,
  sourceCounts,
  pageSize,
  pageResetKey,
  columnFilters,
  onColumnFiltersChange,
  onFilteredRowsChange,
  expandedGroup,
  toggleExpand,
  renderGroupDetail,
  getRowRef,
  selectedGroupIds,
  toggleGroupSelection,
  handleDelete,
  canEdit,
  language,
  ui,
  t,
  g,
}) {
  // Ascending comparators; ties fall back to the group name.
  const sortFns = useMemo(() => {
    const byName = (x, y) => getLabel(x).localeCompare(getLabel(y), language, { sensitivity: 'base' });
    const thenName = (compare) => (x, y) => compare(x, y) || byName(x, y);
    const count = (get) => thenName((x, y) => get(x) - get(y));
    return {
      group: byName,
      source: thenName((x, y) => getSource(x).localeCompare(getSource(y))),
      member_count: count((group) => Number(group.member_count || 0)),
      app_count: count((group) => Number(group.app_count || 0)),
      linked: count(linkedCount),
    };
  }, [language]);

  const tt = ui.common.table;
  const labels = {
    ...tt,
    filterColumn: (column) => formatMessage(tt.filterColumn, { column }),
    pageSummary: (pagination) => formatMessage(ui.admin.groups.pageSummary, pagination),
    previous: ui.common.previous,
    next: ui.common.next,
  };
  const withOptions = [{ value: 'with', label: g.withItems }, { value: 'without', label: g.withoutItems }];

  const columns = [
    {
      id: 'select',
      header: <span className="sr-only">{g.selectColumn}</span>,
      hideable: false,
      cellClassName: `${CELL} w-10`,
      cell: (group) => (group.id === DEFAULT_GROUP_ID ? null : (
        <input
          type="checkbox"
          checked={selectedGroupIds.includes(group.id)}
          disabled={!canEdit}
          onChange={() => toggleGroupSelection(group.id)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${g.selectColumn}: ${getLabel(group)}`}
          className="rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
        />
      )),
    },
    {
      id: 'group',
      header: ui.nav.groups,
      hideable: false,
      filter: { type: 'text', getValue: getSearchText },
      cellClassName: CELL,
      cell: (group) => {
        const expanded = expandedGroup === group.id;
        return (
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleExpand(group.id);
              }}
              aria-expanded={expanded}
              aria-label={`${getLabel(group)}: ${t.info}`}
              className="rounded-md p-0.5 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-sm text-dark dark:text-gray-100">{getLabel(group)}</span>
                {group.entra_deleted_at && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-red-100 text-red-700 dark:bg-red-950/55 dark:text-red-300 px-1.5 py-0.5 rounded-sm font-medium">{g.deletedInEntraBadge}</span>
                )}
                {linkedCount(group) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-accent/10 dark:bg-accent-dark/20 text-accent-dark dark:text-gray-100 px-1.5 py-0.5 rounded-sm font-medium">
                    <Layers3 className="w-3 h-3" />
                    {g.compositeBadge}
                  </span>
                )}
                {group.id === DEFAULT_GROUP_ID && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-accent/30 text-dark dark:text-gray-100 px-1.5 py-0.5 rounded-full font-medium">{g.defaultBadge}</span>
                )}
              </div>
              {group.description && <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{group.description}</p>}
            </div>
          </div>
        );
      },
    },
    {
      id: 'source',
      header: g.sourceFilter,
      filter: {
        type: 'values',
        getValue: getSource,
        options: [
          { value: 'local', label: `${g.sourceLocal} (${sourceCounts.local})` },
          { value: 'entra', label: `${g.sourceEntra} (${sourceCounts.entra})` },
        ],
      },
      cellClassName: CELL,
      cell: (group) => (group.source === 'entra'
        ? <span className="inline-flex items-center gap-1 text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
        : <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded-sm font-medium">{g.localBadge}</span>),
    },
    {
      id: 'member_count',
      header: g.membersColumn,
      headerClassName: 'text-center',
      filter: { type: 'values', getValue: getMembers, options: withOptions },
      cellClassName: COUNT_CELL,
      cell: (group) => Number(group.member_count || 0),
    },
    {
      id: 'app_count',
      header: ui.nav.apps,
      headerClassName: 'text-center',
      filter: { type: 'values', getValue: getApps, options: withOptions },
      cellClassName: COUNT_CELL,
      cell: (group) => Number(group.app_count || 0),
    },
    {
      id: 'linked',
      header: g.linkedGroupsColumn,
      headerClassName: 'text-center',
      filter: { type: 'values', getValue: getLinked, options: withOptions },
      cellClassName: COUNT_CELL,
      cell: (group) => linkedCount(group),
    },
    {
      id: 'actions',
      header: t.actions,
      hideable: false,
      headerClassName: 'text-center',
      cellClassName: `${CELL} text-center`,
      cell: (group) => (group.id === DEFAULT_GROUP_ID ? null : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleDelete(group);
          }}
          disabled={!canEdit}
          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/35 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={g.deleteGroupTooltip}
          aria-label={`${g.deleteGroupTooltip}: ${getLabel(group)}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )),
    },
  ];

  return (
    <DataTable
      columns={columns}
      sortFns={sortFns}
      rows={groups}
      getRowId={(group) => group.id}
      pageSize={pageSize}
      pageResetKey={pageResetKey}
      storageKey="frontdoor.admin.groups.columns"
      labels={labels}
      columnFilters={columnFilters}
      onColumnFiltersChange={onColumnFiltersChange}
      onFilteredRowsChange={onFilteredRowsChange}
      onRowClick={(group) => toggleExpand(group.id)}
      isRowExpanded={(group) => expandedGroup === group.id}
      renderExpandedRow={renderGroupDetail}
      getRowRef={getRowRef}
      rowClassName="border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-800/55"
    />
  );
}
