// src/components/bandilero/ModuleHeader.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — module section header with a Data-Confidence badge.
//  Reusable across every intelligence module.
// ═══════════════════════════════════════════════════════════════════

import type { ModuleStatus } from '@/lib/bandilero/moduleStatus';

const STATUS: Record<ModuleStatus, { label: string; dot: string; fg: string; bg: string }> = {
  CONNECTED:     { label: 'CONNECTED',     dot: '#22d3ee', fg: '#9bf0fb', bg: 'rgba(34,211,238,0.12)' },
  PARTIAL:       { label: 'PARTIAL',       dot: '#ffcf5c', fg: '#ffe39a', bg: 'rgba(255,207,92,0.12)' },
  NOT_CONNECTED: { label: 'NOT CONNECTED', dot: '#6b7280', fg: '#9aa3b2', bg: 'rgba(120,130,150,0.12)' },
};

export function ModuleHeader({ title, status }: { title: string; status?: ModuleStatus }) {
  const s = status ? STATUS[status] : null;
  return (
    <div className="bandilero-section-title" style={{ justifyContent: 'space-between' }}>
      <span>{title}</span>
      {s && (
        <span
          aria-label={`Data: ${s.label}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
            padding: '2px 7px', borderRadius: 999,
            color: s.fg, background: s.bg, border: `1px solid ${s.dot}33`,
            textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden="true" className={status === 'CONNECTED' ? 'bnd-dot-live' : undefined}
            style={{ width: 6, height: 6, borderRadius: 999, background: s.dot, boxShadow: status === 'CONNECTED' ? `0 0 7px ${s.dot}` : 'none' }} />
          {s.label}
        </span>
      )}
    </div>
  );
}
