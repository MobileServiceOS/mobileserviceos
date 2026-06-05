// src/components/IncomingCallNotification.tsx
// ═══════════════════════════════════════════════════════════════════
//  IncomingCallNotification — SP4C real-time screen-pop.
//
//  Listens for newly-created leads (source='missed_call', non-test,
//  receivedAt > component mount) and surfaces a full-screen overlay
//  with customer enrichment + action buttons.
//
//  Mount: inside MembershipProvider tree, near ToastHost in App.tsx.
//  Lifecycle: subscribes on mount, captures Timestamp.now() as the
//  "since" anchor so it never fires for historical leads. Test leads
//  (id starts with 'lead-test-') are filtered out client-side.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"CustomerProfile integration" (data layer reuse), plus operator
//        requirements 2026-06-05 (carrier-forwarding deploy day).
// ═══════════════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import { useBrand } from '@/context/BrandContext';
import { useFocusTrap } from '@/lib/useFocusTrap';
import type { Customer, Vehicle } from '@/lib/customerEntity';
import type { Job, Lead } from '@/types';

interface Props {
  onOpenLead: (leadId: string) => void;
  onOpenCustomer: (customerId: string) => void;
  onCreateCustomer: (phoneE164: string) => void;
}

const AUTO_DISMISS_MS = 30_000;

interface BadgeState {
  isRepeat: boolean;
  isVIP: boolean;
}

// Pure helper — exposed as a named export for the test file
export function computeBadgeState(completedCount: number): BadgeState {
  return {
    isRepeat: completedCount >= 3 && completedCount < 10,
    isVIP:    completedCount >= 10,
  };
}

// Pure helper for the "should this lead trigger a popup?" decision
export function shouldShowLead(
  lead: Pick<Lead, 'id' | 'source'> | null,
  mountTimeMs: number,
  leadReceivedAtMs: number,
): boolean {
  if (!lead) return false;
  if (lead.source !== 'missed_call') return false;
  if (lead.id.startsWith('lead-test-')) return false;
  if (leadReceivedAtMs <= mountTimeMs) return false;
  return true;
}

