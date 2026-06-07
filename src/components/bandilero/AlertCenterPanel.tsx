// src/components/bandilero/AlertCenterPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Alert Center (Critical / Warning / Opportunity).
//  Dollar-impact driven → owner/admin only (redacted, not faked).
// ═══════════════════════════════════════════════════════════════════

import type { AlertCenter, AlertCategory } from '@/lib/bandilero/services/alertCenter';
import type { Action } from '@/lib/bandilero/types';
import { ActionCard } from './ActionCard';

const META: Record<AlertCategory, { label: string; color: string }> = {
  critical:    { label: 'Critical',    color: '#ff6b6b' },
  warning:     { label: 'Warning',     color: '#ffcf5c' },
  opportunity: { label: 'Opportunity', color: '#22e3a3' },
};

function Group({ cat, items }: { cat: AlertCategory; items: Action[] }) {
  const m = META[cat];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '2px 0 7px 2px' }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: m.color }}>{m.label}</span>
        <span style={{ fontSize: 11, color: '#7e8a9e', fontWeight: 700 }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#6b7280', padding: '2px 2px 4px' }}>None</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.map((a, i) => <ActionCard key={a.id} action={a} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}

export function AlertCenterPanel({ center, canViewFinancials }: { center: AlertCenter; canViewFinancials: boolean }) {
  if (!canViewFinancials) {
    return (
      <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        🔒 The Alert Center (dollar-impact alerts) is available to owners and admins.
      </div>
    );
  }
  if (center.total === 0) {
    return (
      <div style={{ fontSize: 12, color: '#7ef7cf', padding: '10px 12px', borderRadius: 12, background: 'rgba(34,227,163,0.06)', border: '1px solid rgba(34,227,163,0.14)' }}>
        All clear — no alerts above threshold.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Group cat="critical" items={center.critical} />
      <Group cat="warning" items={center.warning} />
      <Group cat="opportunity" items={center.opportunity} />
    </div>
  );
}
