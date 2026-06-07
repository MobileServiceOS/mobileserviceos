// src/components/bandilero/MetricCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — single metric tile.
//
//  Renders a value ONLY when the metric carries one. NOT_CONNECTED
//  shows an explicit "Not connected" state (never a 0 or blank that
//  reads as real). ESTIMATED shows its assumption inline.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import type { LabeledMetric, MetricFormat } from '@/lib/bandilero/confidence';
import { hasValue } from '@/lib/bandilero/confidence';
import { ConfidenceBadge } from './ConfidenceBadge';

function fmt(value: number, format: MetricFormat): string {
  if (format === 'money') return money(value);
  if (format === 'pct') return `${value}%`;
  return new Intl.NumberFormat('en-US').format(value);
}

// Confidence state → card class. LIVE pulses (.bnd-live::after), ESTIMATED
// is static amber, NOT_CONNECTED is muted — the honesty rule, in CSS.
const STATE_CLASS = { LIVE: 'bnd-live', ESTIMATED: 'bnd-est', NOT_CONNECTED: 'bnd-nc' } as const;

export function MetricCard({ metric }: { metric: LabeledMetric }) {
  return (
    <div
      className={`bnd-card ${STATE_CLASS[metric.state]}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '14px 14px 12px',
        minHeight: 92,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--bnd-t2, #aeb9cc)', fontWeight: 600, lineHeight: 1.25 }}>
          {metric.label}
        </span>
        <ConfidenceBadge state={metric.state} />
      </div>

      {hasValue(metric) ? (
        <div style={{
          fontSize: 26, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1,
          color: metric.state === 'LIVE' ? '#ecfdff' : '#f3f5f9',
          textShadow: metric.state === 'LIVE' ? '0 0 18px rgba(34,211,238,0.35)' : 'none',
        }}>
          {fmt(metric.value, metric.format)}
        </div>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--bnd-t3, #7e8a9e)', lineHeight: 1.2 }}>
          Not connected
        </div>
      )}

      {metric.state === 'ESTIMATED' && metric.assumption && (
        <div style={{ fontSize: 10.5, color: '#ffe39a', opacity: 0.9, lineHeight: 1.3 }}>
          {metric.assumption}
        </div>
      )}
      {metric.state === 'NOT_CONNECTED' && metric.reason && (
        <div style={{ fontSize: 10.5, color: 'var(--bnd-t3, #7e8a9e)', lineHeight: 1.3 }}>
          {metric.reason}
        </div>
      )}
    </div>
  );
}
