import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const toastStackRegistry = new Map();
const toastStackSubscribers = new Set();

let toastStackInstanceSeq = 0;
let toastStackOrderSeq = 0;

const STACK_GAP_PX = 72;
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function notifyToastStackSubscribers() {
  toastStackSubscribers.forEach((listener) => listener());
}

function subscribeToastStack(listener) {
  toastStackSubscribers.add(listener);
  return () => {
    toastStackSubscribers.delete(listener);
  };
}

function getToastStackIndex(instanceId, positionClassName) {
  const stackEntries = [...toastStackRegistry.entries()]
    .filter(([, entry]) => entry.positionClassName === positionClassName)
    .sort((a, b) => b[1].order - a[1].order);

  const stackIndex = stackEntries.findIndex(([key]) => key === instanceId);
  return stackIndex < 0 ? 0 : stackIndex;
}

const noticeStyles = {
  success: {
    wrapper: 'border-accent/30 bg-white text-dark dark:border-accent-dark/40 dark:bg-gray-900 dark:text-gray-100',
    icon: CheckCircle2,
    progress: 'bg-accent dark:bg-accent-dark',
    barTrack: 'bg-black/10 dark:bg-white/10',
  },
  error: {
    wrapper: 'border-red-200 bg-white text-red-800 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-200',
    icon: AlertTriangle,
    progress: 'bg-red-500 dark:bg-red-400',
    barTrack: 'bg-red-100 dark:bg-red-950/70',
  },
  warning: {
    wrapper: 'border-amber-200 bg-white text-amber-900 dark:border-amber-900/60 dark:bg-gray-900 dark:text-amber-200',
    icon: AlertTriangle,
    progress: 'bg-amber-500 dark:bg-amber-400',
    barTrack: 'bg-amber-100 dark:bg-amber-950/70',
  },
  info: {
    wrapper: 'border-sky-200 bg-white text-sky-800 dark:border-sky-900/60 dark:bg-gray-900 dark:text-sky-200',
    icon: Info,
    progress: 'bg-sky-500 dark:bg-sky-400',
    barTrack: 'bg-sky-100 dark:bg-sky-950/70',
  },
};

export default function TopToastNotice({
  notice,
  onClose,
  closeLabel,
  duration = 2000,
  className = '',
  positionClassName = 'top-4 sm:top-6',
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [, forceStackRefresh] = useState(0);
  const dismissTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const instanceIdRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  if (!instanceIdRef.current) {
    toastStackInstanceSeq += 1;
    instanceIdRef.current = `top-toast-${toastStackInstanceSeq}`;
  }

  useIsomorphicLayoutEffect(() => subscribeToastStack(() => forceStackRefresh((value) => value + 1)), []);

  useIsomorphicLayoutEffect(() => {
    if (!notice) {
      if (toastStackRegistry.delete(instanceIdRef.current)) {
        notifyToastStackSubscribers();
      }
      return undefined;
    }

    toastStackOrderSeq += 1;
    toastStackRegistry.set(instanceIdRef.current, {
      positionClassName,
      order: toastStackOrderSeq,
    });
    notifyToastStackSubscribers();

    setIsClosing(false);

    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);

    const exitDelay = 180;
    const closeNotice = () => {
      setIsClosing(true);
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        onCloseRef.current?.();
        closeTimerRef.current = null;
      }, exitDelay);
    };

    if (duration !== null && duration !== false) {
      const fadeDelay = Math.max(duration - exitDelay, 0);
      dismissTimerRef.current = window.setTimeout(closeNotice, fadeDelay);
    }

    return () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      dismissTimerRef.current = null;
      closeTimerRef.current = null;
      if (toastStackRegistry.delete(instanceIdRef.current)) {
        notifyToastStackSubscribers();
      }
    };
  }, [notice, duration, positionClassName]);

  if (!notice) return null;

  const config = noticeStyles[notice.type] || noticeStyles.info;
  const Icon = config.icon;
  const role = notice.type === 'error' ? 'alert' : 'status';
  const ariaLive = notice.type === 'error' ? 'assertive' : 'polite';
  const stackIndex = getToastStackIndex(instanceIdRef.current, positionClassName);
  const stackOffset = stackIndex * STACK_GAP_PX;
  const stackZIndex = 100 - stackIndex;

  const handleClose = () => {
    if (isClosing) return;

    setIsClosing(true);
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);

    closeTimerRef.current = window.setTimeout(() => {
      onCloseRef.current?.();
      closeTimerRef.current = null;
    }, 180);
  };

  return (
    <div className={`pointer-events-none fixed inset-x-0 z-70 flex justify-center px-4 ${positionClassName} ${className}`}>
      <div
        className={`pointer-events-auto relative w-[min(42rem,calc(100vw-2rem))] origin-top overflow-hidden rounded-2xl border-2 ring-1 ring-black/10 dark:ring-white/10 shadow-2xl shadow-black/15 ${config.wrapper} ${
          isClosing ? 'toast-notice-exit' : 'toast-notice-enter'
        }`}
        style={{ marginTop: `${stackOffset}px`, zIndex: stackZIndex }}
        role={role}
        aria-live={ariaLive}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            {notice.title && <div className="text-sm font-semibold">{notice.title}</div>}
            {notice.message && (
              <div className={`text-sm whitespace-pre-line ${notice.title ? 'mt-1 font-medium' : 'font-medium'}`}>
                {notice.message}
              </div>
            )}
            {notice.children && <div className="mt-3">{notice.children}</div>}
          </div>
          {(onClose || notice.actionLabel) && (
            <div className="flex shrink-0 items-start gap-2">
              {notice.actionLabel && notice.onAction && (
                <button
                  type="button"
                  onClick={notice.onAction}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-accent-dark transition-colors hover:bg-black/5 dark:text-accent"
                >
                  {notice.actionLabel}
                </button>
              )}
              {onClose && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  aria-label={closeLabel}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        {duration !== null && duration !== false && (
          <div className={`h-1 ${config.barTrack}`}>
            <div
              className={`h-full w-full origin-left ${config.progress} toast-notice-progress`}
              style={{ animationDuration: `${duration}ms` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
