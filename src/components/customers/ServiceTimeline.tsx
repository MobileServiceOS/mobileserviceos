// src/components/customers/ServiceTimeline.tsx
// ═══════════════════════════════════════════════════════════════════
//  ServiceTimeline — newest-first job list scoped to a customer.
//
//  Spec: §"Customer Profile sections → Service History",
//        §"Customer Timeline (Phase 8)" — newest first
//  Bounded 100-job query (spec §"Insights jobs-load bound").
//  Financial revenue gated by canViewFinancials.
// ═══════════════════════════════════════════════════════════════════

import {
  memo,
  useEffect,
  useState,
  type CSSProperties } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  limit,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import type { Job } from '@/types';

interface Props {
  businessId: string;
  customerId: string;
  canViewFinancials: boolean;
  onJobClick?: (job: Job) => void;
}

function ServiceTimelineImpl({ businessId, customerId, canViewFinancials, onJobClick }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId || !customerId) return;
    const col = collection(requireDb(), 'businesses', businessId, 'jobs');
    const q = query(col, where('customerId', '==', customerId), orderBy('date', 'desc'), limit(100));
    const unsub = onSnapshot(q,
      (snap) => {
        const rows: Job[] = [];
        snap.forEach(d => rows.push({ id: d.id, ...d.data() } as unknown as Job));
        setJobs(rows);
        setLoading(false);
      },
      (err) => {
        console.warn('[ServiceTimeline] listen failed', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [businessId, customerId]);

  const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
  };

  return (
    <section className="form-group card-anim" aria-label="Service History">
      <div className="form-group-title">Service History {!loading && <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>({jobs.length})</span>}</div>
      {loading && <div style={{ color: 'var(--t3)', fontSize: 12 }}>Loading…</div>}
      {!loading && jobs.length === 0 && (
        <div style={{ color: 'var(--t3)', fontSize: 12 }}>No service history yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {jobs.map(j => {
          const revenue = canViewFinancials && j.revenue !== undefined
            ? `$${Math.round(Number(j.revenue) || 0)}`
            : null;
          return (
            <button
              key={j.id}
              type="button"
              style={rowStyle}
              onClick={() => onJobClick?.(j)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{j.service || 'Service'}</span>
                {revenue && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-primary)' }}>{revenue}</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                {fmtDate(j.date)}
                {j.vehicleMakeModel && <span> · {j.vehicleMakeModel}</span>}
                {j.tireSize && <span> · {j.tireSize}</span>}
                {j.city && <span> · {j.city}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const rowStyle: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '10px 12px',
  background: 'transparent', border: 'none',
  borderBottom: '1px solid var(--border, #2a2a2a)',
  color: 'inherit', cursor: 'pointer',
};

export const ServiceTimeline = memo(ServiceTimelineImpl);
