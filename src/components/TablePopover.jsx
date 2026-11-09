import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Button with a small dialog under it, for table header controls (column filters,
 * column picker). The dialog is portaled with fixed positioning so the table's
 * overflow does not clip it; outside click, Escape, scroll and resize close it.
 */
export default function TablePopover({ label, buttonClassName, buttonContent, pressed, width = 240, align = 'left', children }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const popoverId = useId();

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const preferred = align === 'right' ? rect.right - width : rect.left;
    setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(preferred, window.innerWidth - width - 8)) });
  }, [open, align, width]);

  // The dialog mounts once its position is known, so focus waits for it.
  useEffect(() => {
    if (open && position) popoverRef.current?.querySelector('input')?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onMouseDown = (event) => {
      if (!popoverRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    // A fixed dialog would drift away from its button, so scrolling the page closes it.
    const onScroll = (event) => {
      if (!popoverRef.current?.contains(event.target)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-pressed={pressed}
        className={buttonClassName}
      >
        {buttonContent}
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={label}
          style={{ top: position.top, left: position.left, width }}
          className="fixed z-40 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-xl text-sm normal-case tracking-normal font-normal text-gray-700 dark:text-gray-200"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
