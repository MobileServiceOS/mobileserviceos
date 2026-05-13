import { useEffect } from 'react';
import { upgradeRequiredCopy } from '@/lib/planAccess';

// ─────────────────────────────────────────────────────────────────────
//  UpgradeModal — surfaced when a Core user attempts a Pro-gated
//  action. Uses the canonical copy from planAccess.upgradeRequiredCopy
//  so the message stays consistent everywhere the prompt appears.
//
//  Usage:
//    const [showUpgrade, setShowUpgrade] = useState(false);
//    ...
//    <button onClick={() => {
//      if (!canAccessFeature(settings, 'teamInventoryWorkflow')) {
//        setShowUpgrade(true);
//        return;
//      }
//      // …feature-allowed path…
//    }}>
//
//    {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
//
//  Caller can override the body copy when a more specific message
//  fits the context (e.g. "Add technicians" vs the generic body), but
//  the headline and CTA stay fixed.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user dismisses the modal (backdrop click, X, or
   *  Cancel). Caller is responsible for hiding the modal in state. */
  onClose: () => void;
  /** Called when the user taps the CTA. Today this is a placeholder
   *  (Stripe wiring lives in a later batch); the recommended behavior
   *  is to route the user to Settings → Subscription. If omitted, the
   *  modal closes when the CTA is tapped. */
  onUpgrade?: () => void;
  /** Optional override for the body copy. Falls back to the canonical
   *  message when not provided. */
  body?: string;
}

export function UpgradeModal({ onClose, onUpgrade, body }: Props) {
  // Lock background scroll while the modal is mounted. iOS Safari
  // otherwise lets the underlying page scroll, which can drag the
  // modal off-screen.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC key dismisses. Keyboard accessibility for the (rare) PWA user
  // who has a Bluetooth keyboard attached.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCta = () => {
    if (onUpgrade) onUpgrade();
    else onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
      >
        {/* Premium gold accent strip — same visual language as the
            invoice header so the upgrade prompt feels on-brand. */}
        <div style={{
          height: 3,
          background: 'linear-gradient(90deg, var(--brand-primary), var(--brand-accent))',
          margin: '-18px -18px 16px -18px',
          borderRadius: '14px 14px 0 0',
        }} />

        <div style={{
          fontSize: 10, fontWeight: 800,
          color: 'var(--brand-primary)',
          textTransform: 'uppercase', letterSpacing: 1.5,
          marginBottom: 6,
        }}>
          Pro Feature
        </div>

        <div
          id="upgrade-modal-title"
          className="modal-title"
          style={{ fontSize: 20, marginBottom: 8 }}
        >
          {upgradeRequiredCopy.headline}
        </div>

        <div className="modal-sub" style={{ marginBottom: 18, lineHeight: 1.55 }}>
          {body || upgradeRequiredCopy.body}
        </div>

        <div style={{
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '10px 12px',
          marginBottom: 16,
          fontSize: 12,
          color: 'var(--t2)',
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
            Pro Plan · $99 / month
          </div>
          14-day free trial · Team management, advanced analytics, technician
          accounts, and dispatch workflow included.
        </div>

        <div className="modal-actions">
          <button
            className="btn secondary"
            onClick={onClose}
            type="button"
          >
            Not now
          </button>
          <button
            className="btn primary"
            onClick={handleCta}
            type="button"
          >
            {upgradeRequiredCopy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpgradeModal;
