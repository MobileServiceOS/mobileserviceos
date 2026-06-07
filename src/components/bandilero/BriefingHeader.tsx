// src/components/bandilero/BriefingHeader.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — daily-briefing header / greeting.
//
//  Greeting pulls operator name + business name from tenant config
//  (passed down from BrandContext / auth). No hardcoded operator name.
// ═══════════════════════════════════════════════════════════════════

import type { BriefingGreeting } from '@/lib/bandilero/types';

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function BriefingHeader({ greeting }: { greeting: BriefingGreeting }) {
  const who = greeting.operatorName || greeting.businessName || 'there';
  return (
    <header style={{ marginBottom: 20 }}>
      <span className="bnd-scan" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.4, color: 'var(--bnd-cyan, #22d3ee)', textTransform: 'uppercase', textShadow: '0 0 12px rgba(34,211,238,0.45)' }}>
        Bandilero · Command Center
      </span>
      <h1 style={{ fontSize: 25, fontWeight: 800, color: '#f3f8ff', margin: '12px 0 2px', letterSpacing: -0.4 }}>
        {timeOfDayGreeting()}, {who}
      </h1>
      <div style={{ fontSize: 12.5, color: 'var(--bnd-t2, #aeb9cc)' }}>
        {greeting.dateLabel}
        {greeting.businessName && greeting.operatorName ? ` · ${greeting.businessName}` : ''}
      </div>
    </header>
  );
}
