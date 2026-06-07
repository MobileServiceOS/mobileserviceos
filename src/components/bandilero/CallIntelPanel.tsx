// src/components/bandilero/CallIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Call Intelligence panel (Phase 2). Operational, all
//  roles. Conversion + response time as metric tiles; the funnel as a
//  compact status row. NOT_CONNECTED states render explicitly.
// ═══════════════════════════════════════════════════════════════════

import { labeled, hasValue } from '@/lib/bandilero/confidence';
import type { CallIntelDeep } from '@/lib/bandilero/services/callIntelDeep';
import { MetricCard } from './MetricCard';

const STAGES: Array<{ key: keyof CallIntelDeep['funnel']; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'booked', label: 'Booked' },
  { key: 'closed', label: 'Closed' },
  { key: 'lost', label: 'Lost' },
];

export function CallIntelPanel({ data }: { data: CallIntelDeep }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="bandilero-grid">
        <MetricCard metric={labeled(data.conversionPct, 'Conversion rate', 'pct')} />
        <MetricCard metric={labeled(data.avgResponseMinutes, 'Avg response (min)', 'count')} />
      </div>

      {/* Funnel — compact status row */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 6,
      }}>
        {STAGES.map(({ key, label }) => {
          const m = data.funnel[key];
          return (
            <div key={key} style={{
              textAlign: 'center', padding: '9px 4px', borderRadius: 10,
              background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: hasValue(m) ? '#f3f5f9' : '#6b7280' }}>
                {hasValue(m) ? m.value : '—'}
              </div>
              <div style={{ fontSize: 9, color: '#9aa3b2', marginTop: 2, letterSpacing: 0.3 }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
