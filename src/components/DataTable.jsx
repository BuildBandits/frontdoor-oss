import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Columns3 } from 'lucide-react';
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import PaginationControls from './PaginationControls';
import ColumnFilterButton from './ColumnFilterButton';
import TablePopover from './TablePopover';

const features = tableFeatures({
  columnVisibilityFeature,
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

// Option value for "no value" in a checklist filter (e.g. an app without tags).
export const EMPTY_FILTER_VALUE = '__empty__';

const HEADER_CLASS = 'py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider';
const SORT_BUTTON_CLASS = 'inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white';

const textFilterFn = (getValue) => (row, _columnId, filterValue) => (
  String(getValue(row.original) ?? '').toLowerCase().includes(String(filterValue).trim().toLowerCase())
);
const valuesFilterFn = (getValue) => (row, _columnId, selected) => {
  const values = [].concat(getValue(row.original) ?? []);
  return values.length === 0 ? selected.includes(EMPTY_FILTER_VALUE) : values.some((value) => selected.includes(value));
};

function readStoredVisibility(storageKey) {
  if (!storageKey) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Client-side table: TanStack Table owns column filters, sorting, paging and column
 * visibility; the markup stays ours. `rows` arrive already narrowed by any filters kept
 * outside the table, in their default order (shown until a header is clicked).
 *
 * Column: { id, header, cell(row), headerClassName?, cellClassName?, hideable? (default true),
 *   hiddenByDefault?, filter?: { type: 'text' | 'values', getValue(row), options? } }.
 * `filter.getValue` must be stable (module level or memoized). `sortFns` (memoized) maps a
 * column id to an ascending comparator of two rows; columns without one are not sortable.
 * Column visibility is remembered per browser under `storageKey`.
 * The page goes back to 1 when `pageResetKey`, a filter, the sort or `pageSize` change,
 * not when rows reload after an edit.
 *
 * Optional: `columnFilters` + `onColumnFiltersChange` to control the filters from outside
 * (e.g. a shortcut that applies one); `rowClassName` may be a function of the row;
 * `onRowClick`, `isRowExpanded` and `renderExpandedRow` add a full-width detail row under a row;
 * `getRowRef(row)` returns a ref callback for the row (e.g. to scroll to it);
 * `onFilteredRowsChange(rows)` reports every row left after the column filters, across pages.
 *
 * Server mode (`server`): `rows` is the current page as returned by the API and `rowCount` the
 * total. Sorting, filters and page are not applied here: pass them controlled (`sorting` /
 * `onSortingChange`, `columnFilters` / `onColumnFiltersChange`, `pageIndex` / `onPageIndexChange`)
 * and send them with the request. Sort keys are column ids; `loading` dims the rows meanwhile.
 */
export default function DataTable({
  columns,
  sortFns,
  rows,
  getRowId,
  pageSize = 25,
  pageResetKey,
  storageKey,
  labels,
  // Horizontal padding of the header cells: the same as the table's body cells, so titles line up.
  headerPaddingClassName = 'px-6',
  onFilteredCountChange,
  onFilteredRowsChange,
  getRowRef,
  rowClassName,
  server = false,
  rowCount,
  loading = false,
  sorting: controlledSorting,
  onSortingChange,
  pageIndex: controlledPageIndex,
  onPageIndexChange,
  columnFilters: controlledFilters,
  onColumnFiltersChange,
  onRowClick,
  isRowExpanded,
  renderExpandedRow,
}) {
  const [internalSorting, setInternalSorting] = useState([]);
  const sorting = controlledSorting ?? internalSorting;
  const setSorting = onSortingChange ?? setInternalSorting;
  const [internalFilters, setInternalFilters] = useState([]);
  const columnFilters = controlledFilters ?? internalFilters;
  const setColumnFilters = onColumnFiltersChange ?? setInternalFilters;
  const [internalPageIndex, setInternalPageIndex] = useState(0);
  const pageIndex = controlledPageIndex ?? internalPageIndex;
  const setPageIndex = onPageIndexChange ?? setInternalPageIndex;
  // Defaults are read once; later changes come from the column picker.
  const [defaultVisibility] = useState(
    () => Object.fromEntries(columns.filter((column) => column.hiddenByDefault).map((column) => [column.id, false])),
  );
  const [columnVisibility, setColumnVisibility] = useState(() => {
    // Only hideable columns and boolean values: an old or edited entry must not hide the
    // name or actions column, which the picker could not bring back.
    const hideable = new Set(columns.filter((column) => column.hideable !== false).map((column) => column.id));
    const stored = Object.entries(readStoredVisibility(storageKey) || {})
      .filter(([id, visible]) => hideable.has(id) && typeof visible === 'boolean');
    return { ...defaultVisibility, ...Object.fromEntries(stored) };
  });
  // A hidden column shows neither its funnel nor its sort arrow, so it must not keep filtering
  // or sorting the rows unseen.
  useEffect(() => {
    const isHidden = ({ id }) => columnVisibility[id] === false;
    setColumnFilters((current) => (current.some(isHidden) ? current.filter((entry) => !isHidden(entry)) : current));
    setSorting((current) => (current.some(isHidden) ? current.filter((entry) => !isHidden(entry)) : current));
  }, [columnVisibility, setColumnFilters, setSorting]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(columnVisibility));
    } catch {
      // Storage can be unavailable (private mode, blocked site data): the choice lasts for this visit.
    }
  }, [storageKey, columnVisibility]);

  // Callers rebuild `columns` on every render (cells close over handlers), so TanStack only
  // gets definitions built from stable parts (ids, hideability, filter getters, memoized
  // `sortFns`): its row models are not recomputed on every render.
  const columnShape = columns.map((column) => `${column.id}:${column.hideable === false ? 0 : 1}:${column.filter?.type || ''}`).join(',');
  const filterGetters = columns.map((column) => column.filter?.getValue);
  const columnDefs = useMemo(() => columnShape.split(',').map((entry, index) => {
    const [id, hideable, filterType] = entry.split(':');
    const getValue = filterGetters[index];
    return {
      id,
      accessorFn: (row) => row,
      enableHiding: hideable === '1',
      enableColumnFilter: Boolean(filterType),
      // In server mode the API filters; no client-side filter function is needed.
      filterFn: server || !filterType ? undefined : filterType === 'text' ? textFilterFn(getValue) : valuesFilterFn(getValue),
      // Server mode: `sortFns` only marks sortable columns (any truthy value).
      enableSorting: Boolean(sortFns?.[id]),
      sortDescFirst: false,
      sortFn: !server && sortFns?.[id] ? (rowA, rowB) => sortFns[id](rowA.original, rowB.original) : undefined,
    };
  // The getters are listed one by one so a new array of the same functions does not rebuild.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [columnShape, sortFns, server, ...filterGetters]);

  // `onPageIndexChange` must be stable (a state setter), or this would reset the page on every render.
  useEffect(() => {
    setPageIndex(0);
  }, [pageResetKey, pageSize, sorting, columnFilters, setPageIndex]);

  const table = useTable({
    features,
    columns: columnDefs,
    data: rows,
    getRowId,
    state: { sorting, columnFilters, columnVisibility, pagination: { pageIndex, pageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
      setPageIndex(next.pageIndex);
    },
    autoResetPageIndex: false,
    manualPagination: server,
    manualSorting: server,
    manualFiltering: server,
    rowCount: server ? rowCount : undefined,
    enableMultiSort: false,
    enableSortingRemoval: false,
  });

  const filteredRowModel = table.getPrePaginatedRowModel();
  const filteredCount = server ? (rowCount ?? 0) : filteredRowModel.rows.length;
  useEffect(() => {
    onFilteredCountChange?.(filteredCount);
  }, [filteredCount, onFilteredCountChange]);
  // Keyed on the filtered ids and the data, so a parent that stores the rows does not loop.
  const filteredIds = filteredRowModel.rows.map((row) => row.id).join(',');
  useEffect(() => {
    onFilteredRowsChange?.(filteredRowModel.rows.map((row) => row.original));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIds, rows, onFilteredRowsChange]);

  const pages = Math.max(1, table.getPageCount());
  // Rows removed from the last page (delete, filter) must not leave an empty page behind.
  useEffect(() => {
    if (pageIndex > pages - 1) setPageIndex(pages - 1);
  }, [pageIndex, pages, setPageIndex]);

  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const pagination = { page: pageIndex + 1, pages, total: filteredCount };
  const paginationProps = {
    page: pagination.page,
    pages,
    total: filteredCount,
    summary: labels.pageSummary(pagination),
    previousLabel: labels.previous,
    nextLabel: labels.next,
    onPrevious: () => table.previousPage(),
    onNext: () => table.nextPage(),
    className: 'mt-0 bg-white dark:bg-gray-900',
  };
  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  // Shown next to Previous / Next, above and below the table.
  const actions = (
    <>
      {columnFilters.length > 0 && (
        <button type="button" onClick={() => table.resetColumnFilters()} className="px-2 text-sm font-semibold text-accent-dark hover:underline">
          {labels.clearAllFilters}
        </button>
      )}
      {hideableColumns.length > 0 && (
        <TablePopover
          label={labels.columns}
          align="right"
          width={220}
          buttonClassName="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
          buttonContent={<><Columns3 className="w-4 h-4" aria-hidden="true" />{labels.columns}</>}
        >
          <div className="space-y-1">
            {hideableColumns.map((column) => (
              <label key={column.id} className="flex items-center gap-2 px-1 py-1 cursor-pointer">
                <input type="checkbox" checked={column.getIsVisible()} onChange={(event) => column.toggleVisibility(event.target.checked)} />
                <span className="truncate">{columnsById.get(column.id).header}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setColumnVisibility(defaultVisibility)}
            className="mt-2 text-xs font-semibold text-accent-dark hover:underline"
          >
            {labels.resetColumns}
          </button>
        </TablePopover>
      )}
    </>
  );

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <PaginationControls {...paginationProps} actions={actions} variant="attached-top" />
      <div className="overflow-x-auto">
      <table className="w-full" aria-busy={loading || undefined}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-gray-100 dark:border-gray-800">
              {group.headers.map((header) => {
                const column = columnsById.get(header.column.id);
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={`${HEADER_CLASS} ${headerPaddingClassName} ${column.headerClassName || 'text-left'}`}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {header.column.getCanSort() ? (
                        <button type="button" onClick={header.column.getToggleSortingHandler()} className={SORT_BUTTON_CLASS}>
                          <span>{column.header}</span>
                          {sorted === 'asc' && <ChevronUp className="w-3.5 h-3.5" />}
                          {sorted === 'desc' && <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      ) : column.header}
                      {column.filter && (
                        <ColumnFilterButton
                          columnLabel={column.header}
                          filter={column.filter}
                          value={header.column.getFilterValue()}
                          onChange={(value) => header.column.setFilterValue(value)}
                          labels={labels}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className={loading ? 'opacity-50 transition-opacity' : undefined}>
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <tr
                ref={getRowRef?.(row.original)}
                className={typeof rowClassName === 'function' ? rowClassName(row.original) : rowClassName}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const column = columnsById.get(cell.column.id);
                  return <td key={cell.id} className={column.cellClassName}>{column.cell(row.original)}</td>;
                })}
              </tr>
              {isRowExpanded?.(row.original) && (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="border-b border-gray-100 dark:border-gray-800">
                    {renderExpandedRow(row.original)}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {filteredCount === 0 && (
            <tr>
              <td colSpan={table.getVisibleLeafColumns().length} className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                {labels.noRows}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <PaginationControls {...paginationProps} actions={actions} variant="attached-bottom" />
    </div>
  );
}
