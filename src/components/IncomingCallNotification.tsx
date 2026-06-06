// src/components/IncomingCallNotification.tsx
// ═══════════════════════════════════════════════════════════════════
//  IncomingCallNotification — Phase 1 real-time caller-ID screen-pop.
//
//  Spec: docs/superpowers/specs/2026-06-05-incoming-call-screenpop-design.md
//
//  ── DUAL-SOURCE SUBSCRIPTION ──────────────────────────────────────
//  This component subscribes to TWO Firestore streams simultaneously:
//
//   1. businesses/{bid}/leads (source='missed_call', receivedAt >
//      mountTime) — the existing SP4B path. Fires on the POST-CALL
//      Twilio Status Callback after carrier-forwarded missed call.
//      Active in production today.
//
//   2. businesses/{bid}/incoming_calls (receivedAt > mountTime) —
//      the Phase 1 real-time path. Fires DURING the live ring when
//      twilioIncomingCall webhook + T-Mobile SimRing are configured.
//      Ships dormant — only fires when operator activates SimRing.
//
//  Whichever source lands a doc first triggers the popup. Same-phone
//  dedup (a per-session Set keyed on phoneE164) prevents the post-call
//  Lead from re-triggering after the real-time incoming_call already
//  fired (and vice versa). Each phone gets at most ONE popup per page
//  session.
//
//  ── UX: BANNER → FULL POPUP ───────────────────────────────────────
//  Default arrival is a slim banner dropping in from the top (~72px
//  tall). A 5-second idle timer auto-expands it to the full modal
//  popup. Tap the banner to expand immediately. ESC / backdrop tap
//  dismiss in both modes. 30-second auto-dismiss in full mode.
//
//  ── DATA LAYER REUSE ──────────────────────────────────────────────
//  Customer + Vehicle + Job enrichment uses the same Firestore reads
//  as CustomerProfile so a known caller's popup carries the same
//  vehicle / tire size / last service / lifetime spend / outstanding
//  balance state the operator would see on the profile page.
//
//  Mount: inside MembershipProvider tree, near ToastHost in App.tsx.
//  Lifecycle: subscribes on mount, captures Timestamp.now() as the
//  "since" anchor so it never fires for historical docs. Test docs
//  (id starts with 'lead-test-' OR 'call-test-') are filtered out
//  client-side.
//
//  Pure helpers (exported for tests):
//    - computeBadgeState(jobCount)
//    - shouldShowLead(lead, mountMs, receivedMs)
//    - shouldShowIncomingCall(call, mountMs, receivedMs)
//    - computeBalanceDisplay(customer, openInvoices)
// ═══════════════════════════════════════════════════════════════════

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import { money, resolvePaymentStatus } from '@/lib/utils';
import { useBrand } from '@/context/BrandContext';
import { useFocusTrap } from '@/lib/useFocusTrap';
import type { Customer, Vehicle } from '@/lib/customerEntity';
import type { Job, Lead } from '@/types';

interface Props {
  onOpenCustomer: (customerId: string) => void;
  onOpenCustomerHistory: (customerId: string) => void;
  onCreateNewJob: (phoneE164: string) => void;
  onCreateCustomer: (phoneE164: string) => void;
  onCreateLead: (phoneE164: string) => void;
}

const AUTO_DISMISS_MS = 30_000;
const BANNER_AUTO_EXPAND_MS = 5_000;

// ─── Pure helpers ──────────────────────────────────────────────────

interface BadgeState {
  isRepeat: boolean;
  isVIP: boolean;
}

export function computeBadgeState(completedCount: number): BadgeState {
  return {
    isRepeat: completedCount >= 3 && completedCount < 10,
    isVIP:    completedCount >= 10,
  };
}

/** Should this missed-call Lead trigger the popup? */
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

/** Shape of an incoming_calls doc — mirrors the Cloud Function write. */
export interface IncomingCallDoc {
  id: string;
  callSid?: string;
  from: string;
  to?: string;
  customerId?: string | null;
  customerExists?: boolean;
  direction?: 'inbound';
  callStatus?: string;
}

/** Should this incoming_calls doc trigger the popup? */
export function shouldShowIncomingCall(
  call: Pick<IncomingCallDoc, 'id' | 'from'> | null,
  mountTimeMs: number,
  callReceivedAtMs: number,
): boolean {
  if (!call) return false;
  if (!call.from) return false;
  if (call.id.startsWith('call-test-')) return false;
  if (callReceivedAtMs <= mountTimeMs) return false;
  return true;
}

