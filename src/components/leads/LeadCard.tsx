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
  new_lead:        { bg: '#fb923c', fg: '#1a1a1a' },   // New orange
};

const SOURCE_ICON: Record<string, string> = {
  missed_call: '📞',
  inbound_sms: '💬',
  manual:      '👤',
};

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
  const receivedAt = (lead as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt;

  return (
    <button type="button" onClick={onClick} style={cardRoot}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Row 1: name + status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14, color: 'var(--t1)' }}>{displayName}</strong>
            <span style={statusPill(lead.status)}>{lead.status}</span>
            {isTest && <span style={testBadge}>TEST</span>}
            {lead.wasNewCustomer && <span style={newCustomerBadge}>NEW</span>}
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
            {SOURCE_ICON[lead.source] ?? ''} {phoneFmt} · {_timeago(receivedAt)}
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
const newCustomerBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#fb923c', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const overflowBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#444', color: 'var(--t1)',
  letterSpacing: '0.5px',
};

export const LeadCard = memo(LeadCardImpl);
