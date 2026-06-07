import { useEffect } from 'react';
import type { TabId } from '@/types';
import { usePermissions } from '@/context/MembershipContext';
import { useFocusTrap } from '@/lib/useFocusTrap';

// ─────────────────────────────────────────────────────────────────────
//  MoreSheet — bottom-anchored menu opened from the "More" nav button.
//
//  Exposes the secondary tabs that aren't in the primary bottom-nav:
//
//    - Payouts     (owner/admin only — shows distributable + week history)
//    - Expenses    (owner/admin only — monthly recurring + one-offs)
//    - Customers   (owner/admin/technician — same data, different framing)
//    - Settings    (always shown; internal accordions gate themselves)
//
//  Permissions:
//    canManageBilling  — gates Payouts (financial split)
//    canViewFinancials — gates Expenses (company costs)
//
//  Both default to false for technicians, so a technician opening this
//  sheet sees only Customers + Settings. Owners see all four.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onPick: (t: TabId) => void;
}

interface Item {
  id: TabId;
  label: string;
  icon: string;
  hint: string;
  visible: boolean;
}

export function MoreSheet({ onClose, onPick }: Props) {
  const permissions = usePermissions();
  // Audit a11y P1-4 (2026-05-31): trap focus inside the sheet so AT
  // users can't Tab back into the (visually obscured) nav below. The
  // hook also focuses the first interactive element on mount and
  // returns focus to the "More" button on close. The sheet is always
  // open while this component renders, so we pass `true`.
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  // Lock body scroll while open + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const items: Item[] = [
    // Bandilero is no longer a More entry — it IS Home (the Command
    // Center) for Pro businesses. Inventory returned to the primary
    // bottom-nav in the V2 reorder, so it's not duplicated here either.
    {
      id: 'payouts',
      label: 'Payouts',
      icon: '💰',
      hint: 'Weekly distributable · owner splits · 8-week history',
      visible: permissions.canManageBilling,
    },
    {
      id: 'expenses',
      label: 'Expenses',
      icon: '📊',
      hint: 'Monthly recurring · one-off costs · net profit',
      visible: permissions.canViewFinancials,
    },
    {
      id: 'insights',
      label: 'Insights',
      icon: '📈',
      hint: 'Revenue trend · top services · profit by city · unpaid aging',
      visible: permissions.canViewFinancials,
    },
    {
      id: 'help',
      label: 'Help & FAQ',
      icon: '❓',
      hint: 'Common questions · contact support',
      visible: true,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '⚙️',
      hint: 'Account · branding · business config',
      visible: true,
    },
  ];

  return (
    <div
      className="more-sheet-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 9000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        ref={trapRef}
        tabIndex={-1}
        className="more-sheet card-anim"
        aria-modal="true"
        role="dialog"
        aria-label="More options"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--s1)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
          maxHeight: '70vh', overflowY: 'auto',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--t3)',
          borderRadius: 4, margin: '2px auto 14px', opacity: 0.5,
        }} />
        <div style={{
          fontSize: 11, fontWeight: 800,
          color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.5,
          marginBottom: 10, paddingLeft: 4,
        }}>
          More
        </div>
        {items.filter((i) => i.visible).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              width: '100%', textAlign: 'left',
              padding: '14px 12px', marginBottom: 8,
              background: 'var(--s2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              color: 'var(--t1)',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 22 }}>{item.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
                {item.label}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', lineHeight: 1.4 }}>
                {item.hint}
              </span>
            </span>
            <span style={{ fontSize: 18, color: 'var(--t3)' }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
