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

import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import type { Customer } from '@/lib/customerEntity';
import type { Job } from '@/types';
import { CustomerInsightsCard } from '@/components/customers/CustomerInsightsCard';
import { CustomerNotesSection } from '@/components/customers/CustomerNotesSection';
import { VehiclesSection } from '@/components/customers/VehiclesSection';
import { ServiceTimeline } from '@/components/customers/ServiceTimeline';
import { ServiceHistoryPhotos } from '@/components/customers/ServiceHistoryPhotos';

interface Permissions {
  canViewFinancials?: boolean;
  canEditBusinessSettings?: boolean;
}

interface Props {
  businessId: string;
  customerId: string;
  permissions: Permissions;
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
    const ref = doc(_db as Firestore, 'businesses', businessId, 'customers', customerId);
    const unsub = onSnapshot(ref, (snap) => {
      setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
      setLoading(false);
    });
    return () => unsub();
  }, [businessId, customerId]);

  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'jobs'),
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

  const phoneLabel = useMemo(
    () => customer?.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : '',
    [customer?.phoneE164],
  );

  const lastJob = jobs[0] ?? null;
  const canViewFinancials = props.permissions.canViewFinancials ?? false;
  const canEdit = props.permissions.canEditBusinessSettings ?? false;

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
          <div style={{ fontSize: 14, color: 'var(--t2)' }}>📞 {phoneLabel}</div>
        )}
        {customer.email && (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>✉️ {customer.email}</div>
        )}
        {(customer.city || customer.state) && (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>
            📍 {customer.addressLine ? `${customer.addressLine}, ` : ''}{customer.city}{customer.city && customer.state ? ', ' : ''}{customer.state} {customer.zipCode ?? ''}
          </div>
        )}
        {customer.companyName && (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>🏢 {customer.companyName}</div>
        )}
      </header>

      {/* 2. Quick Actions */}
      <nav className="form-group card-anim" aria-label="Quick Actions">
        <div className="form-group-title">Quick Actions</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm primary" onClick={onCreateJob}>Create Job</button>
          <button type="button" className="btn sm secondary" onClick={onRepeatLastJob} disabled={!lastJob}>Repeat Last Job</button>
          <button type="button" className="btn sm secondary" onClick={onRepeatLastService} disabled={!lastJob}>Repeat Last Service</button>
          <button type="button" className="btn sm secondary" onClick={onCall} disabled={!customer.phoneE164}>📞 Call</button>
          <button type="button" className="btn sm secondary" onClick={onText} disabled={!customer.phoneE164}>💬 Text</button>
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

      {/* 9. Communication log (SP4 placeholder) */}
      <section className="form-group card-anim" aria-label="Communication History">
        <div className="form-group-title">Communication History</div>
        <p style={{ margin: 0, color: 'var(--t3)', fontSize: 12 }}>
          Calls and texts appear here once Twilio is connected.
        </p>
      </section>
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 10,
  fontSize: 10, fontWeight: 700,
};
const dimStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
