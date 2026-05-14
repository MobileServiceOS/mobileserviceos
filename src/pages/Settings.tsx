function AccordionShell({ title, icon, summary, badge, open, onToggle, logoUrl, children }: AccordionShellProps) {
  // Use a controlled card + click handler so mutex works. The existing
  // Accordion component manages its own open state internally — not a fit
  // for mutex. So we render the same visual shape inline here.
  //
  // Height tracking: we use a ResizeObserver instead of measuring once on
  // open. Without the observer, when the inner form becomes "dirty" and
  // adds a Save button (or a form row grows), the initial maxHeight stays
  // locked to the pre-growth measurement and the new content gets clipped
  // by the surrounding `overflow: hidden` — visually overlapping the
  // accordion below. The observer fires on every size change so maxH
  // tracks the live content height and the accordion expands smoothly
  // whenever the form grows.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (!open) {
      setMaxH(0);
      return;
    }

    // Initial measurement on open. Use rAF so the DOM has settled and
    // any newly-mounted children have laid out before we measure.
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) setMaxH(el.scrollHeight);
    });

    // Live size tracking — fires whenever the inner content grows or
    // shrinks (dirty-state Save buttons appearing, form rows wrapping,
    // pending-invite lists updating, etc.). ResizeObserver is widely
    // supported (Safari 13.1+, all modern Chromium / Firefox). The
    // typeof guard keeps this safe in case of an old browser or test
    // environment where ResizeObserver isn't defined — we just fall
    // back to the rAF-only measurement.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // contentRect.height excludes padding-box noise; scrollHeight
          // would also work here but contentRect is the value the
          // observer was designed to surface, and it doesn't risk
          // a forced layout pass on every fire.
          const next = Math.ceil(entry.contentRect.height) + 28; // +28 ≈ inner padding (top+bottom 12+16)
          // Only update when the value actually changes to avoid an
          // infinite re-render loop in pathological cases.
          setMaxH((prev) => (prev === next ? prev : next));
        }
      });
      observer.observe(el);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      if (observer) observer.disconnect();
    };
  }, [open]);

  return (
    <div className="card card-anim" style={{ overflow: 'hidden', marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggle}
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
          minHeight: 64,
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            style={{
              width: 36, height: 36, borderRadius: 8,
              objectFit: 'contain', background: 'var(--s2)',
              flexShrink: 0,
            }}
          />
        ) : icon ? (
          <span style={{
            fontSize: 20, width: 36, height: 36, borderRadius: 8,
            background: 'var(--s2)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {icon}
          </span>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, fontWeight: 800, color: 'var(--t1)',
          }}>
            {title}
            {badge && (
              <span style={{
                fontSize: 9, fontWeight: 800,
                color: 'var(--brand-primary)',
                textTransform: 'uppercase', letterSpacing: '1px',
                padding: '2px 6px', borderRadius: 99,
                background: 'rgba(200,164,74,.1)',
                border: '1px solid rgba(200,164,74,.3)',
              }}>
                {badge}
              </span>
            )}
          </div>
          {summary && (
            <div style={{
              fontSize: 11, color: 'var(--t3)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {summary}
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
        style={{
          maxHeight: open ? maxH : 0,
          overflow: 'hidden',
          transition: 'max-height .25s ease',
        }}
      >
        <div
          ref={contentRef}
          style={{
            padding: '12px 16px 16px',
            borderTop: '1px solid var(--border2)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
