// src/components/leads/CustomerEnrichmentPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerEnrichmentPanel — Wheel Rush customer-context block.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"LeadDetailSheet (Wheel Rush enrichment)" → §"Customer
//        Enrichment Panel"
//
//  Pulls live from Customer + Vehicle subcollection + Jobs query.
//  Lifetime revenue computed at render time (NEVER persisted per SP3
//  privacy contract). Gated by canViewFinancials.
//
//  Shape: rendered inside LeadDetailSheet at the top. Read-only (no
//  edit actions — those live on the Customer profile).
// ═══════════════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import type { Customer, Vehicle } from '@/lib/customerEntity';
import type { Job } from '@/types';

interface Props {
  businessId: string;
  customerId: string;
  wasNewCustomer: boolean;
  canViewFinancials: boolean;
  onOpenCustomer?: (cid: string) => void;
}

function CustomerEnrichmentPanelImpl({
  businessId, customerId, wasNewCustomer, canViewFinancials, onOpenCustomer,
}: Props): JSX.Element {
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [vehicles, setVehicles]   = useState<Vehicle[]>([]);
  const [jobs, setJobs]           = useState<Job[]>([]);

  // Customer doc
  useEffect(() => {
    if (!businessId || !customerId) return;
    const ref = doc(_db as Firestore, 'businesses', businessId, 'customers', customerId);
    const unsub = onSnapshot(ref, (snap) => {
      setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
    });
    return () => unsub();
  }, [businessId, customerId]);

  // Vehicles for this customer (most recent first)
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'customers', customerId, 'vehicles'),
      orderBy('lastServicedAt', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Vehicle[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as Vehicle));
      setVehicles(next);
    });
    return () => unsub();
  }, [businessId, customerId]);

  // Jobs for this customer (most recent first) — drives lifetime revenue + last service
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'jobs'),
      where('customerId', '==', customerId),
      orderBy('date', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Job[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as unknown as Job));
      setJobs(next);
    });
    return () => unsub();
  }, [businessId, customerId]);

  // Live lifetime revenue compute — NEVER persisted (SP3 privacy contract)
  const lifetimeRevenue = useMemo(() => {
    return jobs.reduce<number>((sum, j) => {
      const r = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
      return Number.isFinite(r) ? sum + r : sum;
    }, 0);
  }, [jobs]);

  const lastJob = jobs[0] ?? null;
  const topVehicle = vehicles[0] ?? null;

  // For unknown callers / new customers the customer record exists but
  // is sparse. Render a "Test Lead" affordance when id starts with cust-test-.
  if (!customer || customer.id.startsWith('cust-test-')) {
    return (
      <div style={panelRoot}>
        <div style={titleStyle}>Customer</div>
        <p style={emptyStyle}>
          {customer?.id.startsWith('cust-test-')
            ? 'Test lead — no real customer record.'
            : 'Loading customer…'}
        </p>
      </div>
    );
  }

  const displayName = customer.name?.trim() || (wasNewCustomer ? 'Unknown caller' : '(unnamed)');
  const phoneFmt = customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : '';

  return (
    <div style={panelRoot}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          type="button"
          style={nameLink}
          onClick={() => onOpenCustomer?.(customer.id)}
        >
          {displayName}
        </button>
        {wasNewCustomer && <span style={newCustomerBadge}>NEW CUSTOMER</span>}
        {customer.kind === 'fleet' && <span style={fleetBadge}>FLEET</span>}
        {customer.vipTier && customer.vipTier !== 'Standard' && (
          <span style={vipBadge(customer.vipTier)}>{customer.vipTier}</span>
        )}
      </div>

      {/* Contact */}
      {phoneFmt && <div style={rowStyle}>📞 <a href={`tel:${customer.phoneE164}`} style={linkStyle}>{phoneFmt}</a></div>}
      {customer.email && <div style={rowStyle}>✉️ {customer.email}</div>}
      {(customer.city || customer.state) && (
        <div style={rowStyle}>📍 {customer.addressLine ? `${customer.addressLine}, ` : ''}{customer.city}{customer.city && customer.state ? ', ' : ''}{customer.state} {customer.zipCode ?? ''}</div>
      )}

      {/* Vehicle */}
      {topVehicle && (
        <div style={{ marginTop: 10 }}>
          <div style={subTitleStyle}>Vehicle</div>
          <div style={rowStyle}>{topVehicle.vehicleMakeModel || '(make/model unknown)'}</div>
          {topVehicle.tireSize && <div style={rowStyle}>Tire size: {topVehicle.tireSize}</div>}
          {topVehicle.lastServiceDate && (
            <div style={rowStyle}>Last serviced: {topVehicle.lastServiceDate}</div>
          )}
        </div>
      )}

      {/* Last service */}
      {lastJob && canViewFinancials && (
        <div style={{ marginTop: 10 }}>
          <div style={subTitleStyle}>Last Service</div>
          <div style={rowStyle}>
            {lastJob.date} · {lastJob.service}
            {lastJob.revenue !== undefined && lastJob.revenue !== '' && (
              <> · ${typeof lastJob.revenue === 'number' ? lastJob.revenue.toFixed(0) : lastJob.revenue}</>
            )}
          </div>
        </div>
      )}

      {/* Lifetime revenue (computed live, gated) */}
      {canViewFinancials && jobs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={subTitleStyle}>Lifetime Revenue</div>
          <div style={{ ...rowStyle, fontSize: 18, fontWeight: 700, color: 'var(--brand-primary)' }}>
            ${lifetimeRevenue.toFixed(0)}
            <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400, marginLeft: 6 }}>
              · {jobs.length} job{jobs.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}

      {/* Quick Notes — 8 SP1 Quick Notes fields (read-only chips) */}
      <QuickNotes customer={customer} />

      {/* Footer link */}
      {onOpenCustomer && (
        <button type="button" style={footerLink} onClick={() => onOpenCustomer(customer.id)}>
          Open customer profile →
        </button>
      )}
    </div>
  );
}

