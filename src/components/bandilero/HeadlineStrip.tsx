// src/components/bandilero/HeadlineStrip.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — the at-a-glance command strip (8 headline KPIs).
//
//  Replaces the old duplicate briefing metric-grids. Each KPI is a real
//  Metric (LIVE/ESTIMATED/NOT_CONNECTED); financial KPIs are redacted
//  (not faked) for technicians. NOT_CONNECTED shows explicitly.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import { type Metric, type MetricFormat, hasValue } from '@/lib/bandilero/confidence';

export interface Kpi {
  label: string;
  metric: Metric<number>;
  format: MetricFormat;
  financial?: boolean;
}

const DOT: Record<string, string> = { LIVE: '#22d3ee', ESTIMATED: '#ffcf5c', NOT_CONNECTED: '#6b7280' };

function fmt(value: number, format: MetricFormat): string {
  if (format === 'money') return money(value);
  if (format === 'pct') return `${value}%`;
  return new Intl.NumberFormat('en-US').format(value);
}

export function HeadlineStrip({ kpis, canViewFinancials }: { kpis: Kpi[]; canViewFinancials: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 8, marginBottom: 4 }}>
      {kpis.map((k) => {
        const redacted = k.financial && !canViewFinancials;
        const dot = DOT[k.metric.state] || '#6b7280';
        return (
          <div key={k.label} className={`bnd-card ${k.metric.state === 'LIVE' && !redacted ? 'bnd-live' : ''}`}
            style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 5, minHeight: 64 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#9aa3b2', fontWeight: 700, letterSpacing: 0.3 }}>
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: redacted ? '#6b7280' : dot, flexShrink: 0 }} />
              {k.label}
            </span>
            {redacted ? (
              <span style={{ fontSize: 15, fontWeight: 800, color: '#6b7280' }}>🔒</span>
            ) : hasValue(k.metric) ? (
              <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: k.metric.state === 'LIVE' ? '#ecfdff' : '#f3f5f9' }}>
                {fmt(k.metric.value, k.format)}
              </span>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7e8a9e' }}>Not connected</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
