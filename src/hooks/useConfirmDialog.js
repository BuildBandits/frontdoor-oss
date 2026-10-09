import { useCallback, useState } from 'react';

/**
 * State for one <ConfirmDialog> per page. `open({ title, message, confirmLabel,
 * cancelLabel, onConfirm, closeFirst })` shows it; spread `dialogProps` on the
 * dialog. Confirming runs `onConfirm` with the dialog busy (it cannot be closed
 * meanwhile) and closes it afterwards; with `closeFirst` the dialog closes first,
 * for actions that show their own progress.
 */
export function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback((next) => setDialog(next), []);
  const close = useCallback(() => setDialog(null), []);

  const cancel = () => {
    if (busy) return;
    dialog?.onCancel?.();
    setDialog(null);
  };

  const confirm = async () => {
    const run = dialog?.onConfirm;
    if (!run || dialog.closeFirst) {
      setDialog(null);
      if (run) await run();
      return;
    }
    setBusy(true);
    try {
      await run();
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  return {
    dialog,
    busy,
    open,
    close,
    dialogProps: {
      open: Boolean(dialog),
      title: dialog?.title || '',
      message: dialog?.message || '',
      confirmLabel: dialog?.confirmLabel,
      cancelLabel: dialog?.cancelLabel,
      busy,
      onConfirm: confirm,
      onCancel: cancel,
    },
  };
}