// Quick Notes — renders only the populated fields as chips.
// Adapts to the SP1 Customer schema (gateCode, apartmentNumber, etc.).
function QuickNotes({ customer }: { customer: Customer }): JSX.Element | null {
  const entries: Array<{ label: string; value: string | undefined }> = [
    { label: 'Gate code',          value: customer.gateCode },
    { label: 'Apartment #',        value: customer.apartmentNumber },
    { label: 'Wheel lock key',     value: customer.wheelLockKeyLocation },
    { label: 'TPMS',               value: customer.tpmsNotes },
    { label: 'Payment preferred',  value: customer.preferredPaymentMethod },
    { label: 'Parking',            value: customer.parkingInstructions },
    { label: 'Comm preference',    value: customer.preferredContactMethod },
    { label: 'Notes',              value: customer.generalNotes },
  ];
  const filled = entries.filter(e => e.value && String(e.value).trim());
  if (filled.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={subTitleStyle}>Quick Notes</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {filled.map(e => (
          <span key={e.label} style={quickNoteChip}>
            <span style={{ fontWeight: 700 }}>{e.label}:</span> {e.value}
          </span>
        ))}
      </div>
    </div>
  );
}

const panelRoot: CSSProperties = {
  padding: 14, marginBottom: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const titleStyle: CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 8,
};
const subTitleStyle: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--t3)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const rowStyle: CSSProperties = { fontSize: 13, color: 'var(--t2)', padding: '2px 0' };
const linkStyle: CSSProperties = { color: 'var(--brand-primary)', textDecoration: 'none' };
const emptyStyle: CSSProperties = { fontSize: 12, color: 'var(--t3)', margin: 0 };
const nameLink: CSSProperties = {
  background: 'transparent', border: 'none', padding: 0,
  fontSize: 16, fontWeight: 700, color: 'var(--brand-primary)',
  cursor: 'pointer', textAlign: 'left',
};
const footerLink: CSSProperties = {
  display: 'block', marginTop: 12,
  background: 'transparent', border: 'none', padding: 0,
  fontSize: 12, color: 'var(--brand-primary)', cursor: 'pointer',
  textAlign: 'left', textDecoration: 'underline',
};
const quickNoteChip: CSSProperties = {
  fontSize: 11, padding: '2px 6px', borderRadius: 6,
  background: 'var(--s3, #2a2a2a)', color: 'var(--t1)',
};
const newCustomerBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
  background: '#fb923c', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const fleetBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
  background: '#3b82f6', color: '#fff',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
function vipBadge(tier: 'Gold' | 'Platinum'): CSSProperties {
  return {
    fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
    background: tier === 'Platinum' ? '#b5a5e8' : '#d4af37',
    color: '#1a1a1a',
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
}

export const CustomerEnrichmentPanel = memo(CustomerEnrichmentPanelImpl);
