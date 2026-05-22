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
  tabIndex,
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
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
      <input
        type="text"
        value={value}
        ref={inputRef}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        className={`w-full pl-10 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500 ${inputClassName}`}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          aria-label={clearLabel}
          title={clearLabel}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
