// src/components/bandilero/InventoryIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Inventory intelligence panel (Phase 3). Operational.
// ═══════════════════════════════════════════════════════════════════

import { labeled } from '@/lib/bandilero/confidence';
import type { InventoryIntel } from '@/lib/bandilero/services/inventoryIntel';
import { MetricCard } from './MetricCard';

export function InventoryIntelPanel({ intel }: { intel: InventoryIntel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="bandilero-grid">
        <MetricCard metric={labeled(intel.reorderCount, 'Reorder now', 'count')} />
        <MetricCard metric={labeled(intel.deadValue, 'Dead stock value', 'money')} />
      </div>

      {intel.topSellerSize && (
        <div style={{ fontSize: 11.5, color: '#9aa3b2' }}>
          Top seller (30d): <span style={{ color: '#e8ebf2', fontWeight: 700 }}>{intel.topSellerSize}</span>
        </div>
      )}

      {intel.reorderList.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
            Restock priority (in-demand, low stock)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {intel.reorderList.map((s) => (
              <div key={s.item.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                padding: '8px 11px', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600 }}>
                  {s.item.size || s.item.partName || 'Item'}
                </span>
                <span style={{ fontSize: 11, color: '#9aa3b2', whiteSpace: 'nowrap' }}>
                  {s.demand} sold · {Number(s.item.qty || 0)} on hand
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
