import React, { useEffect, useLayoutEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || (el as any).disabled === true) return false;
  if (el.getAttribute('aria-hidden') === 'true' || Boolean(el.closest('[aria-hidden="true"]'))) return false;
  if (el.hasAttribute('hidden') || Boolean(el.closest('[hidden]'))) return false;
  if (el.classList.contains('hidden') || Boolean(el.closest('.hidden'))) return false;

  let curr: HTMLElement | null = el;
  while (curr) {
    if (curr.style?.display === 'none' || curr.style?.visibility === 'hidden') {
      return false;
    }
    curr = curr.parentElement;
  }

  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
  return elements.filter((el) => el.tabIndex >= 0 && isFocusable(el));
}

export interface UseModalA11yOptions {
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Shared accessibility hook for modal dialogs.
 * - On open: saves the opener element and moves focus inside (to the first focusable element, specified element, or heading)
 * - Traps Tab and Shift+Tab navigation within the container
 * - Closes on Escape
 * - On close: returns focus to the opener element
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose?: () => void,
  containerRef?: React.RefObject<T | null>,
  options?: UseModalA11yOptions
): React.RefObject<T | null> {
  const internalRef = useRef<T | null>(null);
  const resolvedRef = containerRef || internalRef;
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef<boolean>(false);
  const onCloseRef = useRef(onClose);
  const optionsRef = useRef(options);
  // Keep the latest callback and options without re-running the focus effects.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    optionsRef.current = options;
  });

  const returnFocus = () => {
    const target = optionsRef.current?.returnFocusRef?.current || openerRef.current;
    openerRef.current = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      try {
        target.focus();
      } catch {
        // Safe fallback if target cannot receive focus
      }
    }
  };

  // Manage open / close focus transitions
  useEffect(() => {
    if (isOpen) {
      if (!wasOpenRef.current) {
        wasOpenRef.current = true;
        const container = resolvedRef.current;
        const currentActive = document.activeElement as HTMLElement | null;
        openerRef.current =
          optionsRef.current?.returnFocusRef?.current ||
          (container && currentActive && container.contains(currentActive) ? null : currentActive);

        if (container) {
          if (optionsRef.current?.initialFocusRef?.current) {
            const target = optionsRef.current.initialFocusRef.current;
            if (!target.hasAttribute('tabindex') && target.tabIndex < 0) {
              target.setAttribute('tabindex', '-1');
            }
            target.focus();
          } else {
            const focusables = getFocusableElements(container);
            if (focusables.length > 0) {
              focusables[0].focus();
            } else {
              const heading = container.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
              if (heading) {
                if (!heading.hasAttribute('tabindex')) {
                  heading.setAttribute('tabindex', '-1');
                }
                heading.focus();
              } else {
                if (!container.hasAttribute('tabindex')) {
                  container.setAttribute('tabindex', '-1');
                }
                container.focus();
              }
            }
          }
        }
      }
    } else {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        returnFocus();
      }
    }
  }, [isOpen]);

  // Trap focus & handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && !e.defaultPrevented && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (e.key === 'Tab') {
        const container = resolvedRef.current;
        if (!container) return;

        const focusables = getFocusableElements(container);
        if (focusables.length === 0) {
          e.preventDefault();
          const heading = container.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
          if (heading) {
            if (!heading.hasAttribute('tabindex')) {
              heading.setAttribute('tabindex', '-1');
            }
            heading.focus();
          } else {
            if (!container.hasAttribute('tabindex')) {
              container.setAttribute('tabindex', '-1');
            }
            container.focus();
          }
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const activeIndex = focusables.indexOf(active as HTMLElement);

        if (e.shiftKey) {
          if (active === first || !container.contains(active) || activeIndex === -1) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !container.contains(active) || activeIndex === -1) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  // Return focus on unmount if unmounted while still open
  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        returnFocus();
      }
    };
  }, []);

  return resolvedRef;
}
