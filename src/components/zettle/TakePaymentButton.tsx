// src/components/zettle/TakePaymentButton.tsx
// ═══════════════════════════════════════════════════════════════════
//  "Take Payment with Zettle" — the in-job collect flow.
//
//  Two steps, because Zettle is card-present (no remote charge API):
//    1. Open Zettle Go and charge the customer.
//    2. Sync — pulls the purchase in; the server matcher auto-marks the
//       job Paid when the amount matches.
//
//  Role split:
//    • Everyone (when connected) sees step 1 — taking a payment in the
//      Zettle app is a field action.
//    • Only owner/admin (canSync) sees step 2 — importZettlePayments is
//      owner/admin-only on the server. For a technician, the owner's
//      later Sync (or the real-time webhook) marks the job Paid.
//  No sensitive payment data is shown here — only counts come back.
// ═══════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import { openZettle, syncZettlePayments, type ZettleImportResult } from '@/lib/zettleTakePayment';

interface Props {
  businessId: string;
  /** settings.zettleConnected — render nothing when Zettle isn't connected. */
  connected: boolean;
  /** Job revenue, shown so the operator charges the right amount. */
  amount: number | string;
  /** Owner/admin may trigger Sync (importZettlePayments is owner/admin-only). */
  canSync: boolean;
  /** Fired after a successful sync so the parent can refresh the job. */
  onSynced?: (result: ZettleImportResult) => void;
  /** Collapsed-button label. Defaults to "Take Payment with Zettle";
   *  the card-method branch passes "Take Card Payment". */
  label?: string;
  /** Start expanded (the operator already chose Card → skip the collapse). */
  startOpen?: boolean;
}

function fmtMoney(v: number | string): string {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(v);
}

export function TakePaymentButton({ businessId, connected, amount, canSync, onSynced, label = 'Take Payment with Zettle', startOpen = false }: Props) {
  const [open, setOpen] = useState(startOpen);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<ZettleImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const r = await syncZettlePayments(businessId, '30');
      setResult(r);
      onSynced?.(r);
    } catch (e) {
      setError((e as Error).message || 'Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
  }, [businessId, onSynced]);

  if (!connected) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="btn"
        style={btnZettle}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden style={{ fontSize: 16 }}>💳</span>
        {label}
      </button>
    );
  }

  return (
    <div style={panel}>
      {/* Step 1 — open Zettle (valid https; never a Safari error) */}
      <Step n={1} title={`Open Zettle and charge ${fmtMoney(amount)}`}>
        <button type="button" className="btn" style={btnLine} onClick={openZettle}>
          Open Zettle
        </button>
      </Step>

      {/* Step 2 — collect in Zettle */}
      <Step n={2} title="Collect the payment in Zettle" />

      {/* Step 3 — back to MSOS */}
      <Step n={3} title="Return to MSOS" />

      {/* Step 4 — sync (owner/admin only); 5+6 happen automatically */}
      {canSync ? (
        <Step n={4} title="Sync Zettle Payments">
          <button type="button" className="btn" style={btnLine} disabled={syncing} onClick={onSync}>
            {syncing ? 'Syncing…' : 'Sync Zettle Payments'}
          </button>
          <div style={hint}>The payment auto-matches to this job and marks it Paid.</div>
          {result && (
            <div style={{ ...hint, color: 'var(--brand-primary)' }}>
              Synced · {result.imported} imported · {result.matched} matched · {result.review} need review.
            </div>
          )}
          {error && <div style={{ ...hint, color: 'var(--danger, #c0392b)' }}>{error}</div>}
        </Step>
      ) : (
        <div style={hint}>
          After you collect in Zettle, the owner's next Sync (or the real-time
          feed) matches it to this job and marks it Paid automatically.
        </div>
      )}

      <button type="button" className="btn-text" style={dismiss} onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div style={step}>
      <div style={stepNum}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={stepTitle}>{title}</div>
        {children}
      </div>
    </div>
  );
}

// ── styles (inline; matches the modal's lightweight component idiom) ──
const btnZettle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  width: '100%', fontWeight: 600,
};
const panel: React.CSSProperties = {
  border: '1px solid var(--border, #e2e2e2)', borderRadius: 10, padding: 12,
  display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface-2, #fafafa)',
};
const step: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start' };
const stepNum: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 11, flexShrink: 0,
  background: 'var(--brand-primary)', color: '#fff', fontSize: 12, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const stepTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 6 };
const btnLine: React.CSSProperties = { width: '100%' };
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--t3)', marginTop: 6, lineHeight: 1.4 };
const dismiss: React.CSSProperties = { alignSelf: 'center', fontSize: 12, color: 'var(--t3)' };
