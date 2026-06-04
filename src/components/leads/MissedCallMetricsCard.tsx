// src/components/leads/MissedCallMetricsCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  MissedCallMetricsCard — SP4B 3-cell counter card for CustomerProfile.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"CustomerProfile integration → 1. Missed Call Metrics card"
//
//  Derived from the leads array CustomerProfile already subscribes
//  to for the Recent Leads list. No additional reads.
//
//    Missed Calls = total where source === 'missed_call'
//    Recovered    = count where status in {'Booked', 'Closed'}
//    Lost         = count where status === 'Lost'
//
//  Renders only when total > 0.
// ═══════════════════════════════════════════════════════════════════

import { memo, useMemo, type CSSProperties } from 'react';
import type { Lead } from '@/types';

interface Props {
  leads: Lead[];        // already filtered to this customer's leads by caller
}

function MissedCallMetricsCardImpl({ leads }: Props): JSX.Element | null {
  const counts = useMemo(() => {
    let total = 0, recovered = 0, lost = 0;
    for (const l of leads) {
      if (l.source !== 'missed_call') continue;
      total += 1;
      if (l.status === 'Booked' || l.status === 'Closed') recovered += 1;
      if (l.status === 'Lost')                            lost      += 1;
    }
    return { total, recovered, lost };
  }, [leads]);

  if (counts.total === 0) return null;

  return (
    <div style={cardRoot}>
      <div style={titleStyle}>Missed Call Metrics</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <Cell label="Missed Calls" value={counts.total}     tint="var(--t1)" />
        <Cell label="Recovered"    value={counts.recovered} tint="var(--ok, #4ade80)" />
        <Cell label="Lost"         value={counts.lost}      tint="var(--danger, #f87171)" />
      </div>
    </div>
  );
}

function Cell({ label, value, tint }: { label: string; value: number; tint: string }): JSX.Element {
  return (
    <div style={cellStyle}>
      <div style={{ fontSize: 28, fontWeight: 700, color: tint, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    </div>
  );
}

const cardRoot: CSSProperties = {
  padding: 14, marginBottom: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const titleStyle: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const cellStyle: CSSProperties = {
  flex: 1, textAlign: 'center',
  padding: '8px 4px',
  background: 'var(--s3, #2a2a2a)', borderRadius: 6,
};

export const MissedCallMetricsCard = memo(MissedCallMetricsCardImpl);
