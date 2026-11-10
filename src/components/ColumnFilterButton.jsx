import { Filter } from 'lucide-react';
import TablePopover from './TablePopover';

/**
 * Funnel for one table column. `filter.type` is 'text' (contains) or 'values'
 * (checklist of `filter.options`; an undefined value means everything is selected).
 */
export default function ColumnFilterButton({ columnLabel, filter, value, onChange, labels }) {
  const active = value !== undefined && value !== '';
  const allValues = filter.type === 'values' ? filter.options.map((option) => option.value) : [];
  const selected = filter.type === 'values' ? (value ?? allValues) : [];
  const setSelected = (next) => onChange(next.length === allValues.length ? undefined : next);

  return (
    <TablePopover
      label={labels.filterColumn(columnLabel)}
      pressed={active}
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
        <div className="max-h-64 overflow-y-auto space-y-1">
          <label className="flex items-center gap-2 px-1 py-1 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={selected.length === allValues.length}
              ref={(element) => {
                if (element) element.indeterminate = selected.length > 0 && selected.length < allValues.length;
              }}
              onChange={(event) => setSelected(event.target.checked ? allValues : [])}
            />
            {labels.selectAll}
          </label>
          {filter.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 px-1 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => setSelected(event.target.checked
                  ? allValues.filter((item) => item === option.value || selected.includes(item))
                  : selected.filter((item) => item !== option.value))}
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
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
