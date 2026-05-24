import { useState } from 'react';
import type { Expense, ExpenseCategory } from '@/types';
import { EXPENSE_CATEGORY_LABELS } from '@/types';
import { uid } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';

// ─────────────────────────────────────────────────────────────────────
//  QuickExpenseSheet — the Phase-4 mobile-first one-tap logger.
//
//  Designed for log-from-the-truck workflows: tap a category chip,
//  type an amount, tap Save. Two taps + one number. Optional Vendor
//  field is collapsed by default so it doesn't slow down the typical
//  "I just paid $52 at Shell" entry.
//
//  Distinct from the full ExpenseSheet in Expenses.tsx — that one
//  surfaces every Phase-1 field (type, date, payment method, job
//  link, recurring toggle, notes). The quick sheet is intentionally
//  stripped down for the high-frequency path the spec calls out:
//      Gas · Tolls · Tire purchase · Tools · Supplies · Other
//
//  Anything saved here lands in the same expense collection and shows
//  up in the full Expenses page immediately. The user can refine the
//  vendor / payment method / notes later from there if they want.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  onSave: (expense: Expense) => void;
  onClose: () => void;
  /** Full Expenses-page entry — passed so the sheet can offer a
   *  "More options" escape hatch that routes there for fields the
   *  quick sheet intentionally omits. */
  onOpenFullExpenses?: () => void;
}

/** Quick-log category set per the Phase-4 spec, in tap-frequency
 *  order. Each maps to a full ExpenseCategory. */
const QUICK: { id: ExpenseCategory; label: string }[] = [
  { id: 'gas',           label: 'Gas' },
  { id: 'tolls',         label: 'Tolls' },
  { id: 'tire_purchase', label: 'Tire Purchase' },
  { id: 'tools',         label: 'Tools' },
  { id: 'supplies',      label: 'Supplies' },
  { id: 'other',         label: 'Other' },
];

export function QuickExpenseSheet({ onSave, onClose, onOpenFullExpenses }: Props) {
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [vendorOpen, setVendorOpen] = useState(false);

  const canSave = category && Number(amount) > 0;

  const handleSave = () => {
    if (!canSave) return;
    const expense: Expense = {
      id: uid(),
      name: EXPENSE_CATEGORY_LABELS[category],
      amount: Number(amount),
      active: true,
      category,
      type: 'one_time',
      date: TODAY(),
      vendor: vendor.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    onSave(expense);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)', zIndex: 9000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card-anim"
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--s1)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
          maxHeight: '85vh', overflowY: 'auto',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--t3)',
          borderRadius: 4, margin: '2px auto 14px', opacity: 0.5,
        }} />
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', marginBottom: 8,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Quick log expense</div>
          <div style={{ fontSize: 11, color: 'var(--t3)' }}>
            Today · One-time
          </div>
        </div>

        {/* Category picker — 6 spec-mandated quick options */}
        <div className="field">
          <label>Category</label>
          <div className="chip-grid">
            {QUICK.map((c) => (
              <button
                key={c.id} type="button"
                className={'chip' + (category === c.id ? ' active' : '')}
                onClick={() => setCategory(c.id)}
                style={{ minHeight: 44 }}  /* mobile tap target */
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amount — autofocus once a category is picked */}
        <div className="field">
          <label>Amount $</label>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            autoFocus={!!category}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSave) handleSave(); }}
            style={{ fontSize: 18, fontWeight: 700 }}
          />
        </div>

        {/* Vendor — collapsed by default, one-tap to expand */}
        {!vendorOpen ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => setVendorOpen(true)}
            style={{
              width: '100%', fontSize: 11, color: 'var(--t3)',
              padding: '6px 0', marginTop: -4,
            }}
          >
            + Add vendor (optional)
          </button>
        ) : (
          <div className="field">
            <label>Vendor</label>
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Shell, Discount Tire, Home Depot…"
            />
          </div>
        )}

        {/* Save row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            style={{ flex: 1 }}
          >Cancel</button>
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={!canSave}
            style={{ flex: 2 }}
          >
            {canSave ? `Log $${Number(amount).toFixed(2)} ${EXPENSE_CATEGORY_LABELS[category]}` : 'Pick category + amount'}
          </button>
        </div>

        {/* Escape hatch to the full expense form */}
        {onOpenFullExpenses && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => { onClose(); onOpenFullExpenses(); }}
            style={{
              width: '100%', marginTop: 10, fontSize: 12,
              color: 'var(--t3)',
            }}
          >
            More options (vendor, payment method, notes, recurring…)
          </button>
        )}
      </div>
    </div>
  );
}
