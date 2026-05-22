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

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createBusiness, generateBusinessId, CreateBusinessStepError } from '@/lib/createBusiness';
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
  // Stable business id for the whole lifetime of this modal. Minted
  // lazily on the first submit and reused on every retry, so a
  // createBusiness call that failed partway is RESUMED (each write
  // is merge:true → idempotent) rather than orphaning the partial
  // business and minting a fresh one.
  const pendingIdRef = useRef<string | undefined>(undefined);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      addToast('Enter a business name', 'warn');
      return;
    }
    setBusy(true);
    if (!pendingIdRef.current) pendingIdRef.current = generateBusinessId();
    console.info('[add-business] STARTING createBusiness', {
      uid, businessType, businessName: trimmed,
      hasExistingUserDoc: ownedBusinesses.length > 0,
    });

    // ── Phase 1: write the four docs. The modal stays on "Creating…"
    //    until these complete OR an individual step throws/times out.
    let businessId: string;
    try {
      const result = await createBusiness({
        uid, email, businessName: trimmed, businessType,
        // The BusinessSwitcher context loaded users/{uid} on mount.
        // If ownedBusinesses is non-empty, the user doc exists.
        hasExistingUserDoc: ownedBusinesses.length > 0,
        // Resume the same id on every attempt — see pendingIdRef.
        resumeId: pendingIdRef.current,
      });
      businessId = result.businessId;
      // Success — clear the pending id so a subsequent business
      // (if the operator opens the modal again) gets a fresh one.
      pendingIdRef.current = undefined;
      console.info('[add-business] createBusiness OK', { businessId });
    } catch (e) {
      // Surface the REAL error to the user — step, path, code, message.
      // CreateBusinessStepError carries everything the toast needs to
      // show what actually broke instead of a generic timeout.
      console.error('[add-business] createBusiness FAILED', e);
      if (e instanceof CreateBusinessStepError) {
        const codeOrTimeout = e.timedOut ? 'timeout' : (e.code || 'error');
        addToast(`${e.step}: ${codeOrTimeout} at ${e.path}`, 'error');
      } else {
        const msg = e instanceof Error ? e.message : 'Could not create the business.';
        addToast(msg, 'error');
      }
      // Release the spinner so the user can retry or cancel — Phase 2
      // never started.
      setBusy(false);
      return;
    }

    // ── Phase 2: switch + reload. By design we do NOT block the modal
    //    on this. The four docs are already on disk; the new business
    //    exists. If activateBusiness's write to users/{uid}.activeBusinessId
    //    times out (its own withTimeout in BusinessSwitcherContext), the
    //    user is left on the current business — they can refresh or pick
    //    the new business from the switcher manually. Either way they
    //    are NEVER trapped on "Creating…" because of a switch hiccup.
    addToast('Business created — switching…', 'success');
    onClose();

    // Fire-and-forget. Surfaces any switch failure via toast so the
    // user knows to refresh manually instead of waiting silently.
    void (async () => {
      try {
        console.info('[add-business] background: activateBusiness', { businessId });
        await activateBusiness(businessId);
        console.info('[add-business] background: activateBusiness returned (reload pending)');
      } catch (e) {
        console.error('[add-business] background: activateBusiness FAILED', e);
        const msg = e instanceof Error ? e.message : 'Switch failed';
        addToast(`${msg} — refresh to load the new business`, 'warn');
      }
    })();
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
            { key: 'detailing' as VerticalKey, label: 'Mobile Car Wash & Detailing' },
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
