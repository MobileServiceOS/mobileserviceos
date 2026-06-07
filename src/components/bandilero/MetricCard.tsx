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

export function MetricCard({ metric }: { metric: LabeledMetric }) {
  const connected = metric.state !== 'NOT_CONNECTED';
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '14px 14px 12px',
        borderRadius: 14,
        background: connected ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.06)',
        minHeight: 92,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--t3, #9aa3b2)', fontWeight: 600, lineHeight: 1.25 }}>
          {metric.label}
        </span>
        <ConfidenceBadge state={metric.state} />
      </div>

      {hasValue(metric) ? (
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: '#f3f5f9', lineHeight: 1 }}>
          {fmt(metric.value, metric.format)}
        </div>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 700, color: '#9aa3b2', lineHeight: 1.2 }}>
          Not connected
        </div>
      )}

      {metric.state === 'ESTIMATED' && metric.assumption && (
        <div style={{ fontSize: 10.5, color: '#ffe39a', opacity: 0.9, lineHeight: 1.3 }}>
          {metric.assumption}
        </div>
      )}
      {metric.state === 'NOT_CONNECTED' && metric.reason && (
        <div style={{ fontSize: 10.5, color: '#8b93a3', lineHeight: 1.3 }}>
          {metric.reason}
        </div>
      )}
    </div>
  );
}
