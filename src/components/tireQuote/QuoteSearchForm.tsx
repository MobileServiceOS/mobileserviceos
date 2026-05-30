import { useState } from 'react';
import type { Urgency, QuoteServiceType } from '@/lib/tireQuoteTypes';

// ─────────────────────────────────────────────────────────────────────
//  src/components/tireQuote/QuoteSearchForm.tsx
//
//  Form inputs for the Tire Quote Engine's search. Phase 3 implements
//  size + brand + model + qty + customer info. The tagged-union
//  QuoteSearchInput from Phase 1 leaves VIN / photo / vehicle / plate
//  as future-ready variants — only the size+brand+model branch is
//  exposed in this form for now.
//
//  Mobile-first: every input is full-width on phones, two columns
//  on tablets. Pricing-affecting fields (urgency, miles) are grouped
//  together so the owner/admin can scan them as a unit.
// ─────────────────────────────────────────────────────────────────────

export interface QuoteSearchFormValue {
  tireSize: string;
  brand: string;
  model: string;
  quantity: number;
  customerCity: string;
  customerZip: string;
  miles: number;
  serviceType: QuoteServiceType;
  urgency: Urgency;
  customerName: string;
  customerPhone: string;
}

export const EMPTY_QUOTE_FORM: QuoteSearchFormValue = {
  tireSize: '',
  brand: '',
  model: '',
  quantity: 4,
  customerCity: '',
  customerZip: '',
  miles: 0,
  serviceType: 'replacement',
  urgency: 'standard',
  customerName: '',
  customerPhone: '',
};

interface Props {
  value: QuoteSearchFormValue;
  onChange: (next: QuoteSearchFormValue) => void;
  onSearch: () => void;
  busy?: boolean;
}

const SERVICE_TYPES: { v: QuoteServiceType; l: string }[] = [
  { v: 'replacement', l: 'Replacement' },
  { v: 'new_tire', l: 'New tire' },
  { v: 'used_tire', l: 'Used tire' },
  { v: 'emergency_replacement', l: 'Emergency' },
];

const URGENCIES: { v: Urgency; l: string }[] = [
  { v: 'standard', l: 'Standard' },
  { v: 'same-day', l: 'Same-day (+fee)' },
  { v: 'emergency', l: 'Emergency (+fee)' },
  { v: 'after-hours', l: 'After hours (+fee)' },
];

export function QuoteSearchForm({ value, onChange, onSearch, busy }: Props) {
  const [showCustomer, setShowCustomer] = useState(false);

  const update = <K extends keyof QuoteSearchFormValue>(k: K, v: QuoteSearchFormValue[K]) => {
    onChange({ ...value, [k]: v });
  };

  // Search is enabled when we have ENOUGH to look up — either size,
  // or both brand + model. Anything less and the results would be
  // unbounded.
  const canSearch =
    value.tireSize.trim().length > 0 ||
    (value.brand.trim().length > 0 && value.model.trim().length > 0);

  return (
    <div className="card card-anim" style={{
      background: 'var(--s1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    }}>
      {/* Tire identification — primary search inputs */}
      <Field label="Tire size">
        <input
          type="text"
          value={value.tireSize}
          onChange={(e) => update('tireSize', e.target.value)}
          placeholder="225/65R17"
          style={inputStyle}
        />
      </Field>

      <Row>
        <Field label="Brand">
          <input
            type="text"
            value={value.brand}
            onChange={(e) => update('brand', e.target.value)}
            placeholder="Michelin"
            style={inputStyle}
          />
        </Field>
        <Field label="Model">
          <input
            type="text"
            value={value.model}
            onChange={(e) => update('model', e.target.value)}
            placeholder="Defender 2"
            style={inputStyle}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Quantity">
          <input
            type="number"
            inputMode="numeric"
            value={value.quantity}
            onChange={(e) => update('quantity', Math.max(1, Number(e.target.value) || 1))}
            min={1}
            style={inputStyle}
          />
        </Field>
        <Field label="Distance (miles)">
          <input
            type="number"
            inputMode="numeric"
            value={value.miles}
            onChange={(e) => update('miles', Math.max(0, Number(e.target.value) || 0))}
            min={0}
            placeholder="0"
            style={inputStyle}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Service type">
          <select
            value={value.serviceType}
            onChange={(e) => update('serviceType', e.target.value as QuoteServiceType)}
            style={inputStyle}
          >
            {SERVICE_TYPES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </Field>
        <Field label="Urgency">
          <select
            value={value.urgency}
            onChange={(e) => update('urgency', e.target.value as Urgency)}
            style={inputStyle}
          >
            {URGENCIES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
          </select>
        </Field>
      </Row>

      {/* Customer info — collapsible because not always required for
          a quote. Operators can build pricing without a customer on
          file (walk-up, phone call). */}
      <button
        type="button"
        onClick={() => setShowCustomer((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--t3)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          padding: '8px 0',
          textAlign: 'left',
        }}
      >
        {showCustomer ? '▾' : '▸'} Customer info (optional)
      </button>

      {showCustomer && (
        <>
          <Row>
            <Field label="Customer name">
              <input
                type="text"
                value={value.customerName}
                onChange={(e) => update('customerName', e.target.value)}
                placeholder="Serge"
                style={inputStyle}
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                inputMode="tel"
                value={value.customerPhone}
                onChange={(e) => update('customerPhone', e.target.value)}
                placeholder="(305) 555-1234"
                style={inputStyle}
              />
            </Field>
          </Row>
          <Row>
            <Field label="City">
              <input
                type="text"
                value={value.customerCity}
                onChange={(e) => update('customerCity', e.target.value)}
                placeholder="Aventura"
                style={inputStyle}
              />
            </Field>
            <Field label="ZIP">
              <input
                type="text"
                inputMode="numeric"
                value={value.customerZip}
                onChange={(e) => update('customerZip', e.target.value)}
                placeholder="33160"
                style={inputStyle}
              />
            </Field>
          </Row>
        </>
      )}

      <button
        type="button"
        className="btn primary"
        onClick={onSearch}
        disabled={!canSearch || busy}
        style={{ width: '100%', marginTop: 10 }}
      >
        {busy ? 'Searching…' : 'Search Tire Options'}
      </button>
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
