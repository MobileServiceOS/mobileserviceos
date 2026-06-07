// src/components/bandilero/PricingIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Pricing Intelligence panel (Phase 4). DETERMINISTIC.
//
//  Two surfaces: a pricing-health summary and a what-if calculator.
//  Reads the pricing engine read-only — never touches AddJob. Surfaces
//  profit, so it's gated to owners/admins (financial), consistent with
//  the rest of Bandilero.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { money } from '@/lib/utils';
import { labeled } from '@/lib/bandilero/confidence';
import {
  pricingSummary, computePricing, type TimeOfDay, type PricingInput,
} from '@/lib/bandilero/services/pricingIntel';
import type { Job, Lead, InventoryItem, Settings } from '@/types';
import { MetricCard } from './MetricCard';

interface Props {
  jobs: Job[];
  leads: Lead[];
  inventory: InventoryItem[];
  settings: Settings;
  today: string;
  canViewFinancials: boolean;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 9, fontSize: 12.5,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#f3f5f9',
};
const labelStyle: React.CSSProperties = { fontSize: 10.5, color: '#9aa3b2', fontWeight: 700, display: 'block', marginBottom: 4 };

export function PricingIntelPanel({ jobs, leads, inventory, settings, today, canViewFinancials }: Props) {
  const services = useMemo(() => Object.keys(settings.servicePricing || {}), [settings.servicePricing]);
  const vehicles = useMemo(() => Object.keys(settings.vehiclePricing || {}), [settings.vehiclePricing]);
  const sizes = useMemo(
    () => Array.from(new Set(inventory.map((i) => i.size).filter(Boolean))).slice(0, 40),
    [inventory],
  );

  const [input, setInput] = useState<PricingInput>({
    service: services[0] || '', vehicleType: vehicles[0] || '', tireSize: sizes[0] || '',
    city: '', miles: 0, qty: 4, timeOfDay: 'standard',
  });
  const set = <K extends keyof PricingInput>(k: K, v: PricingInput[K]) => setInput((p) => ({ ...p, [k]: v }));

  const summary = useMemo(() => pricingSummary(jobs, settings, today), [jobs, settings, today]);
  const quote = useMemo(
    () => computePricing(input, { jobs, leads, inventory, settings }),
    [input, jobs, leads, inventory, settings],
  );

  if (!canViewFinancials) {
    return (
      <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        🔒 Pricing Intelligence (prices &amp; profit) is available to owners and admins.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── What-if calculator ── */}
      <div style={{ padding: '13px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#cfd6e6', marginBottom: 10, letterSpacing: 0.4 }}>WHAT-IF CALCULATOR</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 9 }}>
          <div>
            <label style={labelStyle}>Service</label>
            <select style={inputStyle} value={input.service} onChange={(e) => set('service', e.target.value)}>
              {services.length === 0 && <option value="">—</option>}
              {services.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Vehicle</label>
            <select style={inputStyle} value={input.vehicleType} onChange={(e) => set('vehicleType', e.target.value)}>
              {vehicles.length === 0 && <option value="">—</option>}
              {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tire size</label>
            <input style={inputStyle} list="bandilero-sizes" value={input.tireSize} onChange={(e) => set('tireSize', e.target.value)} placeholder="225/65R17" />
            <datalist id="bandilero-sizes">{sizes.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label style={labelStyle}>City</label>
            <input style={inputStyle} value={input.city} onChange={(e) => set('city', e.target.value)} placeholder="(optional)" />
          </div>
          <div>
            <label style={labelStyle}>Travel (mi)</label>
            <input style={inputStyle} type="number" inputMode="decimal" value={input.miles} onChange={(e) => set('miles', Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Qty</label>
            <input style={inputStyle} type="number" inputMode="numeric" value={input.qty} onChange={(e) => set('qty', Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Time of day</label>
            <select style={inputStyle} value={input.timeOfDay} onChange={(e) => set('timeOfDay', e.target.value as TimeOfDay)}>
              <option value="standard">Standard</option>
              <option value="late_night">Late night</option>
              <option value="emergency">Emergency</option>
              <option value="weekend">Weekend</option>
            </select>
          </div>
        </div>

        <div className="bandilero-grid" style={{ marginTop: 11 }}>
          <MetricCard metric={labeled(quote.suggestedPrice, 'Suggested price', 'money')} />
          <MetricCard metric={labeled(quote.estimatedProfit, 'Estimated profit', 'money')} />
          <MetricCard metric={labeled(quote.confidence, 'Confidence', 'pct')} />
          <MetricCard metric={labeled(quote.acceptanceRate, 'Acceptance rate', 'pct')} />
        </div>
        <div style={{ fontSize: 10.5, color: '#7e8798', marginTop: 8, lineHeight: 1.4 }}>
          Confidence from {quote.comparableJobs} comparable completed job(s){quote.unitTireCost > 0 ? ` · tire cost ${money(quote.unitTireCost)}/unit from inventory` : ' · no inventory cost for this size'}.
          City scopes the comparison only — it doesn’t change the engine price.
        </div>
      </div>

      {/* ── Pricing-health summary ── */}
      <div>
        <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
          Pricing health — recent sales vs configured minimum
        </div>
        {summary.length === 0 ? (
          <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            Not enough recent sales to summarize pricing yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summary.map((r) => (
              <div key={`${r.service}-${r.size}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                padding: '9px 11px', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderLeft: `3px solid ${r.gapPct < 0 ? '#ffcf5c' : '#22e3a3'}`,
              }}>
                <span style={{ fontSize: 12, color: '#e8ebf2', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.service} · {r.size}
                </span>
                <span style={{ fontSize: 11, color: '#9aa3b2', whiteSpace: 'nowrap' }}>
                  med {money(r.median)} / min {money(r.configuredMin)}
                  {r.suggestedAdjustment > 0 ? <span style={{ color: '#ffcf5c', fontWeight: 700 }}> · +{money(r.suggestedAdjustment)}</span> : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
