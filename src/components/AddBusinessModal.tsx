// ═══════════════════════════════════════════════════════════════════
//  src/components/AddBusinessModal.tsx — Add-business UI (STAGE 2b-3)
// ═══════════════════════════════════════════════════════════════════
//
//  A modal to create an additional business: a name field and a
//  vertical picker. Tire and Mechanic are both live; car wash /
//  detailing arrives in Stage 4. The chosen vertical seeds the new
//  business's service catalog, pricing model, and inventory shape.
//
//  On submit it calls createBusiness(), then activates the new
//  business (which reloads the app via BusinessSwitcherContext).
//
//  Pro-gating is enforced by the caller — this modal is only opened
//  when canCreate is true. It does not re-check entitlement.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { createPortal } from 'react-dom';
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
  const { activateBusiness, ownedBusinesses } = useBusinessSwitcher();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Selectable vertical. Tire and Mechanic are live; car wash /
  // detailing arrives in Stage 4. Defaults to tire.
  const [businessType, setBusinessType] = useState<VerticalKey>('tire');

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      addToast('Enter a business name', 'warn');
      return;
    }
    setBusy(true);
    console.info('[add-business] step 1: starting createBusiness', { businessType });
    // reloadStarted is set ONLY when activateBusiness has begun its
    // reload sequence. If we reach the finally without it being set,
    // the page won't actually reload — so we MUST reset busy so the
    // button is reachable again instead of stuck on Creating…
    let reloadStarted = false;
    try {
      const { businessId } = await createBusiness({
        uid, email, businessName: trimmed, businessType,
        // The BusinessSwitcher context loaded users/{uid} on mount.
        // If ownedBusinesses is non-empty, the user doc exists.
        // (getOwnedBusinesses returns [uid] when the doc is absent,
        //  so length > 0 is true either way — but the realistic case
        //  for Add Business is always 'exists'.)
        hasExistingUserDoc: ownedBusinesses.length > 0,
      });
      console.info('[add-business] step 2: createBusiness returned', { businessId });
      addToast('Business created', 'success');
      console.info('[add-business] step 3: calling activateBusiness');
      reloadStarted = true;
      await activateBusiness(businessId);
      console.info('[add-business] step 4: activateBusiness returned (reload should be in flight)');
      // If we get here, activateBusiness completed but reload has not
      // yet replaced the page. The finally below resets busy as a
      // safety net so the button isn't stuck.
    } catch (e) {
      console.error('[add-business] FAILED', e);
      const msg = e instanceof Error ? e.message : 'Could not create the business.';
      addToast(msg, 'error');
      // On any failure, we never got to reload — guarantee cleanup.
      reloadStarted = false;
    } finally {
      // Guaranteed cleanup. If a reload is genuinely in flight the
      // page will replace this component momentarily; resetting
      // busy is harmless in that case. If no reload started (error
      // path, or activateBusiness failed silently), this releases
      // the Creating… spinner so the user can retry.
      if (!reloadStarted) {
        setBusy(false);
      } else {
        // Belt-and-suspenders: if the reload is somehow blocked
        // (browser policy, etc.), clear the spinner after a moment
        // so the user is never stranded.
        setTimeout(() => setBusy(false), 2500);
      }
    }
  }

  // createPortal: mount the modal at document.body, OUTSIDE the
  // app's normal DOM tree. The dashboard / header / any other
  // ancestor that creates its own stacking context (transformed,
  // fixed, sticky, or with its own z-index layer) cannot then cover
  // the modal — zIndex: 200 is evaluated at the document root, so
  // the modal sits above everything in the app.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a business"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        // ONE scrolling surface (the overlay), not two. Two competing
        // scroll surfaces on iOS Safari race with the keyboard and
        // can leave the card stranded. Letting the overlay scroll and
        // making the card a plain block that grows naturally is the
        // pattern that actually works on iPhone.
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        // Top-aligned + horizontal-centered via padding/margin on
        // the card. Avoiding flexbox here so the overlay's scroll
        // height tracks the card's full height correctly on iOS.
        padding: '20px 16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 380,
        margin: '0 auto',
        background: 'var(--s2)', border: '1px solid var(--border)',
        borderRadius: 14, padding: 22,
        // The card grows naturally to fit its content. The overlay
        // (parent) is the one scrolling surface, so every field is
        // reachable by scrolling the overlay no matter how tall the
        // card gets or how much the keyboard shrinks the viewport.
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
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--s3)', border: '1px solid var(--border)',
            borderRadius: 9, padding: '11px 12px', fontSize: 16,
            color: 'var(--t1)', marginBottom: 16,
          }}
        />

        {/* Vertical picker — tire and mechanic are both live. The
            chosen vertical seeds the new business's service catalog,
            pricing model, and inventory shape. */}
        <label style={{
          display: 'block', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--t3)', marginBottom: 6,
        }}>
          Business Type
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {([
            { key: 'tire' as VerticalKey, label: 'Mobile Tire & Roadside' },
            { key: 'mechanic' as VerticalKey, label: 'Mobile Mechanic' },
          ]).map((opt) => {
            const selected = businessType === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => !busy && setBusinessType(opt.key)}
                aria-pressed={selected}
                style={{
                  flex: 1, padding: '11px 8px', borderRadius: 9,
                  background: selected ? 'rgba(200,164,74,0.10)' : 'var(--s3)',
                  border: selected
                    ? '1px solid var(--brand-primary)'
                    : '1px solid var(--border)',
                  color: selected ? 'var(--brand-primary)' : 'var(--t2)',
                  fontSize: 12.5, fontWeight: selected ? 700 : 600,
                  cursor: busy ? 'default' : 'pointer', lineHeight: 1.3,
                }}
              >
                {opt.label}
              </button>
            );
          })}
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
    </div>,
    document.body,
  );
}
