// src/pages/CustomerProfile.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerProfile — the deep customer page.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Customer Profile Sections (v3.2 user-confirmed)"
//
//  Section order:
//    1. Header
//    2. Quick Actions row
//    3. CustomerInsightsCard
//    4. VehiclesSection
//    5. CustomerNotesSection (Quick Notes)
//    6. ServiceTimeline
//    7. ServiceHistoryPhotos
//    8. Notes (free-text `note`)
//    9. Communication log (SP4 — empty placeholder)
//
//  RBAC: canViewFinancials gates revenue. canEditBusinessSettings
//  gates Quick Notes inline edit.
// ═══════════════════════════════════════════════════════════════════

import {
  useEffect,
  useMemo,
  useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import { usePermissions } from '@/context/MembershipContext';
import type { Customer } from '@/lib/customerEntity';
import type { Job } from '@/types';
import { CustomerInsightsCard } from '@/components/customers/CustomerInsightsCard';
import { CustomerNotesSection } from '@/components/customers/CustomerNotesSection';
import { VehiclesSection } from '@/components/customers/VehiclesSection';
import { ServiceTimeline } from '@/components/customers/ServiceTimeline';
import { ServiceHistoryPhotos } from '@/components/customers/ServiceHistoryPhotos';
import type { ReviewRequest, CommunicationEvent, Lead } from '@/types';
import { LeadCard } from '@/components/leads/LeadCard';
import { LeadDetailSheet } from '@/components/leads/LeadDetailSheet';
import { MissedCallMetricsCard } from '@/components/leads/MissedCallMetricsCard';

interface Props {
  businessId: string;
  customerId: string;
  currentUserUid: string;
  onBack: () => void;
  onViewJob?: (job: Job) => void;
  onCreateJob?: (draft: Partial<Job>) => void;
}

export default function CustomerProfile(props: Props): JSX.Element {
  const { businessId, customerId } = props;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId || !customerId) return;
    const ref = doc(requireDb(), 'businesses', businessId, 'customers', customerId);
    const unsub = onSnapshot(ref, (snap) => {
      setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
      setLoading(false);
    });
    return () => unsub();
  }, [businessId, customerId]);

  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'jobs'),
      where('customerId', '==', customerId),
      orderBy('date', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: Job[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as unknown as Job));
      setJobs(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);

  const [reviewRequests, setReviewRequests] = useState<ReviewRequest[]>([]);
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'reviewRequests'),
      where('customerId', '==', customerId),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: ReviewRequest[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as ReviewRequest));
      setReviewRequests(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);

  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'communicationEvents'),
      where('customerId', '==', customerId),
      orderBy('sentAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: CommunicationEvent[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as CommunicationEvent));
      setCommEvents(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);

  const [customerLeads, setCustomerLeads] = useState<Lead[]>([]);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'leads'),
      where('customerId', '==', customerId),
      orderBy('receivedAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: Lead[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as Lead));
      setCustomerLeads(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);

  const phoneLabel = useMemo(
    () => customer?.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : '',
    [customer?.phoneE164],
  );

  // SP3: read permissions from MembershipContext directly so the
  // values reflect the actual signed-in member's role. App.tsx's
  // hook-level usePermissions sees the default ALL_FALSE because the
  // provider mounts BELOW App's function body.
  const perms = usePermissions();
  const canViewFinancials = perms.canViewFinancials ?? false;
  const canEdit = perms.canEditBusinessSettings ?? false;

  const lastJob = jobs[0] ?? null;

  if (loading) {
    return (
      <div className="page page-enter">
        <div style={{ padding: 20, color: 'var(--t3)' }}>Loading customer…</div>
      </div>
    );
  }
  if (!customer) {
    return (
      <div className="page page-enter">
        <div style={{ padding: 20 }}>
          <button type="button" className="btn sm secondary" onClick={props.onBack}>← Back</button>
          <p style={{ marginTop: 16, color: 'var(--t2)' }}>Customer not found.</p>
        </div>
      </div>
    );
  }

  const onCall = () => {
    if (customer.phoneE164) window.location.href = `tel:${customer.phoneE164}`;
  };
  const onText = () => {
    if (customer.phoneE164) window.location.href = `sms:${customer.phoneE164}`;
  };
  const onCreateJob = () => {
    props.onCreateJob?.({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : '',
      customerEmail: customer.email,
      city: customer.city,
      state: customer.state,
    } as Partial<Job>);
  };
  const onRepeatLastJob = () => {
    if (lastJob) {
      props.onCreateJob?.({
        ...lastJob,
        id: undefined as unknown as string,
        date: new Date().toISOString().slice(0, 10),
        status: 'Pending',
        paymentStatus: 'Pending Payment',
        revenue: '',
        tireCost: '',
        materialCost: '',
      } as Partial<Job>);
    }
  };
  const onRepeatLastService = onRepeatLastJob;

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn sm secondary" onClick={props.onBack}>← Back</button>
      </div>

      {/* 1. Header */}
      <header className="form-group card-anim" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, margin: 0, color: 'var(--t1)', fontWeight: 700 }}>{customer.name}</h1>
          {customer.kind === 'fleet' && (
            <span style={{ ...badgeStyle, background: '#3b82f6', color: '#fff' }}>Fleet</span>
          )}
          {customer.vipTier && customer.vipTier !== 'Standard' && (
            <span style={{
              ...badgeStyle,
              background: customer.vipTier === 'Platinum' ? '#b5a5e8' : '#d4af37',
              color: '#1a1a1a',
            }}>{customer.vipTier}</span>
          )}
          {customer.customerStatus && customer.customerStatus !== 'Active' && (
            <span style={{ ...badgeStyle, background: 'var(--s3)', color: 'var(--t2)' }}>{customer.customerStatus}</span>
          )}
          {(customer.jobCount ?? 0) > 1 && (
            <span style={{ ...badgeStyle, background: 'var(--s3)', color: 'var(--t2)' }}>Repeat × {customer.jobCount}</span>
          )}
        </div>
        {phoneLabel && (
          <div style={{ fontSize: 14, color: 'var(--t2)' }}>{phoneLabel}</div>
        )}
        {customer.email && (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>{customer.email}</div>
        )}
        {(customer.city || customer.state) && (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>
            {customer.addressLine ? `${customer.addressLine}, ` : ''}{customer.city}{customer.city && customer.state ? ', ' : ''}{customer.state} {customer.zipCode ?? ''}
          </div>
        )}
        {customer.companyName && (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>{customer.companyName}</div>
        )}
      </header>

      {/* 2. Quick Actions */}
      <nav className="form-group card-anim" aria-label="Quick Actions">
        <div className="form-group-title">Quick Actions</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm primary" onClick={onCreateJob}>Create Job</button>
          <button type="button" className="btn sm secondary" onClick={onRepeatLastJob} disabled={!lastJob}>Repeat Last Job</button>
          <button type="button" className="btn sm secondary" onClick={onRepeatLastService} disabled={!lastJob}>Repeat Last Service</button>
          <button type="button" className="btn sm secondary" onClick={onCall} disabled={!customer.phoneE164}>Call</button>
          <button type="button" className="btn sm secondary" onClick={onText} disabled={!customer.phoneE164}>Text</button>
          <button type="button" className="btn sm secondary" disabled style={dimStyle} title="Send Quote — wired in SP3 follow-up">Send Quote</button>
          <button type="button" className="btn sm secondary" disabled style={dimStyle} title="Send Invoice — wired in SP3 follow-up">Send Invoice</button>
          <button type="button" className="btn sm secondary" disabled style={dimStyle} title="Send Review — wired in SP3 follow-up">Send Review</button>
        </div>
      </nav>

      {/* 3. Customer Insights */}
      <CustomerInsightsCard
        customer={customer}
        jobs={jobs}
        canViewFinancials={canViewFinancials}
      />

      {/* 4. Vehicles */}
      <VehiclesSection businessId={businessId} customerId={customerId} />

      {/* 5. Quick Notes */}
      <CustomerNotesSection
        businessId={businessId}
        customer={customer}
        canEdit={canEdit}
        editorUid={props.currentUserUid}
      />

      {/* 6. Service Timeline */}
      <ServiceTimeline
        businessId={businessId}
        customerId={customerId}
        canViewFinancials={canViewFinancials}
        onJobClick={props.onViewJob}
      />

      {/* 7. Service History Photos */}
      <ServiceHistoryPhotos jobs={jobs} onJobClick={props.onViewJob} />

      {/* 8. Notes (free-text) */}
      {customer.note && (
        <section className="form-group card-anim" aria-label="Notes">
          <div className="form-group-title">Notes</div>
          <p style={{ margin: 0, color: 'var(--t2)', whiteSpace: 'pre-wrap' }}>{customer.note}</p>
        </section>
      )}

      {/* 9. Communication History */}
      <section className="form-group card-anim" aria-label="Communication History">
        <div className="form-group-title">Communication History</div>

        {/* SP4B: Missed Call Metrics card */}
        <MissedCallMetricsCard leads={customerLeads} />

        {/* SP4B: Recent Leads sub-section */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recent Leads
          </div>
          {customerLeads.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>No leads yet for this customer.</p>
          )}
          {customerLeads.slice(0, 5).map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              customer={customer}
              onClick={() => setOpenLeadId(l.id)}
            />
          ))}
        </div>

        {/* Review Requests sub-section */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Review Requests
          </div>
          {reviewRequests.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>None yet.</p>
          )}
          {reviewRequests.map(r => (
            <div key={r.id} style={cpRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--t1)', fontWeight: 600 }}>
                  {(r as unknown as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis
                    ? new Date(((r as unknown as { createdAt: { toMillis: () => number } }).createdAt).toMillis())
                        .toLocaleString(undefined, { month: 'short', day: 'numeric' })
                    : '—'}
                </span>
                <span style={{ ...cpPill(r.status) }}>{r.status}</span>
                {r.isTest   && <span style={cpBadge('#facc15','#1a1a1a')}>TEST</span>}
                {r.isManual && <span style={cpBadge('#a78bfa','#1a1a1a')}>MANUAL</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                {r.templateRendered.length > 80 ? r.templateRendered.slice(0, 80) + '…' : r.templateRendered}
              </div>
              {r.errorMessage && (
                <div style={{ fontSize: 11, color: 'var(--danger, #f87171)', marginTop: 2 }}>
                  Error: {r.errorMessage}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Communication Events sub-section */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Communication Events
          </div>
          {commEvents.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>None yet.</p>
          )}
          {commEvents.map(e => (
            <div key={e.id} style={cpRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--t1)', fontWeight: 600 }}>{e.type.replace(/_/g, ' ')}</span>
                <span style={{ ...cpPill(e.status) }}>{e.status}</span>
              </div>
              {e.content && (
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                  {e.content.length > 80 ? e.content.slice(0, 80) + '…' : e.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {openLeadId && (
        <LeadDetailSheet
          businessId={businessId}
          leadId={openLeadId}
          onClose={() => setOpenLeadId(null)}
          onOpenCustomer={() => { /* no-op — we're already on this customer */ }}
          // CustomerProfile doesn't host AddJob navigation; Create-Job-from-Lead
          // here uses the same onCreateJob prop the existing Customer page uses.
          onCreateJob={(draft, leadId) => {
            props.onCreateJob?.({ ...draft, leadId } as never);
            setOpenLeadId(null);
          }}
        />
      )}
    </div>
  );
}

const cpRowStyle: React.CSSProperties = {
  padding: '6px 0', borderBottom: '1px solid var(--border, #2a2a2a)',
};
function cpPill(status: string): React.CSSProperties {
  const colorMap: Record<string, string> = {
    pending: '#888', sending: '#3b82f6', sent: '#4ade80',
    failed: '#f87171', cancelled: '#6b7280', skipped: '#888',
    queued: '#888',
  };
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: colorMap[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function cpBadge(bg: string, fg: string): React.CSSProperties {
  return {
    fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
    background: bg, color: fg,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 10,
  fontSize: 10, fontWeight: 700,
};
const dimStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
