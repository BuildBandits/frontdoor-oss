// A row of mutually exclusive options shown at once, for short filters.
// `size="lg"` matches the height of the search fields and dropdowns in filter bars.
export default function SegmentedControl({ options, value, onChange, label, size = 'sm', className = '' }) {
  const large = size === 'lg';
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-stretch rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 ${large ? 'h-12 p-1' : 'p-0.5'} ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${
              large ? 'px-3 text-sm' : 'px-3 py-1 text-xs'
            } ${
              active
                ? 'bg-white dark:bg-gray-800 text-dark dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={`tabular-nums ${active ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 dark:text-gray-500'}`}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
