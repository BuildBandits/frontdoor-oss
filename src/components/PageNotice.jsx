import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const noticeStyles = {
  success: {
    wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    icon: CheckCircle2,
  },
  error: {
    wrapper: 'border-red-200 bg-red-50 text-red-800',
    icon: AlertTriangle,
  },
  info: {
    wrapper: 'border-sky-200 bg-sky-50 text-sky-800',
    icon: Info,
  },
};

export default function PageNotice({ type = 'info', message, onClose }) {
  const config = noticeStyles[type] || noticeStyles.info;
  const Icon = config.icon;

  if (!message) return null;

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm ${config.wrapper}`} role="status" aria-live="polite">
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="min-w-0 flex-1 text-sm font-medium whitespace-pre-line">{message}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 transition-colors hover:bg-black/5"
          aria-label="Chiudi notifica"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
