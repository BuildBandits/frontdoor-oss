import { ChevronLeft, ChevronRight } from 'lucide-react';

const BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50';

export default function PaginationControls({
  page,
  pages,
  total,
  summary,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  variant = 'panel',
  className = '',
  actions = null,
}) {
  // With a single page the bar only shows when it carries extra actions (e.g. a column picker).
  const paged = pages > 1;
  if (!paged && !actions) return null;

  const variantClassName = variant === 'attached-top'
    ? 'flex flex-col gap-3 border-b border-gray-100 dark:border-gray-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between'
    : variant === 'attached-bottom'
      ? 'flex flex-col gap-3 border-t border-gray-100 dark:border-gray-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between'
      : 'mt-6 flex flex-col gap-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-xs lg:flex-row lg:items-center lg:justify-between';

  return (
    <div className={`${variantClassName} ${className}`.trim()}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{summary || `${page} / ${pages} · ${total}`}</p>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {paged && (
          <>
            <button type="button" onClick={onPrevious} disabled={page <= 1} className={BUTTON_CLASS}>
              <ChevronLeft className="w-4 h-4" />
              {previousLabel}
            </button>
            <button type="button" onClick={onNext} disabled={page >= pages} className={BUTTON_CLASS}>
              {nextLabel}
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
