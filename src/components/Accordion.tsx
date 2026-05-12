import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Visible header label, e.g. "Brand", "Business", "Pricing". */
  title: string;
  /** Optional short subtitle shown next to the title, e.g. "Logo, name, colors". */
  subtitle?: string;
  /** Optional right-side badge (e.g. "Pro", "Beta"). Renders as a small pill. */
  badge?: string;
  /** Open by default. Owners typically want Brand and Pricing open. */
  defaultOpen?: boolean;
  /** Persist open/closed across reloads. Key is a stable string per-section
   *  (e.g. "brand"). When omitted, state is purely in-memory. */
  storageKey?: string;
  /** Lead-in icon for visual scanning, e.g. "🎨", "🏢". */
  icon?: string;
  children: ReactNode;
}

/**
 * Mobile-first collapsible section.
 *
 * Designed for the Settings page on a phone — long settings are exhausting
 * to scroll through. This component lets each section collapse to a
 * single tappable header, expanding only on demand.
 *
 * Behavior:
 *   - Tap the header to toggle.
 *   - Smooth max-height animation on expand/collapse (no layout jank).
 *   - Caret rotates 90° when open.
 *   - Optional localStorage persistence so reloading the page doesn't
 *     reset every section to closed.
 *   - 56px+ tap target — one-thumb friendly.
 *   - Accessible: button with aria-expanded.
 *
 * Why not native <details>/<summary>? Three reasons:
 *   1. Can't animate <details> open/close smoothly across browsers.
 *   2. <summary> default styling fights our gold-accent theme.
 *   3. We want optional persistence + badge slot which native doesn't give us.
 *
 * The animation strategy uses scrollHeight to size the inner container
 * to its content, then animates max-height. Works for any content size
 * without measuring twice.
 */
export function Accordion({
  title, subtitle, badge, defaultOpen = false, storageKey, icon, children,
}: Props) {
  // Read initial state from localStorage if a key was given. Falls back to
  // defaultOpen for first-ever render or when localStorage is unavailable.
  const [open, setOpen] = useState<boolean>(() => {
    if (!storageKey) return defaultOpen;
    try {
      const v = typeof localStorage !== 'undefined'
        ? localStorage.getItem(`msos:acc:${storageKey}`)
        : null;
      if (v === '1') return true;
      if (v === '0') return false;
      return defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState<number>(0);

  // Recompute max-height whenever open changes or children change. Without
  // this, expanding a section whose content grows (e.g. user typed in an
  // input that pushed the layout) would clip.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (open) {
      // Read scrollHeight after the element is in the DOM. rAF ensures
      // the browser has measured the new children.
      requestAnimationFrame(() => {
        setMaxH(el.scrollHeight);
      });
    } else {
      setMaxH(0);
    }
  }, [open, children]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`msos:acc:${storageKey}`, next ? '1' : '0');
        }
      } catch {
        // Best-effort persistence; ignore failures.
      }
    }
  };

  return (
    <div className="card card-anim" style={{ overflow: 'hidden', marginBottom: 12 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          color: 'var(--t1)',
          textAlign: 'left',
          cursor: 'pointer',
          minHeight: 56,
        }}
      >
        {icon && (
          <span style={{
            fontSize: 20, width: 32, height: 32, borderRadius: 8,
            background: 'var(--s2)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {icon}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, fontWeight: 800, color: 'var(--t1)',
          }}>
            {title}
            {badge && (
              <span className="pill" style={{ fontSize: 9, padding: '2px 6px' }}>
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        <span
          aria-hidden
          style={{
            fontSize: 14,
            color: 'var(--t3)',
            transition: 'transform .25s ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          ▸
        </span>
      </button>
      <div
        ref={contentRef}
        style={{
          maxHeight: open ? maxH : 0,
          // `overflow: hidden` is what makes the max-height collapse look
          // clean. We rely on the inner padding for breathing room when
          // expanded; collapsed state has 0 padding-bottom via the inner
          // wrapper.
          overflow: 'hidden',
          transition: 'max-height .25s ease',
        }}
      >
        <div style={{
          padding: open ? '0 16px 16px' : '0 16px 0',
          borderTop: open ? '1px solid var(--border2)' : 'none',
          marginTop: open ? 0 : 0,
          paddingTop: open ? 12 : 0,
          transition: 'padding .15s ease',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}
