import { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────
//  useFocusTrap — minimal modal focus management hook.
//
//  Audit a11y P1-4 (2026-05-31): modals (MoreSheet, JobDetailModal,
//  PaywallLockout) didn't trap focus, didn't focus the first
//  interactive element on open, and didn't return focus to the
//  triggering element on close. This hook closes those gaps without
//  adding a focus-trap dependency:
//
//    1. On `active === true`, captures `document.activeElement` and
//       focuses the first interactive descendant of the container.
//    2. While active, intercepts Tab / Shift+Tab to cycle focus
//       within the container (focus can't escape to underlying nav).
//    3. On `active === false`, returns focus to whatever was focused
//       when the modal opened.
//
//  Usage:
//    const trapRef = useFocusTrap(open);
//    return open ? <div ref={trapRef} role="dialog" aria-modal="true">...</div> : null;
//
//  Edge cases handled:
//    • If the container has no focusable descendants, focuses the
//      container itself (set tabIndex={-1} on the container).
//    • If the previously-focused element is gone from the DOM by
//      close time (e.g. it was inside another modal), focus quietly
//      drops — no exception.
// ─────────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    // Capture the previously focused element so we can return focus
    // when the modal closes. Falls back to null when nothing was
    // focused (e.g. modal opened via keyboard shortcut from body).
    restoreRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    // Focus the first interactive descendant. Falls back to the
    // container itself (which should declare tabIndex={-1}) so focus
    // is at least inside the modal rather than left on the underlying
    // page.
    const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusables[0] ?? node;
    queueMicrotask(() => first.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (current.length === 0) {
        // No focusables — pin focus to the container.
        e.preventDefault();
        node.focus();
        return;
      }
      const firstEl = current[0];
      const lastEl = current[current.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Restore focus on close. If the original element is gone from
      // the DOM (rare — e.g. modal was opened from inside another
      // modal that has since unmounted), the focus call no-ops.
      const restore = restoreRef.current;
      if (restore && document.body.contains(restore)) {
        try { restore.focus(); } catch { /* no-op */ }
      }
      restoreRef.current = null;
    };
  }, [active]);

  return ref;
}
