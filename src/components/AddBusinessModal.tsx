// ═══════════════════════════════════════════════════════════════════
//  src/components/AddBusinessModal.tsx — Add-business UI (STAGE 2b-3)
// ═══════════════════════════════════════════════════════════════════
//
//  A minimal modal to create an additional business: a name field
//  and a vertical picker. Stage 2b-3 offers only the tire vertical;
//  'mechanic' and 'carwash' options arrive in Stages 3 and 4.
//
//  On submit it calls createBusiness(), then switches to the new
//  business (which reloads the app via BusinessSwitcherContext).
//
//  Pro-gating is enforced by the caller — this modal is only opened
//  when canCreate is true. It does not re-check entitlement.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { createBusiness } from '@/lib/createBusiness';
import { useBusinessSwitcher } from '@/context/BusinessSwitcherContext';
import { addToast } from '@/lib/toast';
import type { VerticalKey } from '@/lib/verticals';

interface Props {
  uid: string;
  email: string;
  onClose: () => void;
}

export function AddBusinessModal({ uid, email, onClose }: Props) {
  const { switchBusiness } = useBusinessSwitcher();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Stage 2b-3: tire only. Mechanic / car wash unlock in Stages 3-4.
  const businessType: VerticalKey = 'tire';

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      addToast('Enter a business name', 'warn');
      return;
    }
    setBusy(true);
    try {
      const { businessId } = await createBusiness({
        uid, email, businessName: trimmed, businessType,
      });
      addToast('Business created', 'success');
      // Switching persists the choice and reloads, so the app
      // re-resolves into the new business cleanly.
      await switchBusiness(businessId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create the business.';
      addToast(msg, 'error');
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a business"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'var(--s2)', border: '1px solid var(--border)',
        borderRadius: 14, padding: 22,
      }}>
        <h2 style={{
          fontSize: 17, fontWeight: 700, color: 'var(--t1)', margin: '0 0 4px',
        }}>
          Add a Business
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Create another business under your account. It has its own
          jobs, inventory, settings, and team — fully separate from
          your other businesses.
        </p>

        <label style={{
          display: 'block', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--t3)', marginBottom: 6,
        }}>
          Business Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Second Truck Tire Service"
          disabled={busy}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--s3)', border: '1px solid var(--border)',
            borderRadius: 9, padding: '11px 12px', fontSize: 14,
            color: 'var(--t1)', marginBottom: 16,
          }}
        />

        {/* Vertical is fixed to tire in Stage 2b-3. The picker
            becomes active when mechanic / car wash ship. */}
        <div style={{
          fontSize: 12, color: 'var(--t3)', marginBottom: 18,
          padding: '9px 11px', background: 'var(--s3)',
          border: '1px solid var(--border)', borderRadius: 9,
        }}>
          Business type: <strong style={{ color: 'var(--t2)' }}>Mobile Tire &amp; Roadside</strong>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 9,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--t2)', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 9,
              background: 'var(--brand-primary)', border: 'none',
              color: '#0a0a0a', fontSize: 14, fontWeight: 700,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Creating…' : 'Create Business'}
          </button>
        </div>
      </div>
    </div>
  );
}
