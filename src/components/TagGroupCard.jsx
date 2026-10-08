import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatMessage } from '../i18n';

export default function TagGroupCard({ tag, count, isOpen, onToggle, ui }) {
  return (
    <button
      onClick={onToggle}
      className={`bg-white dark:bg-gray-900 rounded-2xl p-6 border text-left w-full transition-all duration-200 ${
        isOpen
          ? 'border-accent shadow-lg shadow-accent/10'
          : 'border-gray-100 dark:border-gray-800 hover:border-accent hover:shadow-lg hover:shadow-accent/10'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
            {tag}
          </span>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {formatMessage(count === 1 ? ui.home.appCountOne : ui.home.appCount, { count })}
          </p>
        </div>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        )}
      </div>
    </button>
  );
}
