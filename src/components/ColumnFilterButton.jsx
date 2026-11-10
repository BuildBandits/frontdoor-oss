import { useState } from 'react';
import { Filter } from 'lucide-react';
import TablePopover from './TablePopover';

/**
 * Funnel for one table column. `filter.type` is 'text' (contains) or 'values'
 * (checklist of `filter.options`; an undefined value means everything is selected).
 * Long checklists get a search box; Select all then acts on the values it shows.
 */
const SEARCH_FROM = 10;

export default function ColumnFilterButton({ columnLabel, filter, value, onChange, labels }) {
  const [query, setQuery] = useState('');
  const active = value !== undefined && value !== '';
  const allValues = filter.type === 'values' ? filter.options.map((option) => option.value) : [];
  const selected = filter.type === 'values' ? (value ?? allValues) : [];
  const setSelected = (next) => onChange(allValues.every((item) => next.includes(item)) ? undefined : allValues.filter((item) => next.includes(item)));
  const showSearch = filter.type === 'values' && filter.options.length > SEARCH_FROM;
  const needle = query.trim().toLowerCase();
  const shownOptions = showSearch && needle
    ? filter.options.filter((option) => String(option.label).toLowerCase().includes(needle))
    : (filter.options || []);
  const shownValues = shownOptions.map((option) => option.value);
  const shownSelected = shownValues.filter((item) => selected.includes(item)).length;

  return (
    <TablePopover
      label={active ? `${labels.filterColumn(columnLabel)} (${labels.filtered})` : labels.filterColumn(columnLabel)}
      buttonClassName={`inline-flex items-center justify-center rounded-md p-1 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${
        active ? 'bg-accent/15 text-accent-dark' : 'text-gray-300 dark:text-gray-600 hover:text-dark dark:hover:text-white'
      }`}
      buttonContent={<Filter className="w-3.5 h-3.5" fill={active ? 'currentColor' : 'none'} aria-hidden="true" />}
    >
      {filter.type === 'text' ? (
        <input
          type="text"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder={labels.contains}
          aria-label={labels.contains}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
        />
      ) : (
        <>
        {showSearch && (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchValues}
            aria-label={labels.searchValues}
            className="mb-2 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
          />
        )}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {shownOptions.length === 0 ? (
            <p className="px-1 py-1 text-gray-400 dark:text-gray-500" role="status">{labels.noValues}</p>
          ) : (
          <label className="flex items-center gap-2 px-1 py-1 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={shownSelected === shownValues.length}
              ref={(element) => {
                if (element) element.indeterminate = shownSelected > 0 && shownSelected < shownValues.length;
              }}
              onChange={(event) => setSelected(event.target.checked
                ? [...selected, ...shownValues]
                : selected.filter((item) => !shownValues.includes(item)))}
            />
            {labels.selectAll}
          </label>
          )}
          {shownOptions.map((option) => (
            <label key={option.value} className="flex items-center gap-2 px-1 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => setSelected(event.target.checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value))}
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
        </>
      )}
      <button
        type="button"
        onClick={() => onChange(undefined)}
        disabled={!active}
        className="mt-2 text-xs font-semibold text-accent-dark hover:underline disabled:opacity-40 disabled:no-underline"
      >
        {labels.clearFilter}
      </button>
    </TablePopover>
  );
}
