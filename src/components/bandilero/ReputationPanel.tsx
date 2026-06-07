// src/components/bandilero/ReputationPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Reputation panel (Phase 3). Honest NOT_CONNECTED today
//  (no GBP/GSC), with the concrete steps to connect each source. No
//  fabricated ratings or impressions.
// ═══════════════════════════════════════════════════════════════════

import { labeled } from '@/lib/bandilero/confidence';
import type { ReputationStatus } from '@/lib/bandilero/services/reputation';
import { MetricCard } from './MetricCard';

function ConnectSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div style={{
      padding: '11px 13px', borderRadius: 12,
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#cfd6e6', marginBottom: 7 }}>{title}</div>
      <ol style={{ margin: 0, paddingLeft: 18, color: '#9aa3b2', fontSize: 11.5, lineHeight: 1.55 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  );
}

export function ReputationPanel({ status }: { status: ReputationStatus }) {
  const m = status.metrics;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="bandilero-grid">
        <MetricCard metric={labeled(m.reviewScore, 'Review score', 'count')} />
        <MetricCard metric={labeled(m.reviewCount, 'Reviews', 'count')} />
        <MetricCard metric={labeled(m.gbpViews, 'GBP views', 'count')} />
        <MetricCard metric={labeled(m.searchImpressions, 'Search impressions', 'count')} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ConnectSteps title="Connect Google Business Profile" steps={status.connectStepsGbp} />
        <ConnectSteps title="Connect Search Console" steps={status.connectStepsGsc} />
      </div>

      <div style={{ fontSize: 10.5, color: '#8b93a3', lineHeight: 1.4 }}>
        Review replies are draft-for-approval — Bandilero drafts, you post. Nothing is auto-published.
      </div>
    </div>
  );
}
