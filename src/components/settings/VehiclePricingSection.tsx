import { useEffect, useState } from 'react';
import type { Settings as SettingsT, VehiclePricing } from '@/types';
import { NumberField } from '@/components/NumberField';
import { money } from '@/lib/utils';
import { AccordionShell } from '@/components/settings/AccordionShell';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
//  Vehicle Add-ons accordion
// ─────────────────────────────────────────────────────────────────────

export function VehicleAddonsAccordion({ settings, onSave, open, onToggle }: Props & { open: boolean; onToggle: () => void }) {
  const vp = settings.vehiclePricing || {};
  // Surface the two most operationally relevant adders in the preview.
  const suvAddon = Number(vp['SUV/Truck']?.addOnProfit || vp['SUV']?.addOnProfit || 0);
  const semiAddon = Number(vp['Tractor-Trailer']?.addOnProfit || vp['Semi-Truck']?.addOnProfit || vp['Semi']?.addOnProfit || 0);
  const summary = `SUV/Truck ${money(suvAddon)} · Semi ${money(semiAddon)}`;

  return (
    <AccordionShell title="Vehicle Add-ons" icon="🚚" summary={summary} open={open} onToggle={onToggle}>
      <VehicleAddonsForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function VehicleAddonsForm({ settings, onSave }: Props) {
  const [vp, setVp] = useState<Record<string, VehiclePricing>>(settings.vehiclePricing || {});
  const [dirty, setDirty] = useState(false);

  // Dirty-aware re-sync. settings re-emits on every Firestore
  // snapshot (Stripe mirror, services-backfill, etc.). Resetting
  // unconditionally wiped in-progress edits — the production
  // "settings revert" bug on Wheel Rush. Only re-sync when clean.
  useEffect(() => {
    if (!dirty) setVp(settings.vehiclePricing || {});
  }, [settings.vehiclePricing, dirty]);

  const updateVehicle = (k: string, patch: Partial<VehiclePricing>) => {
    setVp((p) => ({ ...p, [k]: { ...p[k], ...patch } })); setDirty(true);
  };

  const save = async () => {
    try { await onSave({ vehiclePricing: vp }); setDirty(false); } catch { /* */ }
  };

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
        Profit add-on per vehicle type, added on top of the service base price.
      </div>

      {/* Compact 2-col rows: vehicle type → input. Right-aligned input,
          consistent width across rows. */}
      <div style={{
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {Object.keys(vp).map((k, idx) => (
          <div
            key={k}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 110px',
              gap: 10,
              alignItems: 'center',
              padding: '10px 12px',
              borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{k}</span>
            <NumberField
              value={vp[k].addOnProfit}
              onChange={(n) => updateVehicle(k, { addOnProfit: n })}
              placeholder="0"
            />
          </div>
        ))}
      </div>

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 14, width: '100%' }}>
          Save Vehicle Add-ons
        </button>
      )}
    </>
  );
}