/** Balance display contract — drives the red outstanding-balance pill. */
export interface BalanceDisplay {
  showBalance: boolean;
  amount: number;
  label: string;
}

/**
 * Computes whether the outstanding-balance pill should render and the
 * dollar amount it shows. Treats:
 *   - undefined / 0 customer balance + no open invoices → not shown.
 *   - positive customer balance OR positive open-invoice sum → shown
 *     with the LARGER of the two amounts (avoids double-count when
 *     both signals overlap).
 *   - negative customer balance → not shown (the customer has a
 *     credit, not a debt — surfacing a "credit" pill in the popup
 *     would distract from the call action set).
 *
 * Customer.balance is intentionally optional on the type — Customer
 * doc schema doesn't currently declare it, but we read it defensively
 * so a future schema addition Just Works.
 */
export function computeBalanceDisplay(
  customer: { balance?: number } | null,
  openInvoiceTotal: number,
): BalanceDisplay {
  const customerBalance = Number(customer?.balance ?? 0);
  const invoiceTotal    = Number(openInvoiceTotal ?? 0);
  if (customerBalance <= 0 && invoiceTotal <= 0) {
    return { showBalance: false, amount: 0, label: '' };
  }
  const amount = Math.max(customerBalance, invoiceTotal);
  return {
    showBalance: true,
    amount,
    label: `Outstanding: ${money(amount)}`,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

/** Format a vehicle as "{year} {make} {model}" with sensible fallbacks. */
function formatVehicle(v: Vehicle | null): string {
  if (!v) return '';
  const parts = [
    v.year ? String(v.year) : '',
    v.make ?? '',
    v.model ?? '',
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return v.vehicleMakeModel ?? '';
}

/** Format an ISO date as "May 24 2026". Empty string on bad input. */
function formatJobDate(iso: string | undefined | null): string {
  if (!iso) return '';
  // YYYY-MM-DD or full ISO — anchor to midday so timezone shifts don't
  // flip the rendered day at the local-midnight boundary.
  const raw = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const d = new Date(raw + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Sum revenue across a job array. Treats string-revenue as numeric. */
function sumRevenue(jobs: Job[]): number {
  return jobs.reduce((acc, j) => acc + (Number(j.revenue ?? 0) || 0), 0);
}

/**
 * Sum of unpaid jobs' revenue (outstanding balance). Uses
 * resolvePaymentStatus so Pending-status jobs (the most common unpaid
 * case — paymentStatus may be unset) are counted, and Cancelled jobs are
 * excluded. (2026-06-05 audit: the old check only matched the
 * paymentStatus field, missing Pending-status unpaid jobs entirely.)
 *
 * Note: "Partial Payment" jobs contribute their FULL revenue — the app
 * stores no captured partial amount, so the full ticket is the only
 * available proxy for what's still owed.
 */
function sumOpenInvoices(jobs: Job[]): number {
  return jobs.reduce((acc, j) => {
    const ps = resolvePaymentStatus(j);
    if (ps === 'Pending Payment' || ps === 'Partial Payment') {
      return acc + (Number(j.revenue ?? 0) || 0);
    }
    return acc;
  }, 0);
}

// ─── Source-merging discriminated union ───────────────────────────

type PopupSource =
  | { kind: 'lead'; lead: Lead }
  | { kind: 'incoming_call'; call: IncomingCallDoc };

function sourcePhone(s: PopupSource): string {
  return s.kind === 'lead' ? s.lead.phoneE164 : s.call.from;
}

function sourceCustomerId(s: PopupSource): string | null {
  if (s.kind === 'lead') return s.lead.customerId ?? null;
  return s.call.customerId ?? null;
}

function sourceKnownCustomer(s: PopupSource): boolean {
  if (s.kind === 'lead') return s.lead.wasNewCustomer !== true;
  return s.call.customerExists === true;
}

function sourceId(s: PopupSource): string {
  return s.kind === 'lead' ? `lead:${s.lead.id}` : `call:${s.call.id}`;
}

// ─── Component ─────────────────────────────────────────────────────

function IncomingCallNotificationImpl({
  onOpenCustomer, onOpenCustomerHistory, onCreateNewJob,
  onCreateCustomer, onCreateLead,
}: Props): JSX.Element | null {
  const { businessId } = useBrand();
  const [activeSource, setActiveSource] = useState<PopupSource | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [dismissedSourceId, setDismissedSourceId] = useState<string | null>(null);
  // Per-session dedup — once a phone has popped via EITHER source it
  // won't re-pop via the OTHER source for this page session. Stable
  // across re-renders via useRef.
  const dismissedPhonesRef = useRef<Set<string>>(new Set());
  const mountTimeRef = useRef<Timestamp>(Timestamp.now());

  // Listen for leads created AFTER mount (existing path)
  useEffect(() => {
    if (!businessId) return;
    const mountTime = Timestamp.now();
    mountTimeRef.current = mountTime;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'leads'),
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
      if (lead.phoneE164 && dismissedPhonesRef.current.has(lead.phoneE164)) return;
      setActiveSource((prev) => prev ?? { kind: 'lead', lead });
    });
    return () => unsub();
  }, [businessId]);

  // Listen for incoming_calls created AFTER mount (Phase 1 new path —
  // dormant in production until operator activates SimRing).
  useEffect(() => {
    if (!businessId) return;
    const mountTime = mountTimeRef.current;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'incoming_calls'),
      where('receivedAt', '>', mountTime),
      orderBy('receivedAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      const docSnap = snap.docs[0];
      const call = { id: docSnap.id, ...docSnap.data() } as IncomingCallDoc;
      const receivedAtMs = (call as unknown as { receivedAt?: { toMillis?: () => number } })
        .receivedAt?.toMillis?.() ?? 0;
      if (!shouldShowIncomingCall(call, mountTime.toMillis(), receivedAtMs)) return;
      if (call.from && dismissedPhonesRef.current.has(call.from)) return;
      setActiveSource((prev) => prev ?? { kind: 'incoming_call', call });
    });
    return () => unsub();
  }, [businessId]);

  // Resolve Customer for the active source
  useEffect(() => {
    if (!businessId || !activeSource) { setCustomer(null); return; }
    const cid = sourceCustomerId(activeSource);
    if (!cid) { setCustomer(null); return; }
    const ref = doc(requireDb(), 'businesses', businessId, 'customers', cid);
    const unsub = onSnapshot(ref, (snap) => {
      setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
    });
    return () => unsub();
  }, [businessId, activeSource]);

  // Resolve latest Vehicle
  useEffect(() => {
    if (!businessId || !activeSource) { setVehicle(null); return; }
    const cid = sourceCustomerId(activeSource);
    if (!cid) { setVehicle(null); return; }
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'customers', cid, 'vehicles'),
      orderBy('lastServicedAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) { setVehicle(null); return; }
      const d = snap.docs[0];
      setVehicle({ id: d.id, ...d.data() } as Vehicle);
    });
    return () => unsub();
  }, [businessId, activeSource]);

  // Resolve recent jobs for this customer (drives last-service,
  // lifetime-spend, completed-count, and outstanding-balance). Fetches
  // ALL statuses by date so outstanding balance can include unpaid
  // Pending-status jobs — completed-only metrics are derived below.
  // (2026-06-05 audit: the prior status=='Completed' filter excluded
  // Pending unpaid jobs from the outstanding total.)
  useEffect(() => {
    if (!businessId || !activeSource) { setRecentJobs([]); return; }
    const cid = sourceCustomerId(activeSource);
    if (!cid) { setRecentJobs([]); return; }
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'jobs'),
      where('customerId', '==', cid),
      orderBy('date', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Job[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as unknown as Job));
      setRecentJobs(next);
    });
    return () => unsub();
  }, [businessId, activeSource]);

  // Banner-mode 5s auto-expand
  useEffect(() => {
    if (!activeSource) return;
    if (expanded) return;
    if (dismissedSourceId === sourceId(activeSource)) return;
    const t = setTimeout(() => setExpanded(true), BANNER_AUTO_EXPAND_MS);
    return () => clearTimeout(t);
  }, [activeSource, expanded, dismissedSourceId]);

  // Full-mode auto-dismiss + Esc key
  useEffect(() => {
    if (!activeSource) return;
    if (dismissedSourceId === sourceId(activeSource)) return;
    const dismiss = () => {
      const sid = sourceId(activeSource);
      setDismissedSourceId(sid);
      const phone = sourcePhone(activeSource);
      if (phone) dismissedPhonesRef.current.add(phone);
    };
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); };
  }, [activeSource, dismissedSourceId]);

  // Reset active source after it has been dismissed so a new ring can
  // re-trigger. Without this the activeSource sticks on the last
  // dismissed doc and the next incoming_call/lead is suppressed by
  // the `prev ?? next` guard in the listeners.
  useEffect(() => {
    if (!activeSource) return;
    if (dismissedSourceId !== sourceId(activeSource)) return;
    // Wait one tick so transition animations have time to play out.
    const t = setTimeout(() => {
      setActiveSource(null);
      setExpanded(false);
      setDismissedSourceId(null);
      setCustomer(null);
      setVehicle(null);
      setRecentJobs([]);
    }, 250);
    return () => clearTimeout(t);
  }, [activeSource, dismissedSourceId]);

  const isVisible = activeSource != null && (dismissedSourceId !== sourceId(activeSource));
  const trapRef = useFocusTrap<HTMLDivElement>(isVisible && expanded);

  // ── Derived display state ─────────────────────────────────────
  // Completed-only metrics (badges, last service, lifetime spend, count)
  // derive from the completed subset; outstanding balance spans all
  // statuses so unpaid Pending jobs are included.
  const completedJobs = useMemo(() => recentJobs.filter(j => j.status === 'Completed'), [recentJobs]);
  const { isRepeat, isVIP } = computeBadgeState(completedJobs.length);
  const lastJob = completedJobs[0] ?? null;
  const lifetimeSpend = useMemo(() => sumRevenue(completedJobs), [completedJobs]);
  const openInvoiceTotal = useMemo(() => sumOpenInvoices(recentJobs), [recentJobs]);
  const balance = useMemo(
    () => computeBalanceDisplay(customer as { balance?: number } | null, openInvoiceTotal),
    [customer, openInvoiceTotal],
  );

  const isKnown = activeSource ? sourceKnownCustomer(activeSource) && !!customer?.name?.trim() : false;
  const phoneRaw = activeSource ? sourcePhone(activeSource) : '';
  const phoneFmt = phoneRaw ? formatPhoneForDisplay(phoneRaw) : '';
  const displayName = isKnown
    ? (customer?.name?.trim() ?? '').toUpperCase()
    : 'UNKNOWN CALLER';

  const vehicleLabel = formatVehicle(vehicle);
  const tireSize = vehicle?.tireSize ?? '';
  const lastService = lastJob?.service ?? '';
  const lastJobDate = formatJobDate(lastJob?.date);
  const city = customer?.city?.trim() ?? '';
  const state = customer?.state?.trim() ?? '';
  const cityState = [city, state].filter(Boolean).join(', ');
  const internalNotes = (() => {
    // Customer doc's free-text `note` is the closest existing field;
    // a future `internalNotes` field is treated identically.
    const c = customer as unknown as { internalNotes?: string; note?: string };
    return (c?.internalNotes ?? c?.note ?? '').trim();
  })();

  if (!isVisible || !activeSource) return null;

  // ── Action handlers ───────────────────────────────────────────
  const handleDismiss = (): void => {
    const sid = sourceId(activeSource);
    setDismissedSourceId(sid);
    const phone = sourcePhone(activeSource);
    if (phone) dismissedPhonesRef.current.add(phone);
  };

  const cid = sourceCustomerId(activeSource);
  const handleOpenCustomer = (): void => {
    if (cid) onOpenCustomer(cid);
    handleDismiss();
  };
  const handleOpenHistory = (): void => {
    if (cid) onOpenCustomerHistory(cid);
    handleDismiss();
  };
  const handleCreateNewJob = (): void => {
    if (phoneRaw) onCreateNewJob(phoneRaw);
    handleDismiss();
  };
  const handleCreateCustomer = (): void => {
    if (phoneRaw) onCreateCustomer(phoneRaw);
    handleDismiss();
  };
  const handleCreateLead = (): void => {
    if (phoneRaw) onCreateLead(phoneRaw);
    handleDismiss();
  };

  // ── Banner mode ──────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        className="incoming-call-banner"
        role="alert"
        aria-live="assertive"
        onClick={() => setExpanded(true)}
        style={bannerStyle}
      >
        <span style={pulseDotStyle} aria-hidden="true">●</span>
        <div style={bannerBodyStyle}>
          <div style={bannerNameStyle}>{displayName}</div>
          <div style={bannerSubStyle}>
            {isKnown && vehicleLabel ? vehicleLabel : phoneFmt}
          </div>
        </div>
        <span style={bannerHintStyle} aria-hidden="true">Tap ▾</span>
      </div>
    );
  }

  // ── Full popup mode ──────────────────────────────────────────
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
            {activeSource.kind === 'incoming_call' ? 'Incoming Call' : 'Missed Call'}
          </span>
        </div>

        {/* Identity */}
        <div style={{ marginBottom: 12 }}>
          <h2 id="incoming-call-title" style={nameStyle}>{displayName}</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            {isKnown && isVIP    && <span style={badgeVIP}>VIP ⭐⭐</span>}
            {isKnown && isRepeat && <span style={badgeRepeat}>Repeat Customer ⭐</span>}
            {!isKnown            && <span style={badgeNew}>Unknown Caller</span>}
          </div>
          {phoneFmt && <div style={phoneStyle}>📞 {phoneFmt}</div>}
        </div>

        {/* Enrichment grid — known customer */}
        {isKnown && (
          <div style={enrichmentBox}>
            {vehicleLabel && <Row label="Vehicle" value={vehicleLabel} />}
            {tireSize     && <Row label="Tire Size" value={tireSize} />}
            {lastService  && <Row label="Last Service:" value={lastService} />}
            {lastJobDate  && <Row label="Last Job:" value={lastJobDate} />}
            {cityState    && <RowPlain value={cityState} />}
            <Row label="Lifetime Spend:" value={money(lifetimeSpend)} />
            <Row label="Completed Jobs:" value={String(completedJobs.length)} />

            {balance.showBalance && (
              <div style={balancePillRow}>
                <span style={balancePill}>{balance.label}</span>
              </div>
            )}

            {internalNotes && (
              <div style={notesBlock} aria-label="Internal notes">
                <em style={notesText}>{internalNotes}</em>
              </div>
            )}
          </div>
        )}

        {/* Unknown caller */}
        {!isKnown && (
          <div style={enrichmentBox}>
            <p style={{ margin: 0, color: 'var(--t2)', fontSize: 13 }}>
              No record on file. Create a customer to capture this caller,
              or log a lead to follow up later.
            </p>
          </div>
        )}

        {/* Action row */}
        <div style={actionRow}>
          {isKnown && cid && (
            <>
              <button type="button" className="btn primary" onClick={handleOpenCustomer}>
                Open Customer
              </button>
              <button type="button" className="btn secondary" onClick={handleOpenHistory}>
                Open History
              </button>
              <button type="button" className="btn secondary" onClick={handleCreateNewJob} disabled={!phoneRaw}>
                Create New Job
              </button>
            </>
          )}
          {!isKnown && (
            <>
              <button type="button" className="btn primary" onClick={handleCreateCustomer} disabled={!phoneRaw}>
                Create Customer
              </button>
              <button type="button" className="btn secondary" onClick={handleCreateLead} disabled={!phoneRaw}>
                Create Lead
              </button>
            </>
          )}
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

