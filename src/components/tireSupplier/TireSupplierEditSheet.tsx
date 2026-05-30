import { useEffect, useState } from 'react';
import type {
  TireSupplierPrice,
  TireSupplierName,
  TireCategory,
  TireCondition,
} from '@/lib/tireQuoteTypes';
import { DEFAULT_SUPPLIER_NAMES } from '@/lib/tireQuoteTypes';

// ─────────────────────────────────────────────────────────────────────
//  src/components/tireSupplier/TireSupplierEditSheet.tsx
//
//  Bottom-sheet modal for adding or editing one supplier tire price.
//  Mirrors the MoreSheet/QuickExpenseSheet patterns: full-viewport
//  overlay, body-scroll lock, Escape closes, backdrop click closes.
//
//  Phase 2 of the Tire Quote Engine. Owner/admin only — gated by
//  the caller (TireSupplierDatabase page is itself permission-gated).
//
//  Form fields (10 user-listed + supplier name + category = 12):
//    - supplierName (default 5 + free-form custom)
//    - tireSize
//    - brand
//    - model
//    - cost           (wholesale, owner/admin only)
//    - quantityAvailable
//    - condition      (new / used)
//    - treadDepth     (used tires only)
//    - category       (budget / midrange / premium)
//    - runFlat
//    - evRated
//    - xlLoad
//    - speedRating    (optional)
//    - loadIndex      (optional)
//    - notes          (optional)
// ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Existing tire to edit, or null for "Add new" mode. */
  initial: TireSupplierPrice | null;
  onSave: (next: TireSupplierPrice) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

const CATEGORIES: TireCategory[] = ['budget', 'midrange', 'premium'];
const CONDITIONS: TireCondition[] = ['new', 'used'];

function emptyDraft(): Omit<TireSupplierPrice, 'id' | 'lastUpdated' | 'createdBy'> {
  return {
    supplierName: 'ATD',
    tireSize: '',
    brand: '',
    model: '',
    cost: 0,
    quantityAvailable: 0,
    condition: 'new',
    category: 'midrange',
    runFlat: false,
    evRated: false,
    xlLoad: false,
    treadDepth: undefined,
    speedRating: undefined,
    loadIndex: undefined,
    notes: undefined,
  };
}

