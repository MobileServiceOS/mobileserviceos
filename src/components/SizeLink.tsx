import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────
//  SizeLink — the single shared "tap a tire size → see it in Inventory"
//  control, used EVERYWHERE a size is shown (History, Best Sellers,
//  Reorder Now, Quick Quote, Job Detail, Customer profile, Low Stock).
//
//  Navigation flows through a context so the link works the same inside
//  pages, gated lazy routes, and modals with no prop-drilling. App mounts
//  one SizeLinkProvider whose handler focuses the Inventory tab on the
//  size (see App.openInventoryForSize → the Inventory focus banner with
//  on-hand + jobs/90d + the restock action on one screen).
//
//  Degrades safely: with no provider mounted, SizeLink renders the size as
//  plain static text, so it's safe to drop anywhere.
// ─────────────────────────────────────────────────────────────────────

const SizeLinkContext = createContext<((size: string) => void) | null>(null);

export function SizeLinkProvider({ onOpen, children }: { onOpen: (size: string) => void; children: ReactNode }) {
  return <SizeLinkContext.Provider value={onOpen}>{children}</SizeLinkContext.Provider>;
}

/**
 * Navigator for whole-row / whole-card tap targets (e.g. Low Stock Alert
 * cards) where wrapping just the size text isn't enough. Same context as
 * SizeLink. Returns null when no provider is mounted.
 */
export function useSizeLinkNav(): ((size: string) => void) | null {
  return useContext(SizeLinkContext);
}

const PILL: CSSProperties = {
  fontSize: 10, fontWeight: 800, color: 'var(--brand-primary)', letterSpacing: '0.3px',
  padding: '2px 6px', borderRadius: 99,
  background: 'rgba(200,164,74,.06)', border: '1px solid rgba(200,164,74,.25)',
};
const PLAIN: CSSProperties = {
  color: 'var(--brand-primary)', fontWeight: 700, background: 'none', border: 'none',
  padding: 0, textDecoration: 'underline', textUnderlineOffset: 2,
};

export function SizeLink({
  size, variant = 'pill', showArrow = true, style, as = 'button',
}: {
  size: string | null | undefined;
  variant?: 'pill' | 'plain';
  showArrow?: boolean;
  style?: CSSProperties;
  /** Render as a <span role="link"> instead of a <button> — use inside an
   *  outer <button> (e.g. a clickable list row) to avoid nested buttons. */
  as?: 'button' | 'span';
}) {
  const open = useContext(SizeLinkContext);
  const label = (size || '').trim();
  if (!label) return null;
  const base = variant === 'pill' ? PILL : PLAIN;

  // No provider → static text (still styled so it doesn't look broken).
  if (!open) return <span style={{ ...base, ...style }}>{label}</span>;

  const activate = (e: { stopPropagation: () => void }) => { e.stopPropagation(); open(label); };
  const inner = (
    <>
      {label}
      {showArrow && <span aria-hidden style={{ opacity: 0.7, fontWeight: 900 }}>→</span>}
    </>
  );
  const shared: CSSProperties = { ...base, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, ...style };

  if (as === 'span') {
    return (
      <span
        role="link"
        tabIndex={0}
        title={`View ${label} in inventory`}
        onClick={activate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') activate(e); }}
        style={shared}
      >
        {inner}
      </span>
    );
  }

  return (
    <button type="button" title={`View ${label} in inventory`} onClick={activate} style={shared}>
      {inner}
    </button>
  );
}

export default SizeLink;
