import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const COPY_FEEDBACK_MS = 2000;

// Renders a template like "Added {count} members to {target}" with the values in bold.
function Summary({ template, values }) {
  const parts = String(template).split(/(\{\w+\})/g);
  return (
    <p className="text-xs text-dark dark:text-gray-100 leading-relaxed">
      {parts.map((part, index) => {
        const match = part.match(/^\{(\w+)\}$/);
        if (!match || values[match[1]] === undefined) return part;
        return <strong key={index} className="font-semibold">{values[match[1]]}</strong>;
      })}
    </p>
  );
}

function titleFor(value) {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// `event` is the result of describeAuditLog() for one audit row.
export default function AuditDetails({ event, ui }) {
  const t = ui.admin.audit;
  const [copyState, setCopyState] = useState(null);

  useEffect(() => {
    if (!copyState) return undefined;
    const timer = setTimeout(() => setCopyState(null), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(event.raw);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="space-y-1.5 max-w-[460px]">
      <Summary template={event.summary.template} values={event.summary.values} />

      {event.changes.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
          {event.changes.map((change) => (
            <li key={change.field} className="wrap-break-word">
              <span className="font-medium text-gray-700 dark:text-gray-200">{change.label}:</span>{' '}
              <span className="text-gray-400 dark:text-gray-500" title={titleFor(change.fullFrom)}>{change.from}</span>
              {' → '}
              <span className="font-medium text-dark dark:text-gray-100" title={titleFor(change.fullTo)}>{change.to}</span>
            </li>
          ))}
        </ul>
      )}

      {event.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {event.facts.map((fact) => (
            <div key={fact.key} className="contents">
              <dt className="text-gray-400 dark:text-gray-500">{fact.label}</dt>
              <dd className="text-gray-600 dark:text-gray-300 wrap-break-word">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {event.text && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 wrap-break-word">{event.text}</p>
      )}

      {event.raw && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 pt-0.5">
          <button
            type="button"
            onClick={copyRaw}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white transition-colors"
            title={t.copyJsonHelp}
          >
            {copyState === 'copied' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copyState === 'copied' ? t.copied : copyState === 'failed' ? t.copyFailed : t.copyJson}
          </button>
          <details className="group">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white">
              <span className="group-open:hidden">{t.showRaw}</span>
              <span className="hidden group-open:inline">{t.hideRaw}</span>
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2 text-[11px] text-gray-500 dark:text-gray-400 font-mono">
              {event.raw}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