function IncomingCallNotificationImpl({
  onOpenLead, onOpenCustomer, onCreateCustomer,
}: Props): JSX.Element | null {
  const { businessId } = useBrand();
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [completedJobs, setCompletedJobs] = useState<Job[]>([]);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const mountTimeRef = useRef<Timestamp>(Timestamp.now());

  // Listen for leads created AFTER mount
  useEffect(() => {
    if (!businessId) return;
    const mountTime = Timestamp.now();
    mountTimeRef.current = mountTime;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'leads'),
      where('source', '==', 'missed_call'),
      where('receivedAt', '>', mountTime),
      orderBy('receivedAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      const docSnap = snap.docs[0];
      const lead = { id: docSnap.id, ...docSnap.data() } as Lead;
      const receivedAtMs = (lead as unknown as { receivedAt?: { toMillis?: () => number } })
        .receivedAt?.toMillis?.() ?? 0;
      if (!shouldShowLead(lead, mountTime.toMillis(), receivedAtMs)) return;
      setActiveLead(lead);
    });
    return () => unsub();
  }, [businessId]);

  // Resolve Customer for the active lead
  useEffect(() => {
    if (!businessId || !activeLead?.customerId) { setCustomer(null); return; }
    const ref = doc(_db as Firestore, 'businesses', businessId, 'customers', activeLead.customerId);
    const unsub = onSnapshot(ref, (snap) => {
      setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
    });
    return () => unsub();
  }, [businessId, activeLead?.customerId]);

  // Resolve latest Vehicle
  useEffect(() => {
    if (!businessId || !activeLead?.customerId) { setVehicle(null); return; }
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'customers', activeLead.customerId, 'vehicles'),
      orderBy('lastServicedAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) { setVehicle(null); return; }
      const d = snap.docs[0];
      setVehicle({ id: d.id, ...d.data() } as Vehicle);
    });
    return () => unsub();
  }, [businessId, activeLead?.customerId]);

  // Resolve completed jobs
  useEffect(() => {
    if (!businessId || !activeLead?.customerId) { setCompletedJobs([]); return; }
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'jobs'),
      where('customerId', '==', activeLead.customerId),
      where('status', '==', 'Completed'),
      orderBy('date', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Job[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as unknown as Job));
      setCompletedJobs(next);
    });
    return () => unsub();
  }, [businessId, activeLead?.customerId]);

  // Auto-dismiss + Esc key
  useEffect(() => {
    if (!activeLead || dismissedId === activeLead.id) return;
    const timer = setTimeout(() => setDismissedId(activeLead.id), AUTO_DISMISS_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDismissedId(activeLead.id); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); };
  }, [activeLead, dismissedId]);

  const isVisible = activeLead != null && dismissedId !== activeLead.id;
  const trapRef = useFocusTrap<HTMLDivElement>(isVisible);

  const { isRepeat, isVIP } = computeBadgeState(completedJobs.length);
  const lastJob = completedJobs[0] ?? null;

  const isUnknown = activeLead?.wasNewCustomer === true || !customer?.name?.trim();
  const displayName = isUnknown ? 'Unknown Caller' : (customer?.name?.trim() ?? '');
  const phoneFmt = activeLead?.phoneE164 ? formatPhoneForDisplay(activeLead.phoneE164) : '';

  // 8 Quick Notes — filter to populated ones, max 3 lines for the popup
  const notes = useMemo(() => {
    if (!customer) return [] as Array<{ label: string; value: string }>;
    const c = customer as unknown as Record<string, string | undefined>;
    return ([
      ['Gate code',        c.gateCode],
      ['Apt #',            c.apartmentNumber],
      ['Wheel lock key',   c.wheelLockKeyLocation],
      ['TPMS',             c.tpmsNotes],
      ['Payment',          c.preferredPaymentMethod],
      ['Parking',          c.parkingInstructions],
      ['Comm preference',  c.preferredContactMethod],
      ['Notes',            c.generalNotes],
    ] as Array<[string, string | undefined]>)
      .filter(([, v]) => v && String(v).trim())
      .slice(0, 3)
      .map(([label, value]) => ({ label, value: String(value) }));
  }, [customer]);

  if (!isVisible || !activeLead) return null;

  const handleCallBack = () => { if (activeLead.phoneE164) window.location.href = `tel:${activeLead.phoneE164}`; };
  const handleOpenLead = () => { onOpenLead(activeLead.id); setDismissedId(activeLead.id); };
  const handleOpenCustomer = () => { if (activeLead.customerId) onOpenCustomer(activeLead.customerId); setDismissedId(activeLead.id); };
  const handleCreateCustomer = () => { if (activeLead.phoneE164) onCreateCustomer(activeLead.phoneE164); setDismissedId(activeLead.id); };
  const handleDismiss = () => setDismissedId(activeLead.id);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleDismiss(); }}
      style={{ zIndex: 1200 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-call-title"
    >
      <div ref={trapRef} className="modal-card" style={cardStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={pulseDotStyle} aria-hidden="true">●</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Missed Call
          </span>
        </div>

        {/* Identity */}
        <div style={{ marginBottom: 12 }}>
          <h2 id="incoming-call-title" style={nameStyle}>{displayName}</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            {isVIP    && <span style={badgeVIP}>VIP CUSTOMER</span>}
            {isRepeat && <span style={badgeRepeat}>REPEAT CUSTOMER</span>}
            {isUnknown && activeLead.wasNewCustomer && <span style={badgeNew}>NEW</span>}
          </div>
          <div style={phoneStyle}>📞 {phoneFmt}</div>
        </div>

        {/* Enrichment grid */}
        {!isUnknown && (
          <div style={enrichmentBox}>
            {vehicle && (
              <Row label="Vehicle" value={vehicle.vehicleMakeModel || '—'} />
            )}
            {vehicle?.tireSize && (
              <Row label="Tire size" value={vehicle.tireSize} />
            )}
            {lastJob && (
              <Row
                label="Last service"
                value={`${lastJob.service ?? '—'} · ${lastJob.date ?? '—'}`}
              />
            )}
            <Row
              label="Completed jobs"
              value={`${completedJobs.length}`}
            />
            {notes.length > 0 && (
              <div style={notesRow}>
                <div style={notesLabel}>Notes</div>
                {notes.map((n) => (
                  <div key={n.label} style={notesItem}>
                    <strong>{n.label}:</strong> {n.value}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isUnknown && (
          <div style={enrichmentBox}>
            <p style={{ margin: 0, color: 'var(--t2)', fontSize: 13 }}>
              No record on file. Create a customer to capture this caller.
            </p>
          </div>
        )}

        {/* Action row */}
        <div style={actionRow}>
          <button type="button" className="btn primary" onClick={handleCallBack} disabled={!activeLead.phoneE164}>
            📞 Call Back
          </button>
          {!isUnknown && activeLead.customerId && (
            <button type="button" className="btn secondary" onClick={handleOpenCustomer}>
              Open Customer
            </button>
          )}
          {isUnknown && (
            <button type="button" className="btn secondary" onClick={handleCreateCustomer}>
              Create Customer
            </button>
          )}
          <button type="button" className="btn secondary" onClick={handleOpenLead}>
            Open Lead
          </button>
          <button type="button" className="btn sm secondary" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={rowLabel}>{label}</span>
      <span style={rowValue}>{value}</span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  maxWidth: 480, width: 'calc(100vw - 32px)',
  background: 'var(--s1, #111)', color: 'var(--t1)',
  borderRadius: 14,
  border: '2px solid var(--brand-primary, #f4b400)',
  padding: 20,
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
};
const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
};
const pulseDotStyle: CSSProperties = {
  fontSize: 12, color: '#f87171',
  animation: 'pulse 1.6s ease-in-out infinite',
};
const nameStyle: CSSProperties = {
  margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t1)',
};
const phoneStyle: CSSProperties = {
  marginTop: 8, fontSize: 16, color: 'var(--t2)',
};
const enrichmentBox: CSSProperties = {
  padding: 12, marginBottom: 14,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const rowStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12,
  fontSize: 13, padding: '4px 0',
};
const rowLabel: CSSProperties = { color: 'var(--t3)', fontWeight: 500 };
const rowValue: CSSProperties = { color: 'var(--t1)', fontWeight: 600, textAlign: 'right' };
const notesRow: CSSProperties = { marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border, #333)' };
const notesLabel: CSSProperties = { fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 };
const notesItem: CSSProperties = { fontSize: 12, color: 'var(--t2)', marginBottom: 2 };
const actionRow: CSSProperties = {
  display: 'flex', gap: 8, flexWrap: 'wrap',
};
const badgeBase: CSSProperties = {
  fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const badgeVIP:    CSSProperties = { ...badgeBase, background: '#b5a5e8', color: '#1a1a1a' };
const badgeRepeat: CSSProperties = { ...badgeBase, background: '#22c55e', color: '#fff'    };
const badgeNew:    CSSProperties = { ...badgeBase, background: '#fb923c', color: '#1a1a1a' };

export const IncomingCallNotification = memo(IncomingCallNotificationImpl);
