import { useState } from 'react';
import type { PaymentMethod } from '@/types';

interface Props {
  /** Suggested amount to collect — shown in the sheet header for context. */
  amountDue: number;
  /** Called when the user picks a method. Parent should run the Firestore
   *  write and any toasts; this component closes itself via `onClose`. */
  onConfirm: (method: PaymentMethod) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Method options shown in the sheet.
 *
 * `method` is the CANONICAL STORED VALUE — lowercase identifier from the
 * PaymentMethod union in `@/types`. This is what gets written to
 * Firestore and used in queries/filters across the app.
 *
 * `label` is the user-facing display text. Independent from `method` on
 * purpose: storage stays stable across UI changes, and the same canonical
 * value can be re-labeled per locale or per business without changing
 * the schema.
 */
const METHODS: { method: PaymentMethod; icon: string; label: string; sublabel: string }[] = [
  { method: 'cash',    icon: '💵', label: 'Cash',     sublabel: 'In-hand right now' },
  { method: 'zelle',   icon: '⚡', label: 'Zelle',    sublabel: 'Bank transfer' },
  { method: 'cashapp', icon: '$',  label: 'Cash App', sublabel: 'Cashtag' },
  { method: 'venmo',   icon: 'V',  label: 'Venmo',    sublabel: 'Username transfer' },
  { method: 'card',    icon: '💳', label: 'Card',     sublabel: 'Reader or invoice' },
  { method: 'check',   icon: '🧾', label: 'Check',    sublabel: 'Paper check' },
  { method: 'other',   icon: '⋯',  label: 'Other',    sublabel: 'Anything else' },
];

/**
 * Bottom-sheet payment method picker.
 *
 * Designed for one-thumb roadside use: large tap targets (56px+ each),
 * single column, action-first labels. The user opens this from any
 * "Mark Paid" CTA across the app — one tap to open, one tap to pick a
 * method, sheet closes, job is written.
 *
 * Why a bottom sheet vs a dropdown:
 *   - Reachable with thumb while holding the phone one-handed
 *   - Bigger targets (each row ~64px tall vs ~32px for a dropdown option)
 *   - Familiar pattern from Apple Wallet, Venmo, etc.
 */
export function PaymentMethodSheet({ amountDue, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState<PaymentMethod | null>(null);

  const pick = async (method: PaymentMethod) => {
    if (busy) return;
    setBusy(method);
    try {
      await onConfirm(method);
      onClose();
    } catch {
      // Parent shows the error toast. Reset busy so the user can retry.
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Collect payment">
      <div
        className="payment-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--border)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          marginTop: 'auto',
          marginBottom: 0,
          padding: '18px 16px max(20px, var(--safe-bot))',
          boxShadow: '0 -12px 36px rgba(0,0,0,.5)',
        }}
      >
        {/* Sheet handle for visual affordance */}
        <div style={{
          width: 44, height: 4, borderRadius: 99,
          background: 'var(--border2)', margin: '0 auto 14px',
        }} />

        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--t3)',
          textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4,
        }}>
          Collect payment
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--t1)' }}>
            ${amountDue.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>balance due</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {METHODS.map(({ method, icon, label, sublabel }) => (
            <button
              key={method}
              onClick={() => void pick(method)}
              disabled={busy !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px',
                background: busy === method ? 'rgba(34,197,94,.12)' : 'var(--s2)',
                border: '1px solid ' + (busy === method ? 'rgba(34,197,94,.35)' : 'var(--border)'),
                borderRadius: 14, cursor: busy ? 'wait' : 'pointer',
                color: 'var(--t1)', textAlign: 'left', width: '100%',
                opacity: busy && busy !== method ? 0.4 : 1,
                transition: 'opacity .15s ease, background .15s ease',
                minHeight: 56,
              }}
            >
              <span style={{
                fontSize: 22, width: 36, height: 36, borderRadius: 10,
                background: 'var(--s3)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{sublabel}</div>
              </span>
              {busy === method && (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
                  Saving…
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          disabled={busy !== null}
          style={{
            width: '100%', marginTop: 12, padding: '12px',
            background: 'transparent', border: 'none', color: 'var(--t3)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
