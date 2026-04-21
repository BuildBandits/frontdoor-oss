import { Search, X } from 'lucide-react';

export default function ClearableSearchField({
  value,
  onChange,
  placeholder,
  className = '',
  inputClassName = '',
  autoFocus = false,
  onKeyDown,
}) {
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      event.stopPropagation();
      onChange('');
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent ${inputClassName}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-dark hover:bg-gray-100 rounded-md transition-colors"
          aria-label="Cancella ricerca"
          title="Cancella ricerca"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
