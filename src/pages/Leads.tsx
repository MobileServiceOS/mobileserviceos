// src/pages/Leads.tsx
// ═══════════════════════════════════════════════════════════════════
//  Leads — top-level nav tab for the missed-call queue.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"New top-level nav tab: Leads"
//
//  Subscribes to businesses/{bid}/leads + customers. Sorts client-side
//  by priorityScore DESC then receivedAt DESC. Status filter chips
//  show live counts. Substring search across name + phone + notes.
//  Tap card → LeadDetailSheet.
// ═══════════════════════════════════════════════════════════════════

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import { LeadCard } from '@/components/leads/LeadCard';
import { LeadDetailSheet } from '@/components/leads/LeadDetailSheet';
import { computeLeadPriority } from '@/lib/leadPriority';
import { isLeadUnread } from '@/lib/leadLifecycle';
import type { Customer } from '@/lib/customerEntity';
import type { Lead, LeadStatus, Job } from '@/types';

type FilterKey = 'All' | LeadStatus;

interface Props {
  businessId: string;
  onOpenCustomer?: (cid: string) => void;
  onCreateJob?: (draft: Partial<Job>, leadId: string) => void;
}

export default function Leads({ businessId, onOpenCustomer, onCreateJob }: Props): JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map());
  const [filter, setFilter] = useState<FilterKey>('All');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  // Debounce search input — 250ms keeps the filter feeling snappy
  // without thrashing the visible-list memo on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Leads subscription. orderBy(receivedAt desc) is a server hint;
  // the client-side sort below is the authoritative ordering
  // (priorityScore DESC, then receivedAt DESC).
  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'leads'),
      orderBy('receivedAt', 'desc'),
      limit(200),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Lead[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as Lead));
      setLeads(next);
    });
    return () => unsub();
  }, [businessId]);

  // Customers subscription — for name display + priority computation.
  // Gated on leads.length > 0 to avoid a wasted full-collection scan
  // when the leads queue is empty (the common case for new operators).
  useEffect(() => {
    if (!businessId || leads.length === 0) return;
    const unsub = onSnapshot(
      collection(requireDb(), 'businesses', businessId, 'customers'),
      (snap) => {
        const next = new Map<string, Customer>();
        snap.forEach(d => next.set(d.id, { id: d.id, ...d.data() } as Customer));
        setCustomers(next);
      },
    );
    return () => unsub();
  }, [businessId, leads.length]);

  // Sort by (priorityScore DESC, receivedAtMs DESC). Computing priority
  // per render is cheap — N ≤ 200 from the Firestore limit above, and
  // computeLeadPriority is a tight switch over a handful of fields.
  const sorted = useMemo(() => {
    const entries = leads.map(l => {
      const cust = customers.get(l.customerId) ?? null;
      const priority = computeLeadPriority(
        cust ? { vipTier: cust.vipTier, kind: cust.kind, jobCount: cust.jobCount } : null,
        l,
      );
      const receivedAtMs = (l as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt?.toMillis?.() ?? 0;
      return { lead: l, customer: cust, priorityScore: priority.score, receivedAtMs };
    });
    entries.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return b.receivedAtMs - a.receivedAtMs;
    });
    return entries;
  }, [leads, customers]);

  // Status counts — computed across ALL leads (not the filtered set)
  // so the chips always show the true queue depth per status.
  const statusCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      All: leads.length, New: 0, Contacted: 0, Quoted: 0, Booked: 0, Closed: 0, Lost: 0,
    };
    for (const l of leads) {
      counts[l.status] = (counts[l.status] ?? 0) + 1;
    }
    return counts;
  }, [leads]);

  // Unread count — read state is independent of status, so it's counted
  // separately (a Contacted lead can still be unread until opened).
  const unreadCount = useMemo(() => leads.reduce((n, l) => n + (isLeadUnread(l) ? 1 : 0), 0), [leads]);

  // Filter + search. Search hay includes the formatted E.164 AND a
  // digits-only variant so operators can type "3055551212" or
  // "(305) 555-1212" or "+13055551212" and all match.
  const visible = useMemo(() => {
    return sorted.filter(({ lead, customer }) => {
      if (filter !== 'All' && lead.status !== filter) return false;
      if (searchDebounced) {
        const phoneDigits = (lead.phoneE164 ?? '').replace(/[^\d]/g, '');
        const hay = [
          customer?.name ?? '',
          lead.phoneE164 ?? '',
          phoneDigits,
          lead.notes ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(searchDebounced)) return false;
      }
      return true;
    });
  }, [sorted, filter, searchDebounced]);

  const filterChips: FilterKey[] = ['All', 'New', 'Contacted', 'Quoted', 'Booked', 'Closed', 'Lost'];

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Leads {visible.length > 0 && <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--t3)' }}>· {visible.length}</span>}</span>
        {unreadCount > 0 && (
          <span style={unreadPill}>{unreadCount} unread</span>
        )}
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {filterChips.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={'btn sm ' + (filter === k ? 'primary' : 'secondary')}
          >
            {k} {statusCounts[k] > 0 && <span style={{ opacity: 0.7 }}>· {statusCounts[k]}</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, phone, or notes"
        style={searchInputStyle}
      />

      {/* List */}
      {visible.length === 0 && (
        <div style={emptyStyle}>
          {filter === 'All' && !searchDebounced
            ? "No leads yet. When a customer calls and you miss the call, they'll appear here."
            : 'No leads match the current filter.'}
        </div>
      )}
      {visible.map(({ lead, customer }) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          customer={customer}
          onClick={() => setOpenLeadId(lead.id)}
        />
      ))}

      {openLeadId && (
        <LeadDetailSheet
          businessId={businessId}
          leadId={openLeadId}
          onClose={() => setOpenLeadId(null)}
          onOpenCustomer={onOpenCustomer}
          onCreateJob={onCreateJob}
        />
      )}
    </div>
  );
}

const searchInputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, marginBottom: 12,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const emptyStyle: CSSProperties = {
  padding: 24, color: 'var(--t3)', fontSize: 13, textAlign: 'center',
};
const unreadPill: CSSProperties = {
  fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 99,
  background: '#3b82f6', color: '#fff', letterSpacing: '0.3px',
};
