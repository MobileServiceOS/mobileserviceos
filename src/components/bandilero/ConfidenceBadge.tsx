// src/components/bandilero/ConfidenceBadge.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Data Confidence badge.
//
//  Makes LIVE / ESTIMATED / NOT_CONNECTED visually distinguishable, per
//  the non-negotiable rule that the three states must read differently
//  so a modeled or missing value can never masquerade as real data.
// ═══════════════════════════════════════════════════════════════════

import type { ConfidenceState } from '@/lib/bandilero/confidence';

const STYLE: Record<ConfidenceState, { label: string; dot: string; fg: string; bg: string }> = {
  LIVE:          { label: 'LIVE',          dot: '#22e3a3', fg: '#7ef7cf', bg: 'rgba(34,227,163,0.12)' },
  ESTIMATED:     { label: 'EST',           dot: '#ffcf5c', fg: '#ffe39a', bg: 'rgba(255,207,92,0.12)' },
  NOT_CONNECTED: { label: 'NOT CONNECTED', dot: '#6b7280', fg: '#9aa3b2', bg: 'rgba(120,130,150,0.12)' },
};

export function ConfidenceBadge({ state }: { state: ConfidenceState }) {
  const s = STYLE[state];
  return (
    <span
      aria-label={`Data state: ${s.label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6,
        padding: '2px 7px', borderRadius: 999,
        color: s.fg, background: s.bg,
        border: `1px solid ${s.dot}33`,
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{
        width: 6, height: 6, borderRadius: 999, background: s.dot,
        boxShadow: state === 'LIVE' ? `0 0 6px ${s.dot}` : 'none',
      }} />
      {s.label}
    </span>
  );
}
