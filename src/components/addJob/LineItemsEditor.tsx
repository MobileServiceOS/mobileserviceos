import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { JobLineItem } from '@/types';
import { money } from '@/lib/utils';

// ───────────────────────────────────────────────────────────────────
//  Itemized price breakdown editor — the data behind a Type B
//  (itemized) invoice / estimate. Each row is a customer-facing line:
//  description + qty + unit price → amount. Leaving it empty produces a
//  Type A (total-only) document. These are PRICES the customer pays, not
//  internal costs.
// ───────────────────────────────────────────────────────────────────

const cell: CSSProperties = {
  padding: '9px 8px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--s1)', color: 'var(--t1)', fontSize: 13, minWidth: 0, width: '100%',
};

// Numeric cell with a local text buffer so the field can be cleared, or hold
// a trailing "." mid-edit, without the numeric model snapping it back to 0.
// type="text" + inputMode keeps the mobile numeric keypad while allowing an
// empty value — a plain type="number" forces 0 the instant you clear it,
// which made typing over the default 0 (or entering cents) fiddly.
function NumCell({ value, onCommit, style, placeholder, ariaLabel, decimal }: {
  value: number;
  onCommit: (n: number) => void;
  style: CSSProperties;
  placeholder: string;
  ariaLabel: string;
  decimal?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const focused = useRef(false);

  // Re-sync from the model when it changes externally (row reset, line-sum
  // mirror, etc.) — but never while the user is actively typing.
  useEffect(() => {
    if (!focused.current) setText(value ? String(value) : '');
  }, [value]);

  return (
    <input
      style={style}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        let clean: string;
        if (decimal) {
          clean = e.target.value.replace(/[^\d.]/g, '');
          const dot = clean.indexOf('.');
          if (dot !== -1) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
        } else {
          clean = e.target.value.replace(/\D/g, '');
        }
        setText(clean);
        onCommit(Math.max(0, Number(clean) || 0));
      }}
      onBlur={() => {
        focused.current = false;
        const n = Math.max(0, Number(text) || 0);
        setText(n ? String(n) : '');
        onCommit(n);
      }}
    />
  );
}

export function LineItemsEditor({ items, onChange }: {
  items: JobLineItem[];
  onChange: (next: JobLineItem[]) => void;
}) {
  const rows = Array.isArray(items) ? items : [];
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);

  const update = (i: number, patch: Partial<JobLineItem>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { description: '', qty: 1, unitPrice: 0 }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="field">
      <label>
        Itemized breakdown
        <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>
          · optional · Type B invoice / estimate
        </span>
      </label>

      {rows.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.45, marginBottom: 8 }}>
          Add lines (Tire, Mobile labor, Mount &amp; Balance, Disposal…) to send an itemized invoice or estimate.
          Leave empty to send a total-only one. Lines total automatically and set the price.
        </div>
      )}

      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input
            style={{ ...cell, flex: '3 1 0' }}
            placeholder="Description (e.g. Mobile labor)"
            value={r.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <NumCell
            style={{ ...cell, flex: '0 0 48px', textAlign: 'center' }}
            placeholder="Qty"
            value={r.qty}
            onCommit={(n) => update(i, { qty: n })}
            ariaLabel={`Quantity for line ${i + 1}`}
          />
          <NumCell
            style={{ ...cell, flex: '0 0 72px', textAlign: 'right' }}
            placeholder="Unit $"
            decimal
            value={r.unitPrice}
            onCommit={(n) => update(i, { unitPrice: n })}
            ariaLabel={`Unit price for line ${i + 1}`}
          />
          <span style={{ flex: '0 0 64px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
            {money((Number(r.qty) || 0) * (Number(r.unitPrice) || 0))}
          </span>
          <button
            type="button" aria-label={`Remove line ${i + 1}`} onClick={() => remove(i)}
            style={{
              flex: '0 0 28px', height: 28, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--s2)', color: 'var(--t3)', cursor: 'pointer', fontSize: 15, lineHeight: 1,
            }}
          >×</button>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <button type="button" className="btn xs secondary" onClick={add}>＋ Add line item</button>
        {rows.length > 0 && (
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--t1)' }}>Total {money(total)}</span>
        )}
      </div>
    </div>
  );
}
