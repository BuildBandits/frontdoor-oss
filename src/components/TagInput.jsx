import { useState, useRef, useMemo } from 'react';
import { X } from 'lucide-react';

export default function TagInput({ value = [], onChange, placeholder = 'Aggiungi etichetta...', suggestions = [] }) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const normalizeTag = (tag) => tag.trim().toLowerCase();

  const normalizeValue = (tags) => {
    const seen = new Set();
    const normalized = [];
    for (const tag of tags) {
      const next = normalizeTag(tag);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      normalized.push(next);
    }
    return normalized;
  };

  const addTag = (text) => {
    const tag = normalizeTag(text);
    const nextValue = normalizeValue(value);
    if (tag && !nextValue.includes(tag)) {
      onChange([...nextValue, tag]);
    } else if (value.length !== nextValue.length) {
      onChange(nextValue);
    }
    setInput('');
  };

  const removeTag = (tag) => {
    const target = normalizeTag(tag);
    onChange(value.filter((t) => normalizeTag(t) !== target));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const handleBlur = () => {
    if (input.trim()) addTag(input);
    setShowSuggestions(false);
  };

  const normalizedSuggestions = useMemo(() => {
    const currentTags = new Set(normalizeValue(value));
    const query = normalizeTag(input);
    if (!query) return [];

    const seen = new Set();
    return suggestions
      .map(normalizeTag)
      .filter((tag) => tag && !currentTags.has(tag))
      .filter((tag) => tag.includes(query))
      .filter((tag) => {
        if (seen.has(tag)) return false;
        seen.add(tag);
        return true;
      })
      .slice(0, 6);
  }, [suggestions, input, value]);

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 min-h-[44px] px-3 py-2 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-accent focus-within:border-transparent transition cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {normalizeValue(value).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-semibold uppercase tracking-wider rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="text-purple-400 hover:text-purple-700 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[100px] text-sm outline-none bg-transparent py-0.5"
        />
      </div>

      {showSuggestions && input.trim() && normalizedSuggestions.length > 0 && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-100">
            Suggerimenti
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {normalizedSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(tag);
                  setShowSuggestions(false);
                  inputRef.current?.focus();
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-purple-50 transition-colors flex items-center justify-between gap-3"
              >
                <span className="font-medium">{tag}</span>
                <span className="text-[11px] text-gray-400">Usa tag esistente</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
