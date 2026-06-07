// src/components/bandilero/DispatchPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Dispatch / ETA panel (Phase 2). Operational, all roles.
//  Honest about coverage: route/ETA are ESTIMATED; NOT_CONNECTED until
//  ≥2 of today's jobs are geocoded.
// ═══════════════════════════════════════════════════════════════════

import { labeled } from '@/lib/bandilero/confidence';
import type { DispatchMetrics } from '@/lib/bandilero/services/dispatch';
import { MetricCard } from './MetricCard';

export function DispatchPanel({ metrics }: { metrics: DispatchMetrics }) {
  return (
    <div className="bandilero-grid">
      <MetricCard metric={labeled(metrics.geocodedToday, 'Geocoded jobs today', 'count')} />
      <MetricCard metric={labeled(metrics.coveragePct, 'Location coverage', 'pct')} />
      <MetricCard metric={labeled(metrics.routeMiles, 'Route distance', 'count')} />
      <MetricCard metric={labeled(metrics.driveTimeMin, 'Drive time (min)', 'count')} />
    </div>
  );
}
