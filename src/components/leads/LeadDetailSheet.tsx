// src/components/leads/LeadDetailSheet.tsx
// ═══════════════════════════════════════════════════════════════════
//  LeadDetailSheet — SP4B full-screen Lead detail modal.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"LeadDetailSheet (Wheel Rush enrichment)"
//
//  Composes:
//    1. CustomerEnrichmentPanel (Wheel Rush block)
//    2. Status section (current pill + state-machine dropdown +
//       Create Job from Lead button)
//    3. SMS thread (communicationEvents WHERE leadId)
//    4. Composer (sendManualOutboundSms)
//    5. Notes editor (lead.notes save on blur)
//    6. Audit footer
// ═══════════════════════════════════════════════════════════════════

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { _auth, requireDb } from '@/lib/firebase';
import { usePermissions } from '@/context/MembershipContext';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { markViewedPatch, stageTransitionPatch } from '@/lib/leadLifecycle';
import { formatPhoneForDisplay } from '@/lib/phone';
import { CustomerEnrichmentPanel } from '@/components/leads/CustomerEnrichmentPanel';
import { RoadsideActions } from '@/components/RoadsideActions';
import type { Lead, LeadStatus, CommunicationEvent, Job } from '@/types';

interface Props {
  businessId: string;
  leadId: string;
  onClose: () => void;
  onOpenCustomer?: (cid: string) => void;
  onCreateJob?: (draft: Partial<Job>, leadId: string) => void;
}

