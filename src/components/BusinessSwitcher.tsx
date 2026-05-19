// ═══════════════════════════════════════════════════════════════════
//  src/components/BusinessSwitcher.tsx — Multi-business UI (STAGE 2b)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  A compact dropdown that lets a user with multiple businesses
//  switch the active one. Rendered inside the Header.
//
//  BACK-COMPAT — IMPORTANT
//  ───────────────────────
//  This component renders NOTHING (returns null) when the user owns
//  only one business — `canSwitch` is false. A single-business
//  operator never sees it; the Header looks exactly as it did
//  before Stage 2b. The switcher only appears once a user has
//  deliberately created a second business.
//
//  Switching delegates entirely to BusinessSwitcherContext, which
//  persists the choice and reloads so BrandContext re-resolves the
//  active business cleanly.
// ═══════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react';
import { useBusinessSwitcher } from '@/context/BusinessSwitcherContext';
import { AddBusinessModal } from '@/components/AddBusinessModal';
import { _auth } from '@/lib/firebase';

interface Props {
  /** Label for the currently active business (its business name). */
  activeLabel: string;
}

export function BusinessSwitcher({ activeLabel }: Props) {
  const { ownedBusinesses, activeBusinessId, canSwitch, canCreate, switchBusiness } = useBusinessSwitcher();
  const [open, setOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Render nothing only when the user can neither switch (single
  // business) NOR create another. A single-business Pro user still
  // sees the control — it is how they create their second business.
  if (!canSwitch && !canCreate) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch business"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'var(--s3)', border: '1px solid var(--border)',
          borderRadius: 8, height: 32, minHeight: 32, padding: '0 9px',
          fontSize: 12, fontWeight: 700, color: 'var(--t2)', cursor: 'pointer',
          maxWidth: 150,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeLabel}
        </span>
        <span aria-hidden="true" style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 38, right: 0, minWidth: 200,
            background: 'var(--s2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6, zIndex: 100,
            boxShadow: '0 12px 32px rgba(0,0,0,.5)',
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--t3)',
            padding: '6px 8px 4px',
          }}>
            Your Businesses
          </div>
          {ownedBusinesses.map((bId) => {
            const isActive = bId === activeBusinessId;
            return (
              <button
                key={bId}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) void switchBusiness(bId);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  background: isActive ? 'rgba(200,164,74,0.10)' : 'transparent',
                  border: 'none', borderRadius: 7, padding: '9px 8px',
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--brand-primary)' : 'var(--t1)',
                  cursor: isActive ? 'default' : 'pointer', textAlign: 'left',
                }}
              >
                <span aria-hidden="true" style={{
                  width: 14, flexShrink: 0, color: 'var(--brand-primary)',
                }}>
                  {isActive ? '✓' : ''}
                </span>
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {/* The active business shows its real name; others
                      show a short id-derived label. The full name of
                      a non-active business is not loaded here to keep
                      this component cheap — switching reloads and the
                      Header then shows the real name. */}
                  {isActive ? activeLabel : shortLabel(bId)}
                </span>
              </button>
            );
          })}
          {/* + Add Business — shown when the user's plan allows
              another business (Pro = unlimited). Opens the create
              modal with a tire/mechanic vertical picker. */}
          {canCreate && (
            <button
              type="button"
              onClick={() => { setOpen(false); setShowAddModal(true); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: 'transparent', border: 'none', borderRadius: 7,
                padding: '9px 8px', marginTop: 2, fontSize: 13, fontWeight: 600,
                color: 'var(--brand-primary)', cursor: 'pointer', textAlign: 'left',
                borderTop: '1px solid var(--border)',
              }}
            >
              <span aria-hidden="true" style={{ width: 14, flexShrink: 0, fontWeight: 800 }}>+</span>
              <span>Add Business</span>
            </button>
          )}
        </div>
      )}

      {showAddModal && _auth?.currentUser && (
        <AddBusinessModal
          uid={_auth.currentUser.uid}
          email={_auth.currentUser.email || ''}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

/**
 * A short, human-ish label for a non-active business when its full
 * name is not loaded. Uses a stable suffix of the businessId so each
 * row is distinguishable.
 */
function shortLabel(businessId: string): string {
  const tail = businessId.slice(-4).toUpperCase();
  return `Business ·${tail}`;
}