export function TireSupplierEditSheet({ initial, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(() =>
    initial ? { ...initial } : emptyDraft(),
  );
  const [busy, setBusy] = useState(false);
  const [showCustomSupplier, setShowCustomSupplier] = useState(() =>
    initial ? !DEFAULT_SUPPLIER_NAMES.includes(initial.supplierName as never) : false,
  );

  // Lock body scroll + close on Escape — matches MoreSheet pattern.
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

  const update = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const isValid =
    !!draft.tireSize.trim() &&
    !!draft.brand.trim() &&
    !!draft.model.trim() &&
    !!draft.supplierName.toString().trim() &&
    draft.cost >= 0 &&
    draft.quantityAvailable >= 0;

  const handleSave = async () => {
    if (!isValid || busy) return;
    setBusy(true);
    try {
      const next: TireSupplierPrice = {
        ...(initial ?? { id: '', lastUpdated: '', createdBy: '' }),
        ...draft,
        // id / lastUpdated / createdBy stamped by the caller — keep
        // initial's values when editing, blank strings when adding.
      };
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || busy) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${draft.brand} ${draft.model}"? This can't be undone.`)) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
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
          maxHeight: '90vh', overflowY: 'auto',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--t3)',
          borderRadius: 4, margin: '2px auto 14px', opacity: 0.5,
        }} />
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>
          {initial ? 'Edit Supplier Tire' : 'Add Supplier Tire'}
        </div>

        {/* Supplier name — default 5 + custom */}
        <Field label="Supplier *">
          {showCustomSupplier ? (
            <input
              type="text"
              value={String(draft.supplierName)}
              onChange={(e) => update('supplierName', e.target.value as TireSupplierName)}
              placeholder="Custom supplier name"
              style={inputStyle}
            />
          ) : (
            <select
              value={String(draft.supplierName)}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setShowCustomSupplier(true);
                  update('supplierName', '' as TireSupplierName);
                } else {
                  update('supplierName', e.target.value as TireSupplierName);
                }
              }}
              style={inputStyle}
            >
              {DEFAULT_SUPPLIER_NAMES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="__custom__">+ Custom supplier…</option>
            </select>
          )}
        </Field>

        {/* Tire size + brand + model */}
        <Field label="Tire size *">
          <input
            type="text"
            value={draft.tireSize}
            onChange={(e) => update('tireSize', e.target.value)}
            placeholder="225/65R17"
            style={inputStyle}
          />
        </Field>
        <Field label="Brand *">
          <input
            type="text"
            value={draft.brand}
            onChange={(e) => update('brand', e.target.value)}
            placeholder="Michelin"
            style={inputStyle}
          />
        </Field>
        <Field label="Model *">
          <input
            type="text"
            value={draft.model}
            onChange={(e) => update('model', e.target.value)}
            placeholder="Defender 2"
            style={inputStyle}
          />
        </Field>

        {/* Cost + quantity */}
        <Row>
          <Field label="Cost per tire ($) *">
            <input
              type="number"
              inputMode="decimal"
              value={draft.cost}
              onChange={(e) => update('cost', Number(e.target.value) || 0)}
              style={inputStyle}
            />
          </Field>
          <Field label="Quantity *">
            <input
              type="number"
              inputMode="numeric"
              value={draft.quantityAvailable}
              onChange={(e) => update('quantityAvailable', Number(e.target.value) || 0)}
              style={inputStyle}
            />
          </Field>
        </Row>

        {/* Condition + category */}
        <Row>
          <Field label="Condition *">
            <select
              value={draft.condition}
              onChange={(e) => update('condition', e.target.value as TireCondition)}
              style={inputStyle}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c === 'new' ? 'New' : 'Used'}</option>
              ))}
            </select>
          </Field>
          <Field label="Category *">
            <select
              value={draft.category}
              onChange={(e) => update('category', e.target.value as TireCategory)}
              style={inputStyle}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c === 'budget' ? 'Budget (Good)' :
                   c === 'midrange' ? 'Midrange (Better)' : 'Premium (Best)'}
                </option>
              ))}
            </select>
          </Field>
        </Row>

        {draft.condition === 'used' && (
          <Field label="Tread depth (/32 in.)">
            <input
              type="number"
              inputMode="numeric"
              value={draft.treadDepth ?? ''}
              onChange={(e) => update('treadDepth', Number(e.target.value) || undefined)}
              placeholder="e.g. 8"
              style={inputStyle}
            />
          </Field>
        )}

        {/* Tire flags — 3 toggles */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <Toggle label="Run-flat" value={draft.runFlat}
            onChange={(v) => update('runFlat', v)} />
          <Toggle label="EV-rated" value={draft.evRated}
            onChange={(v) => update('evRated', v)} />
          <Toggle label="XL load" value={draft.xlLoad}
            onChange={(v) => update('xlLoad', v)} />
        </div>

        {/* Optional fields */}
        <Row>
          <Field label="Speed rating">
            <input
              type="text"
              value={draft.speedRating ?? ''}
              onChange={(e) => update('speedRating', e.target.value || undefined)}
              placeholder="H / V / W"
              style={inputStyle}
            />
          </Field>
          <Field label="Load index">
            <input
              type="text"
              value={draft.loadIndex ?? ''}
              onChange={(e) => update('loadIndex', e.target.value || undefined)}
              placeholder="95"
              style={inputStyle}
            />
          </Field>
        </Row>

        <Field label="Notes (operator-only)">
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => update('notes', e.target.value || undefined)}
            placeholder="Lead time, MOQ, contact, internal notes"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={!isValid || busy}
            style={{ flex: 2 }}
          >
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Add tire'}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={busy}
            style={{ flex: 1 }}
          >
            Cancel
          </button>
        </div>
        {onDelete && initial && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            style={{
              marginTop: 10, width: '100%',
              padding: '10px',
              background: 'transparent',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 8,
              color: 'var(--red, #ef4444)',
              fontSize: 12, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            Delete this tire
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ───────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--s2)',
  color: 'var(--t1)',
  fontSize: 14,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
