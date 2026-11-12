import { useRef, useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Focus trap utility for accessible dialogs.
 * Traps keyboard focus within a container element.
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    'button:not([disabled])',
    '[href]:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    '[contenteditable="true"]',
  ].join(', ');

  const getFocusableElements = () =>
    Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors))
      .filter((el) => el.offsetParent !== null); // visible elements

  let firstFocusable: HTMLElement | null = null;
  let lastFocusable: HTMLElement | null = null;
  let previouslyFocused: HTMLElement | null = null;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    firstFocusable = focusable[0]!;
    lastFocusable = focusable[focusable.length - 1]!;

    if (event.shiftKey) {
      if (document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  const handleFocusIn = () => {
    const focusable = getFocusableElements();
    firstFocusable = focusable[0] ?? null;
    lastFocusable = focusable[focusable.length - 1] ?? null;
  };

  // Store previously focused element to restore on cleanup
  previouslyFocused = document.activeElement as HTMLElement;

  // Initial focus
  const initialFocusable = getFocusableElements();
  if (initialFocusable.length > 0) {
    firstFocusable = initialFocusable[0]!;
    lastFocusable = initialFocusable[initialFocusable.length - 1]!;
    firstFocusable.focus();
  }

  container.addEventListener('keydown', handleKeyDown);
  container.addEventListener('focusin', handleFocusIn);

  return () => {
    container.removeEventListener('keydown', handleKeyDown);
    container.removeEventListener('focusin', handleFocusIn);
    // Restore focus to previously focused element
    previouslyFocused?.focus?.();
  };
}

/**
 * Hook for using focus trap in Preact components.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, enabled = true): void {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !ref.current) return;
    cleanupRef.current = trapFocus(ref.current);
    return () => cleanupRef.current?.();
  }, [ref, enabled]);
}