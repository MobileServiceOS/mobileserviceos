// src/components/bandilero/GrowthPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Growth & Recommendations panel (Phase 3).
//
//  The unified, impact-ranked recommendation list (alerts + risks +
//  pricing). Dollar impacts are financial → the whole panel is redacted
//  for technicians (never faked). The AI synthesis narrative is
//  optional (NOT_CONNECTED when AI is off).
// ═══════════════════════════════════════════════════════════════════

import type { Action } from '@/lib/bandilero/types';
import type { Metric } from '@/lib/bandilero/confidence';
import { ActionCard } from './ActionCard';

export function GrowthPanel({
  recommendations, narrative, canViewFinancials,
}: { recommendations: Action[]; narrative: Metric<string>; canViewFinancials: boolean }) {
  if (!canViewFinancials) {
    return (
      <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        🔒 Growth recommendations (dollar impact) are available to owners and admins.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        padding: '11px 13px', borderRadius: 12,
        background: 'rgba(34,227,163,0.06)', border: '1px solid rgba(34,227,163,0.14)',
        fontSize: 12, lineHeight: 1.5, color: narrative.state === 'NOT_CONNECTED' ? '#8b93a3' : '#cfe9dd',
      }}>
        {narrative.state === 'NOT_CONNECTED'
          ? 'AI growth synthesis is not connected — the ranked opportunities below are computed deterministically.'
          : narrative.value}
      </div>

      {recommendations.length === 0 ? (
        <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          No opportunities above threshold right now.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recommendations.map((a, i) => <ActionCard key={a.id} action={a} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}
