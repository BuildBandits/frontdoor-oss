import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const noticeStyles = {
  success: {
    wrapper: 'border-accent/30 bg-accent/10 text-dark dark:text-gray-100',
    icon: CheckCircle2,
  },
  error: {
    wrapper: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
    icon: AlertTriangle,
  },
  warning: {
    wrapper: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
    icon: AlertTriangle,
  },
  info: {
    wrapper: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200',
    icon: Info,
  },
};

export default function PageNotice({
  type = 'info',
  title,
  message,
  children,
  actionLabel,
  onAction,
  onClose,
  closeLabel = 'Close notice',
}) {
  const config = noticeStyles[type] || noticeStyles.info;
  const Icon = config.icon;

  if (!title && !message && !children) return null;

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm ${config.wrapper}`} role="status" aria-live="polite">
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {title && <div className="text-sm font-semibold">{title}</div>}
            {message && <div className={`text-sm ${title ? 'mt-1 font-medium' : 'font-medium'} whitespace-pre-line`}>{message}</div>}
          </div>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="shrink-0 text-xs font-semibold text-amber-800 underline-offset-4 transition-colors hover:underline"
            >
              {actionLabel}
            </button>
          )}
        </div>
        {children && <div className="mt-3">{children}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 transition-colors hover:bg-black/5"
          aria-label={closeLabel}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
