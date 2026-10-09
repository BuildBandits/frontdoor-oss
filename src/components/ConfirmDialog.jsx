import { useId } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import Modal from './Modal';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  closeLabel,
  busyLabel,
  busy = false,
  onConfirm,
  onCancel,
  // UI strings for the labels a page does not set (confirm, cancel, close, please wait).
  ui,
}) {
  const titleId = useId();
  const messageId = useId();

  if (!open) return null;

  const labels = {
    confirm: confirmLabel || ui?.common?.confirm,
    cancel: cancelLabel || ui?.common?.cancel,
    close: closeLabel || ui?.common?.closeDialog,
    busy: busyLabel || ui?.common?.pleaseWait,
  };

  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      onClose={cancel}
      labelledBy={titleId}
      describedBy={message ? messageId : undefined}
      panelClassName="w-full max-w-lg rounded-3xl bg-white dark:bg-gray-900 p-6 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-lg font-bold text-dark dark:text-gray-100">{title}</h2>
          {message && <p id={messageId} className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300">{message}</p>}
        </div>
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg p-2 text-gray-400 dark:text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white"
          aria-label={labels.close}
          disabled={busy}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800 pt-5">
        {/* Focus starts on Cancel so Enter never confirms a destructive action by accident. */}
        <button
          type="button"
          data-autofocus
          onClick={cancel}
          disabled={busy}
          className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-50"
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? labels.busy : labels.confirm}
        </button>
      </div>
    </Modal>
  );
}
