import { useRef } from 'react';
import { Search, X } from 'lucide-react';

export default function ClearableSearchField({
  value,
  onChange,
  placeholder,
  className = '',
  inputClassName = '',
  autoFocus = false,
  inputRef,
  searchShortcutTarget,
  searchShortcutLabel,
  onKeyDown,
  clearLabel = 'Clear search',
}) {
  const lastClearedValueRef = useRef('');

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (value) {
        event.preventDefault();
        event.stopPropagation();
        lastClearedValueRef.current = value;
        onChange('');
        return;
      }

      if (lastClearedValueRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onChange(lastClearedValueRef.current);
        lastClearedValueRef.current = '';
        return;
      }
    }
    onKeyDown?.(event);
  };

  const handleChange = (event) => {
    const nextValue = event.target.value;
    if (nextValue) {
      lastClearedValueRef.current = '';
    }
    onChange(nextValue);
  };

  return (
    <div className={className}>
      <div className="flex w-full h-12 items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus-within:ring-2 focus-within:ring-accent dark:focus-within:ring-gray-500">
        <Search className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={value}
          ref={inputRef}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          data-frontdoor-search-target={searchShortcutTarget || undefined}
          className={`min-w-0 flex-1 h-full border-0 bg-transparent p-0 text-sm leading-none text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:text-gray-100 dark:placeholder:text-gray-500 ${inputClassName}`}
        />
        <div className="flex items-center gap-2 shrink-0">
          {searchShortcutTarget && searchShortcutLabel && (
            <span
              className="hidden md:inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500"
              aria-hidden="true"
            >
              {searchShortcutLabel}
            </span>
          )}
          {value && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange('')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 dark:text-gray-500 transition-colors hover:bg-gray-100 hover:text-dark dark:hover:bg-gray-800 dark:hover:text-white"
              aria-label={clearLabel}
              title={clearLabel}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
