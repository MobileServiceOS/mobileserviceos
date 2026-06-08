// src/components/leads/LeadCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  LeadCard — list row for the Leads tab + CustomerProfile Recent
//  Leads section.
//
//  Spec: §"LeadCard" + §"Priority Score → Display"
//
//  Pure-presentational. Consumer subscribes to leads + customers and
//  passes the joined Customer doc as a prop. Computes priority badges
//  via leadPriority. Renders all applicable badges (max 3 visible,
//  rest collapse to +N).
// ═══════════════════════════════════════════════════════════════════

import { memo, type CSSProperties } from 'react';
import { formatPhoneForDisplay } from '@/lib/phone';
import { computeLeadPriority } from '@/lib/leadPriority';
import { isLeadUnread } from '@/lib/leadLifecycle';
import type { Customer } from '@/lib/customerEntity';
import type { Lead, LeadStatus } from '@/types';

interface Props {
  lead: Lead;
  customer: Customer | null;          // null when wasNewCustomer + race-on-create
  lastCommPreview?: string;           // last comm event content snippet
  onClick: () => void;
}

const STATUS_COLORS: Record<LeadStatus, string> = {
  New:       '#3b82f6',
  Contacted: '#f59e0b',
  Quoted:    '#a78bfa',
  Booked:    '#4ade80',
  Closed:    '#6b7280',
  Lost:      '#f87171',
};

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  vip:             { bg: '#b5a5e8', fg: '#1a1a1a' },   // Platinum purple
  fleet:           { bg: '#3b82f6', fg: '#fff'    },   // Fleet blue
  high_value:      { bg: '#d4af37', fg: '#1a1a1a' },   // Gold
  repeat_customer: { bg: '#22c55e', fg: '#fff'    },   // Repeat green
  new_customer:    { bg: '#fb923c', fg: '#1a1a1a' },   // New-customer orange
};

// Clean inline source markers (replace emoji 📞💬👤). 1em = inherits the
// row font-size; currentColor = inherits the muted row colour.
function SourceIcon({ source }: { source: string }): JSX.Element | null {
  const common = {
    viewBox: '0 0 24 24', width: '1em', height: '1em', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const, 'aria-hidden': true,
    style: { display: 'inline-block', verticalAlign: '-0.1em' as const },
  };
  if (source === 'missed_call') return <svg {...common}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
  if (source === 'inbound_sms') return <svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
  if (source === 'manual') return <svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
  return null;
}

function _timeago(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  const dt = Date.now() - ts.toMillis();
  if (dt < 60_000)            return 'just now';
  if (dt < 60 * 60_000)       return `${Math.floor(dt / 60_000)} min ago`;
  if (dt < 24 * 60 * 60_000)  return `${Math.floor(dt / (60 * 60_000))} hr ago`;
  return `${Math.floor(dt / (24 * 60 * 60_000))} d ago`;
}

function LeadCardImpl({ lead, customer, lastCommPreview, onClick }: Props): JSX.Element {
  const priority = computeLeadPriority(
    customer ? { vipTier: customer.vipTier, kind: customer.kind, jobCount: customer.jobCount } : null,
    lead,
  );
  const isTest = lead.id.startsWith('lead-test-');
  const displayName = customer?.name?.trim()
    || (lead.wasNewCustomer ? 'Unknown caller' : (lead.phoneE164 || 'Unknown'));
  const phoneFmt = lead.phoneE164 ? formatPhoneForDisplay(lead.phoneE164) : '';
  const visibleBadges = priority.badges.slice(0, 3);
  const overflowCount = Math.max(0, priority.badges.length - 3);
  const unread = isLeadUnread(lead);
  const receivedAt = (lead as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt;

  return (
    <button type="button" onClick={onClick} style={cardRoot}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Row 1: name + read state + lead state.
              Read state (Unread) and lead state (status) are distinct
              concepts and shown separately — never collapsed to "NEW". */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {unread && <span aria-hidden="true" style={unreadDot} />}
            <strong style={{ fontSize: 14, color: 'var(--t1)', fontWeight: unread ? 800 : 600 }}>{displayName}</strong>
            {unread && <span style={unreadBadge}>UNREAD</span>}
            <span style={statusPill(lead.status)}>{lead.status}</span>
            {isTest && <span style={testBadge}>TEST</span>}
          </div>

          {/* Row 2: priority badges */}
          {visibleBadges.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {visibleBadges.map(b => (
                <span key={b.key} style={priorityBadge(b.key)}>{b.label}</span>
              ))}
              {overflowCount > 0 && (
                <span style={overflowBadge}>+{overflowCount}</span>
              )}
            </div>
          )}

          {/* Row 3: phone + age + source */}
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            <SourceIcon source={lead.source} /> {phoneFmt} · {_timeago(receivedAt)}
          </div>

          {/* Row 4: last comm preview (if any) */}
          {lastCommPreview && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4, fontStyle: 'italic',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              "{lastCommPreview}"
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function statusPill(status: LeadStatus): CSSProperties {
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: STATUS_COLORS[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function priorityBadge(key: string): CSSProperties {
  const c = BADGE_COLORS[key] ?? { bg: '#666', fg: '#fff' };
  return {
    fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
    background: c.bg, color: c.fg,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
}

const cardRoot: CSSProperties = {
  display: 'block', width: '100%',
  padding: '10px 12px', marginBottom: 8,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
  cursor: 'pointer', textAlign: 'left',
};
const testBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#facc15', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const unreadBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#3b82f6', color: '#fff',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const unreadDot: CSSProperties = {
  width: 7, height: 7, borderRadius: 99, background: '#3b82f6',
  boxShadow: '0 0 6px rgba(59,130,246,0.8)', flexShrink: 0,
};
const overflowBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#444', color: 'var(--t1)',
  letterSpacing: '0.5px',
};

export const LeadCard = memo(LeadCardImpl);