function RowPlain({ value }: { value: string }): JSX.Element {
  return (
    <div style={rowStyle}>
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
  textTransform: 'uppercase',
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
const balancePillRow: CSSProperties = {
  marginTop: 8, display: 'flex', justifyContent: 'flex-end',
};
const balancePill: CSSProperties = {
  fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 99,
  background: '#dc2626', color: '#fff',
  textTransform: 'uppercase', letterSpacing: '0.4px',
};
const notesBlock: CSSProperties = {
  marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border, #333)',
};
const notesText: CSSProperties = {
  fontSize: 12, color: 'var(--t2)', lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
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

// Banner mode — slim top drop-down.
const bannerStyle: CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0,
  zIndex: 1200,
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 16px',
  background: 'var(--s1, #111)', color: 'var(--t1)',
  borderBottom: '2px solid var(--brand-primary, #f4b400)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  cursor: 'pointer',
  minHeight: 60, maxHeight: 80,
  animation: 'slideDownFromTop 200ms ease-out',
};
const bannerBodyStyle: CSSProperties = {
  flex: 1, minWidth: 0,
  display: 'flex', flexDirection: 'column', gap: 2,
};
const bannerNameStyle: CSSProperties = {
  fontSize: 14, fontWeight: 700,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const bannerSubStyle: CSSProperties = {
  fontSize: 12, color: 'var(--t2)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const bannerHintStyle: CSSProperties = {
  fontSize: 11, color: 'var(--t3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};

export const IncomingCallNotification = memo(IncomingCallNotificationImpl);
