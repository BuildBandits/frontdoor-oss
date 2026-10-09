import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog shell: dialog semantics, Escape and backdrop close (both through
 * onClose, so callers can check for unsaved changes), focus moved into the dialog,
 * kept inside it while open and given back to the opener on close.
 */
export default function Modal({
  onClose,
  labelledBy,
  describedBy,
  children,
  panelClassName = 'w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl',
  overlayClassName = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6',
  closeOnEscape = true,
  closeOnBackdrop = true,
  initialFocusRef,
}) {
  const panelRef = useRef(null);
  // Latest onClose, so the key listener registered once always calls the current one.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const requestClose = () => onCloseRef.current?.();

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    const target = initialFocusRef?.current || panel?.querySelector('[data-autofocus]') || panel?.querySelector(FOCUSABLE) || panel;
    target?.focus({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [closeOnEscape, initialFocusRef]);

  return createPortal(
    <div
      className={overlayClassName}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`${panelClassName} focus:outline-hidden`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
