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
    <header style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--brand-primary, #6c8cff)', textTransform: 'uppercase' }}>
        Bandilero · Command Center
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f3f5f9', margin: '6px 0 2px', letterSpacing: -0.4 }}>
        {timeOfDayGreeting()}, {who}
      </h1>
      <div style={{ fontSize: 12.5, color: 'var(--t3, #9aa3b2)' }}>
        {greeting.dateLabel}
        {greeting.businessName && greeting.operatorName ? ` · ${greeting.businessName}` : ''}
      </div>
    </header>
  );
}
