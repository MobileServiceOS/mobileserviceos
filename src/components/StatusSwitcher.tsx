import { useEffect, useState } from 'react';
import { TECH_STATUSES, TECH_STATUS_LABELS, TECH_STATUS_TONE, type TechStatus, type PresenceDoc } from '@/types';
import { setMyPresence, subscribeToPresence } from '@/lib/presence';
import { hapticMedium } from '@/lib/haptics';
import { _auth } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────
//  StatusSwitcher — the technician-mode work-status pill in the
//  global header. Tap → opens a bottom-sheet picker with the five
//  TechStatus values; selecting one writes presence and closes.
//
//  Owners + admins don't render this (their header keeps the sync
//  pill). Techs see it instead.
//
//  Layout: a small pill with a colored dot + the current status
//  label. Designed to fit alongside the BusinessSwitcher and the
//  sign-out button without breaking the header on narrow phones.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string | null;
}

export function StatusSwitcher({ businessId }: Props) {
  const uid = _auth?.currentUser?.uid;
  const [presence, setPresence] = useState<PresenceDoc | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Subscribe to my own presence so the pill reflects what's
  // actually on disk (handles multi-device + the rare case where
  // the dispatcher resets a tech's status from the board).
  useEffect(() => {
    if (!businessId || !uid) return;
    const unsub = subscribeToPresence(businessId, (m) => {
      setPresence(m.get(uid) || null);
    });
    return unsub;
  }, [businessId, uid]);

  const status = presence?.status;
  const tone = status ? TECH_STATUS_TONE[status] : 'neutral';

  const handlePick = async (next: TechStatus) => {
    if (!businessId) return;
    setBusy(true);
    try {
      await setMyPresence(businessId, next);
      hapticMedium();
      setPicking(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setPicking(true)}
        className={'sync-pill ' + (tone === 'green' ? 'synced' : tone === 'amber' ? 'syncing' : tone === 'red' ? 'failed' : 'local')}
        title="Tap to change your work status"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', border: 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8, height: 8, borderRadius: 999,
            background: tone === 'green'  ? '#22c55e'
                      : tone === 'amber'  ? '#f59e0b'
                      : tone === 'red'    ? '#ef4444'
                      : 'var(--t3)',
            boxShadow: tone === 'green' ? '0 0 0 2px rgba(34,197,94,.2)' : undefined,
          }}
        />
        {status ? TECH_STATUS_LABELS[status] : 'Set status'}
      </button>

      {picking && (
        <div
          onClick={() => setPicking(false)}
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
              width: '100%', maxWidth: 480,
              background: 'var(--s1)',
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
              borderTop: '1px solid var(--border)',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{
              width: 40, height: 4, background: 'var(--t3)',
              borderRadius: 4, margin: '2px auto 14px', opacity: 0.5,
            }} />
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
              Set your status
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.5 }}>
              The dispatcher sees your status on the board. Update it as you
              start a job, arrive on site, or clock out.
            </div>
            {TECH_STATUSES.map((s) => {
              const active = status === s;
              const stone = TECH_STATUS_TONE[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handlePick(s)}
                  disabled={busy}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    width: '100%', textAlign: 'left',
                    padding: '14px 12px', marginBottom: 8,
                    background: active ? 'var(--s3)' : 'var(--s2)',
                    border: '1px solid ' + (active ? 'var(--brand-primary)' : 'var(--border)'),
                    borderRadius: 10,
                    color: 'var(--t1)',
                    cursor: 'pointer',
                    minHeight: 56,
                  }}
                >
                  <span style={{
                    width: 12, height: 12, borderRadius: 999, flexShrink: 0,
                    background: stone === 'green'  ? '#22c55e'
                              : stone === 'amber'  ? '#f59e0b'
                              : stone === 'red'    ? '#ef4444'
                              : 'var(--t3)',
                  }} />
                  <span style={{ flex: 1, fontWeight: 700 }}>{TECH_STATUS_LABELS[s]}</span>
                  {active && (
                    <span style={{ fontSize: 11, color: 'var(--brand-primary)', fontWeight: 800 }}>
                      Current
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setPicking(false)}
              style={{ width: '100%', marginTop: 6, fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
