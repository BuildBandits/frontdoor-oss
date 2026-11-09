import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import PaginationControls from './PaginationControls';

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const HEADER_CLASS = 'px-6 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider';
const SORT_BUTTON_CLASS = 'inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 text-inherit font-[inherit] leading-[inherit] uppercase hover:text-dark dark:hover:text-white';

/**
 * Client-side table: TanStack Table owns sorting and paging, the markup stays ours.
 * `rows` arrive already filtered and in their default order (shown until a header is clicked).
 * Columns: { id, header, cell(row), headerClassName?, cellClassName? }. `sortFns` (memoized) maps a
 * column id to an ascending comparator of two rows; columns without one are not sortable.
 * The page goes back to 1 when `pageResetKey`, the sort or `pageSize` change, not when rows reload.
 */
export default function DataTable({
  columns,
  sortFns,
  rows,
  getRowId,
  pageSize = 25,
  pageResetKey,
  pageSummary,
  previousLabel,
  nextLabel,
  rowClassName,
}) {
  const [sorting, setSorting] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);

  // Callers rebuild `columns` on every render (cells close over handlers), so TanStack only
  // gets definitions built from the column ids and the memoized `sortFns`: its row models
  // are not recomputed on every render.
  const columnIds = columns.map((column) => column.id).join(',');
  const columnDefs = useMemo(() => columnIds.split(',').map((id) => ({
    id,
    accessorFn: (row) => row,
    enableSorting: Boolean(sortFns?.[id]),
    sortDescFirst: false,
    sortFn: sortFns?.[id] ? (rowA, rowB) => sortFns[id](rowA.original, rowB.original) : undefined,
  })), [columnIds, sortFns]);

  useEffect(() => {
    setPageIndex(0);
  }, [pageResetKey, pageSize, sorting]);

  const table = useTable({
    features,
    columns: columnDefs,
    data: rows,
    getRowId,
    state: { sorting, pagination: { pageIndex, pageSize } },
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
      setPageIndex(next.pageIndex);
    },
    autoResetPageIndex: false,
    enableMultiSort: false,
    enableSortingRemoval: false,
  });

  const pages = Math.max(1, table.getPageCount());
  // Rows removed from the last page (delete, filter) must not leave an empty page behind.
  useEffect(() => {
    if (pageIndex > pages - 1) setPageIndex(pages - 1);
  }, [pageIndex, pages]);

  const pagination = { page: pageIndex + 1, pages, total: rows.length };
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const paginationProps = {
    page: pagination.page,
    pages,
    total: pagination.total,
    summary: pageSummary(pagination),
    previousLabel,
    nextLabel,
    onPrevious: () => table.previousPage(),
    onNext: () => table.nextPage(),
    className: 'mt-0 bg-white dark:bg-gray-900',
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <PaginationControls {...paginationProps} variant="attached-top" />
      <table className="w-full">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-gray-100 dark:border-gray-800">
              {group.headers.map((header) => {
                const column = columnsById.get(header.column.id);
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={`${HEADER_CLASS} ${column.headerClassName || 'text-left'}`}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  >
                    {header.column.getCanSort() ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()} className={SORT_BUTTON_CLASS}>
                        <span>{column.header}</span>
                        {sorted === 'asc' && <ChevronUp className="w-3.5 h-3.5" />}
                        {sorted === 'desc' && <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    ) : column.header}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={rowClassName}>
              {row.getAllCells().map((cell) => {
                const column = columnsById.get(cell.column.id);
                return <td key={cell.id} className={column.cellClassName}>{column.cell(row.original)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <PaginationControls {...paginationProps} variant="attached-bottom" />
    </div>
  );
}