function _getEmulatorAwareFunctions() {
  const fns = getFunctions();
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const useEmu =
    env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';
  if (useEmu) {
    try { connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch { /* already connected */ }
  }
  return fns;
}

// State-machine UI policing. Firestore rules only enforce status ∈ enum;
// the UI prevents illegal transitions by hiding/disabling buttons.
const LEGAL_NEXT_STATUSES: Record<LeadStatus, LeadStatus[]> = {
  New:       ['Contacted', 'Lost'],
  Contacted: ['Quoted', 'Booked', 'Lost'],
  Quoted:    ['Booked', 'Lost'],
  Booked:    ['Closed', 'Lost'],
  Closed:    [],
  Lost:      [],
};

export function LeadDetailSheet({
  businessId, leadId, onClose, onOpenCustomer, onCreateJob,
}: Props): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const perms = usePermissions();
  const canEdit = perms.canEditBusinessSettings;
  const canViewFinancials = perms.canViewFinancials;

  const [lead, setLead] = useState<Lead | null>(null);
  const [events, setEvents] = useState<CommunicationEvent[]>([]);
  const [notesLocal, setNotesLocal] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [composerInFlight, setComposerInFlight] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [statusChangeOpen, setStatusChangeOpen] = useState(false);
  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lostReasonText, setLostReasonText] = useState('');

  // Lead subscription
  useEffect(() => {
    if (!businessId || !leadId) return;
    const unsub = onSnapshot(doc(requireDb(), 'businesses', businessId, 'leads', leadId), (snap) => {
      if (snap.exists()) {
        const l = { id: snap.id, ...snap.data() } as Lead;
        setLead(l);
        setNotesLocal(l.notes ?? '');
      } else {
        setLead(null);
      }
    });
    return () => unsub();
  }, [businessId, leadId]);

  // Mark viewed on first open — the core read-state write. Writes
  // viewedAt exactly once (markViewedPatch returns null once set, and
  // the ref guards against a double-write before the snapshot echoes
  // back). Persisted in Firestore ⇒ "Unread" clears across refresh,
  // re-login, and devices. A read receipt, so not gated on canEdit.
  const viewedWrittenFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lead || !businessId || !leadId) return;
    if (lead.viewedAt || viewedWrittenFor.current === leadId) return;
    viewedWrittenFor.current = leadId;
    const patch = markViewedPatch(lead, _auth?.currentUser?.uid ?? 'unknown', Timestamp.now());
    if (!patch) return;
    const ref = doc(requireDb(), 'businesses', businessId, 'leads', leadId);
    void setDoc(ref, patch, { merge: true });
  }, [lead, businessId, leadId]);

  // Communication events for this lead
  useEffect(() => {
    if (!businessId || !leadId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'communicationEvents'),
      where('leadId', '==', leadId),
      orderBy('sentAt', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: CommunicationEvent[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as CommunicationEvent));
      setEvents(next);
    });
    return () => unsub();
  }, [businessId, leadId]);

  const onChangeStatus = useCallback(async (next: LeadStatus) => {
    if (!lead || !canEdit) return;
    if (next === 'Lost') {
      setLostReasonOpen(true);
      return;
    }
    const ref = doc(requireDb(), 'businesses', businessId, 'leads', leadId);
    await setDoc(ref, stageTransitionPatch(next, _auth?.currentUser?.uid ?? 'unknown', Timestamp.now()), { merge: true });
    setStatusChangeOpen(false);
  }, [lead, canEdit, businessId, leadId]);

  const onConfirmLost = useCallback(async () => {
    if (!lead || !canEdit) return;
    const reason = lostReasonText.trim();
    if (!reason) return;
    const now = Timestamp.now();
    const ref = doc(requireDb(), 'businesses', businessId, 'leads', leadId);
    // stageTransitionPatch stamps lostAt; closedReason/closedAt carry the
    // existing close-out metadata the rest of the app already reads.
    await setDoc(ref, stageTransitionPatch('Lost', _auth?.currentUser?.uid ?? 'unknown', now, {
      closedReason: reason,
      closedAt: now,
    }), { merge: true });
    setLostReasonOpen(false);
    setLostReasonText('');
    setStatusChangeOpen(false);
  }, [lead, canEdit, businessId, leadId, lostReasonText]);

  const onBlurNotes = useCallback(async () => {
    if (!lead || !canEdit) return;
    if (notesLocal === (lead.notes ?? '')) return;
    const ref = doc(requireDb(), 'businesses', businessId, 'leads', leadId);
    await setDoc(ref, {
      notes: notesLocal,
      updatedAt: Timestamp.now(),
      lastEditedByUid: _auth?.currentUser?.uid ?? 'unknown',
    }, { merge: true });
  }, [lead, canEdit, businessId, leadId, notesLocal]);

  const onSendComposer = useCallback(async () => {
    if (!lead || !composerBody.trim()) return;
    setComposerError(null);
    setComposerInFlight(true);
    try {
      const fn = httpsCallable<
        { businessId: string; leadId: string; body: string },
        { smsId: string }
      >(_getEmulatorAwareFunctions(), 'sendManualOutboundSms');
      await fn({ businessId, leadId, body: composerBody });
      setComposerBody('');
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err));
    } finally {
      setComposerInFlight(false);
    }
  }, [lead, businessId, leadId, composerBody]);

  const onCreateJobFromLead = useCallback(() => {
    if (!lead || !onCreateJob) return;
    // Pass the formatted phone — it displays cleanly in the Add Job field
    // AND drives the auto-fill (the lookup normalizes formatting back to
    // digits), so a returning-customer lead opens the job already filled
    // with name / address / vehicle / last service + price. We carry the
    // lead's own data on top: its notes (merged with the customer's access
    // info in AddJob, not overwritten) and its assignee — so a lead the
    // owner dispatched to a tech becomes a job already assigned to them.
    const draft: Partial<Job> = {
      customerId: lead.customerId,
      customerPhone: lead.phoneE164 ? formatPhoneForDisplay(lead.phoneE164) : '',
      note: lead.notes ?? '',
    };
    if (lead.assignedToUid) draft.assignedToUid = lead.assignedToUid;
    onCreateJob(draft, lead.id);
  }, [lead, onCreateJob]);

  const nextLegalStatuses = useMemo(() => {
    if (!lead) return [] as LeadStatus[];
    return LEGAL_NEXT_STATUSES[lead.status] ?? [];
  }, [lead]);

  if (!lead) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" style={{ maxWidth: 480 }}>
          <p style={{ color: 'var(--t2)' }}>Loading lead…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={trapRef} className="modal-card" style={{
        maxWidth: 640, width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--s1)', border: '1px solid var(--border)', borderRadius: 16,
      }}>
        {/* Fixed header — never scrolls, so Close is always clickable and
            can't be overlapped by the content below. */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, padding: '13px 16px', borderBottom: '1px solid var(--border)', background: 'var(--s1)',
        }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Lead</h2>
          <button type="button" className="btn sm secondary" onClick={onClose}>Close</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: 16, flex: 1 }}>
        {/* Roadside actions — one-tap call / text the lead. */}
        <RoadsideActions phoneE164={lead.phoneE164} />

        {/* 1. Customer enrichment */}
        <CustomerEnrichmentPanel
          businessId={businessId}
          customerId={lead.customerId}
          wasNewCustomer={lead.wasNewCustomer}
          canViewFinancials={canViewFinancials}
          onOpenCustomer={onOpenCustomer}
        />

        {/* 2. Status section */}
        <div style={sectionRoot}>
          <div style={sectionTitle}>Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={statusPill(lead.status)}>{lead.status}</span>
            {canEdit && nextLegalStatuses.length > 0 && (
              <button
                type="button"
                className="btn sm secondary"
                onClick={() => setStatusChangeOpen(!statusChangeOpen)}
              >
                Change Status
              </button>
            )}
            {canEdit && onCreateJob && (
              <button
                type="button"
                className="btn sm primary"
                onClick={onCreateJobFromLead}
              >
                Create Job from Lead
              </button>
            )}
          </div>
          {statusChangeOpen && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
              {nextLegalStatuses.map(s => (
                <button
                  key={s}
                  type="button"
                  className={'btn sm ' + (s === 'Lost' ? 'danger' : 'secondary')}
                  onClick={() => onChangeStatus(s)}
                >
                  → {s}
                </button>
              ))}
            </div>
          )}
          {lostReasonOpen && (
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Why was this lead lost?</label>
              <input
                type="text"
                value={lostReasonText}
                onChange={(e) => setLostReasonText(e.target.value)}
                placeholder="e.g. went with competitor"
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button type="button" className="btn sm secondary" onClick={() => { setLostReasonOpen(false); setLostReasonText(''); }}>Cancel</button>
                <button type="button" className="btn sm danger" disabled={!lostReasonText.trim()} onClick={onConfirmLost}>Mark Lost</button>
              </div>
            </div>
          )}
        </div>

        {/* 3. SMS thread */}
        <div style={sectionRoot}>
          <div style={sectionTitle}>Conversation</div>
          {events.length === 0 && (
            <p style={emptyStyle}>No messages yet.</p>
          )}
          {events.map(e => {
            const isOut = e.direction === 'outbound';
            return (
              <div key={e.id} style={{
                display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start',
                marginBottom: 6,
              }}>
                <div style={bubble(isOut, e.status)}>
                  <div>{e.content || '—'}</div>
                  <div style={bubbleMeta}>
                    {e.status} · {formatTs((e as unknown as { sentAt?: { toMillis?: () => number } }).sentAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 4. Composer */}
        {canEdit && (
          <div style={sectionRoot}>
            <div style={sectionTitle}>Send SMS</div>
            <textarea
              value={composerBody}
              onChange={(e) => setComposerBody(e.target.value)}
              placeholder="Type a message to send via Twilio…"
              rows={3}
              maxLength={1600}
              style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, textAlign: 'right' }}>
              {composerBody.length}/1600
            </div>
            <button
              type="button"
              className="btn sm primary"
              disabled={composerInFlight || !composerBody.trim()}
              onClick={onSendComposer}
              style={{ marginTop: 6 }}
            >
              {composerInFlight ? 'Sending…' : 'Send'}
            </button>
            {composerError && <p style={{ ...emptyStyle, color: 'var(--danger, #f87171)', marginTop: 6 }}>{composerError}</p>}
          </div>
        )}

        {/* 5. Notes editor */}
        <div style={sectionRoot}>
          <div style={sectionTitle}>Notes</div>
          <textarea
            value={notesLocal}
            onChange={(e) => setNotesLocal(e.target.value)}
            onBlur={onBlurNotes}
            placeholder="Operator notes about this lead…"
            rows={3}
            disabled={!canEdit}
            style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
          />
        </div>

        {/* 6. Audit footer */}
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer' }}>Audit</summary>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            <div>Received: {formatTs((lead as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt)}</div>
            <div>CallSid: {lead.callSid ?? '—'}</div>
            <div>CallStatus: {lead.callStatus ?? '—'}</div>
            <div>Auto-text sent: {lead.autoTextSent ? 'yes' : 'no'}</div>
            <div>outboundSmsId: {lead.outboundSmsId ?? '—'}</div>
            <div>wasNewCustomer: {lead.wasNewCustomer ? 'yes' : 'no'}</div>
            <div>Last edited by: {lead.lastEditedByUid ?? '—'}</div>
          </div>
        </details>
        </div>
      </div>
    </div>
  );
}

function statusPill(status: LeadStatus): CSSProperties {
  const colorMap: Record<LeadStatus, string> = {
    New: '#3b82f6', Contacted: '#f59e0b', Quoted: '#a78bfa',
    Booked: '#4ade80', Closed: '#6b7280', Lost: '#f87171',
  };
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: colorMap[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function bubble(isOut: boolean, status: string): CSSProperties {
  return {
    maxWidth: '75%', padding: '6px 10px', borderRadius: 12,
    background: isOut
      ? (status === 'failed' ? '#7f1d1d' : 'var(--brand-primary, #f4b400)')
      : 'var(--s3, #2a2a2a)',
    color: isOut ? '#1a1a1a' : 'var(--t1)',
    fontSize: 13, whiteSpace: 'pre-wrap',
  };
}
const bubbleMeta: CSSProperties = {
  fontSize: 10, opacity: 0.7, marginTop: 2,
};
function formatTs(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  return new Date(ts.toMillis()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const sectionRoot: CSSProperties = {
  marginBottom: 12, padding: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const sectionTitle: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const labelStyle: CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: 12,
  color: 'var(--t2)', marginBottom: 4,
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s3, #2a2a2a)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const emptyStyle: CSSProperties = { fontSize: 12, color: 'var(--t3)', margin: 0 };
