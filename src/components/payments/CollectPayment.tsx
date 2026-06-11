// src/components/payments/CollectPayment.tsx
// ═══════════════════════════════════════════════════════════════════
//  The "Collect Payment" flow — the unpaid-job primary action, shared by
//  the job command center (JobDetailModal) and the after-job screen.
//
//  Flow:
//    1. Payment Due badge + a single "Collect Payment" button.
//    2. Tap → choose a method (Card (Zettle) first, then the rest).
//    3. Branch on the method:
//         • Card (Zettle) → NO manual Mark Paid. Show "Take Card Payment"
//           (the Zettle launch → Sync → auto-match → auto-Paid flow).
//         • Cash / Zelle / Venmo / Cash App / Apple Pay / Google Pay /
//           Check / Other → "Mark Paid", storing the chosen method.
//
//  Card payments can ONLY be completed through Zettle — never marked paid
//  by hand — so the recorded method always reflects how money actually
//  moved.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import type { PaymentMethod } from '@/types';
import { money } from '@/lib/utils';
import { ZETTLE_ENABLED } from '@/lib/zettleEnabled';
import { TakePaymentButton } from '@/components/zettle/TakePaymentButton';

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'card', label: ZETTLE_ENABLED ? 'Card (Zettle)' : 'Card' },
  { key: 'cash', label: 'Cash' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'venmo', label: 'Venmo' },
  { key: 'cashapp', label: 'Cash App' },
  { key: 'apple_pay', label: 'Apple Pay' },
  { key: 'google_pay', label: 'Google Pay' },
  { key: 'check', label: 'Check' },
  { key: 'other', label: 'Other' },
];

interface Props {
  businessId: string;
  amount: number | string;
  zettleConnected: boolean;
  /** Owner/admin may trigger the Zettle Sync. */
  canSync: boolean;
  onMarkPaid: (method: PaymentMethod) => void;
}

export function CollectPayment({ businessId, amount, zettleConnected, canSync, onMarkPaid }: Props) {
  const [collecting, setCollecting] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(null);

  if (!collecting) {
    return (
      <div style={wrap}>
        <span style={dueBadge}>Payment Due · {money(amount)}</span>
        <button type="button" className="btn" style={collectBtn} onClick={() => setCollecting(true)}>
          Collect Payment · {money(amount)}
        </button>
      </div>
    );
  }

  // Card routes to Zettle only while the integration is enabled. With the
  // kill switch off, Card behaves like any other manual method (Mark Paid).
  const isCard = ZETTLE_ENABLED && method === 'card';
  return (
    <div style={wrap}>
      <div style={prompt}>How did the customer pay?</div>
      <div style={chipWrap}>
        {METHODS.map((m) => (
          <button
            key={m.key} type="button" aria-pressed={method === m.key}
            onClick={() => setMethod(m.key)} style={chip(method === m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {isCard ? (
        zettleConnected ? (
          // Card → Zettle only. No manual Mark Paid path is rendered.
          <TakePaymentButton
            businessId={businessId} connected={zettleConnected}
            amount={amount} canSync={canSync}
            label="Take Card Payment" startOpen
          />
        ) : (
          <div style={note}>
            Connect PayPal Zettle in Settings to take card payments. Card can't
            be marked paid by hand — pick another method, or connect Zettle.
          </div>
        )
      ) : method ? (
        <button type="button" className="btn" style={paidBtn} onClick={() => onMarkPaid(method)}>
          Mark Paid · {money(amount)}
        </button>
      ) : (
        <div style={note}>Select how the customer paid.</div>
      )}

      <button
        type="button" className="btn-text" style={cancel}
        onClick={() => { setCollecting(false); setMethod(null); }}
      >
        Cancel
      </button>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const dueBadge: React.CSSProperties = {
  alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
  background: 'rgba(245,158,11,.15)', color: 'var(--amber, #d97706)',
};
const collectBtn: React.CSSProperties = {
  width: '100%', fontWeight: 800, color: '#fff',
  background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)', border: 'none',
};
const prompt: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--t2)' };
const chipWrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const chip = (active: boolean): React.CSSProperties => ({
  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 600, cursor: 'pointer',
  background: active ? 'rgba(34,197,94,.10)' : 'var(--s3, #f4f4f4)',
  border: active ? '1px solid var(--green)' : '1px solid var(--border, #e2e2e2)',
  color: active ? 'var(--green)' : 'var(--t2)',
});
const paidBtn: React.CSSProperties = {
  width: '100%', fontWeight: 800, color: '#fff',
  background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)', border: 'none',
};
const note: React.CSSProperties = { fontSize: 12, color: 'var(--t3)', lineHeight: 1.4 };
const cancel: React.CSSProperties = { alignSelf: 'center', fontSize: 12, color: 'var(--t3)' };
