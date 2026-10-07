import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function DropdownSelect({
  value,
  onChange,
  options,
  label,
  icon: Icon,
  multi = false,
  emptyLabel = '',
  className = '',
  buttonClassName = '',
  menuClassName = '',
  align = 'left',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const itemRefs = useRef([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedValues = useMemo(() => {
    if (multi) return Array.isArray(value) ? value : [];
    return [value];
  }, [multi, value]);

  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(() => {
      const selectedIndex = options.findIndex((option) => (
        multi
          ? (option.clearSelection ? selectedValues.length === 0 : selectedValues.includes(option.value))
          : option.value === value
      ));
      return Math.max(0, selectedIndex);
    });
    const onMouseDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [multi, open, options, selectedValues, value]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus?.();
  }, [activeIndex, open]);

  const selectedOptions = useMemo(
    () => options.filter((option) => selectedValues.includes(option.value)),
    [options, selectedValues]
  );

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || options[0],
    [options, value]
  );

  const selectedText = useMemo(() => {
    if (multi) {
      if (selectedOptions.length === 0) return emptyLabel || options[0]?.label || '';
      if (selectedOptions.length === 1) return selectedOptions[0].label;
      if (selectedOptions.length === 2) return `${selectedOptions[0].label}, ${selectedOptions[1].label}`;
      return `${selectedOptions[0].label}, ${selectedOptions[1].label} +${selectedOptions.length - 2}`;
    }
    return selectedOption?.label || options[0]?.label || '';
  }, [emptyLabel, multi, options, selectedOption, selectedOptions]);

  const handleSelect = (nextValue) => {
    if (multi) {
      if (nextValue === '__clear__') {
        onChange([]);
        setOpen(false);
        return;
      }
      const nextValues = selectedValues.includes(nextValue)
        ? selectedValues.filter((currentValue) => currentValue !== nextValue)
        : [...selectedValues, nextValue];
      onChange(nextValues);
      return;
    }

    onChange(nextValue);
    setOpen(false);
  };

  const moveActive = (delta) => {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      const next = (current + delta + options.length) % options.length;
      return next;
    });
  };

  const handleKeyDown = (event) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex h-12 w-full items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 text-sm text-left text-gray-600 dark:text-gray-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-900 ${buttonClassName}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" /> : null}
        {label && <span className="shrink-0 text-gray-400 dark:text-gray-500">{label}</span>}
        <span className="min-w-0 flex-1 truncate text-dark dark:text-gray-100">
          {selectedText}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
      </button>

      {open && (
        <div
          className={`absolute top-full z-20 mt-2 w-full min-w-full max-w-full overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
          onKeyDown={handleKeyDown}
        >
          <div className="max-h-72 overflow-auto py-1">
            {options.map((option, index) => {
              const selected = multi
                ? (option.clearSelection ? selectedValues.length === 0 : selectedValues.includes(option.value))
                : option.value === value;
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  onClick={() => handleSelect(option.clearSelection ? '__clear__' : option.value)}
                  onMouseEnter={() => setActiveIndex(index)}
                  tabIndex={open && index === activeIndex ? 0 : -1}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    selected || index === activeIndex
                      ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {multi ? (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selected
                          ? 'border-dark bg-dark text-white'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                  <span className="flex-1 truncate">{option.label}</span>
                  {!multi && (
                    <Check
                      className={`h-4 w-4 shrink-0 transition-opacity ${selected ? 'text-dark dark:text-gray-100 opacity-100' : 'opacity-0'}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
