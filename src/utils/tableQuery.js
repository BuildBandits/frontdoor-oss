// Marker for a checklist filter with nothing selected: the API matches no rows.
export const NO_VALUES = '__none__';

/**
 * Query parameters for a server-side DataTable. `columns` maps a column id to
 * `{ param, type: 'text' | 'values' }`; the sort is sent as `sort` (column id) and `dir`.
 * Unmapped filters are ignored, so only whitelisted parameters reach the API.
 */
export function tableQueryParams({ sorting = [], columnFilters = [], columns = {} }) {
  const params = {};
  const [sort] = sorting;
  if (sort) {
    params.sort = sort.id;
    params.dir = sort.desc ? 'desc' : 'asc';
  }
  for (const { id, value } of columnFilters) {
    const column = columns[id];
    if (!column || value === undefined) continue;
    if (column.type === 'values') {
      params[column.param] = Array.isArray(value) && value.length > 0 ? value.join(',') : NO_VALUES;
    } else if (String(value).trim()) {
      params[column.param] = String(value).trim();
    }
  }
  return params;
}
