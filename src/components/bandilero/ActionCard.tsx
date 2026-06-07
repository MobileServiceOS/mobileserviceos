// src/components/bandilero/ActionCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — a single Top-3 Action.
//
//  Every action is backed by a real number (its dollar impact) and a
//  source. The impact carries its own confidence state (LIVE for real
//  dollars, EST for modeled) — shown via the badge so the operator
//  knows whether the figure is measured or estimated.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import { hasValue } from '@/lib/bandilero/confidence';
import type { Action, ActionSeverity } from '@/lib/bandilero/types';
import { ConfidenceBadge } from './ConfidenceBadge';

const SEV: Record<ActionSeverity, string> = {
  high: '#ff6b6b', medium: '#ffcf5c', low: '#5cc8ff',
};

export function ActionCard({ action, rank }: { action: Action; rank: number }) {
  const accent = SEV[action.severity];
  return (
    <div
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        padding: '13px 14px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.035)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div style={{
        fontSize: 13, fontWeight: 800, color: accent,
        width: 22, height: 22, flexShrink: 0,
        display: 'grid', placeItems: 'center',
        borderRadius: 8, background: `${accent}1a`,
      }}>{rank}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#f3f5f9' }}>{action.title}</span>
          {hasValue(action.impact) && (
            <span style={{ fontSize: 14, fontWeight: 800, color: accent, whiteSpace: 'nowrap' }}>
              {money(action.impact.value)}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3, #9aa3b2)', marginTop: 3, lineHeight: 1.35 }}>
          {action.detail}
        </div>
        <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ConfidenceBadge state={action.impact.state} />
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color: '#7e8798', textTransform: 'uppercase' }}>
            Source: {action.source}
          </span>
          {action.impact.state === 'ESTIMATED' && action.impact.assumption && (
            <span style={{ fontSize: 9.5, color: '#9aa3b2' }}>· {action.impact.assumption}</span>
          )}
        </div>
      </div>
    </div>
  );
}
