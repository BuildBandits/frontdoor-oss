import { createPortal } from 'react-dom';
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function Tooltip({
  content,
  children,
  tooltipClassName = '',
  placement = 'bottom',
  enabled = true,
}) {
  const [open, setOpen] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [coords, setCoords] = useState(null);
  const anchorRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const updateHoverCapability = () => setCanHover(mediaQuery.matches);

    updateHoverCapability();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateHoverCapability);
      return () => mediaQuery.removeEventListener('change', updateHoverCapability);
    }

    mediaQuery.addListener(updateHoverCapability);
    return () => mediaQuery.removeListener(updateHoverCapability);
  }, []);

  useLayoutEffect(() => {
    if (!open || !canHover) {
      setCoords(null);
      return undefined;
    }

    const updatePosition = () => {
      const element = anchorRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const gap = 8;
      let top = rect.bottom + gap;
      let left = rect.left + rect.width / 2;
      let transform = 'translateX(-50%)';

      if (placement === 'top') {
        top = rect.top - gap;
        transform = 'translate(-50%, -100%)';
      } else if (placement === 'left') {
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        transform = 'translate(-100%, -50%)';
      } else if (placement === 'right') {
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        transform = 'translate(0, -50%)';
      }

      setCoords({ top, left, transform });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, canHover, placement]);

  if (!enabled || !content) {
    return children;
  }

  const child = isValidElement(children)
    ? cloneElement(children, {
        ref: (node) => {
          anchorRef.current = node;
          // React 19: ref is a regular prop; element.ref is deprecated.
          const { ref } = children.props;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref && typeof ref === 'object') {
            ref.current = node;
          }
        },
        onMouseEnter: (...args) => {
          children.props.onMouseEnter?.(...args);
          setOpen(true);
        },
        onMouseLeave: (...args) => {
          children.props.onMouseLeave?.(...args);
          setOpen(false);
        },
        onFocus: (...args) => {
          children.props.onFocus?.(...args);
          setOpen(true);
        },
        onBlur: (...args) => {
          children.props.onBlur?.(...args);
          setOpen(false);
        },
      })
    : children;

  return (
    <>
      {child}
      {open && canHover && coords && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.transform,
          }}
          className={`pointer-events-none z-50 inline-block max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal break-words rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700 shadow-xl shadow-black/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 ${tooltipClassName}`}
        >
          {content}
        </span>,
        document.body
      )}
    </>
  );
}
