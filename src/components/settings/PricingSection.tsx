import type { Settings as SettingsT, ServicePricing } from '@/types';
import { NumberField } from '@/components/NumberField';
import { money } from '@/lib/utils';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useDirtyDraft } from '@/lib/useDirtyDraft';
import { AccordionShell } from '@/components/settings/AccordionShell';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
//  Pricing accordion (services only)
// ─────────────────────────────────────────────────────────────────────

export function PricingAccordion({ settings, onSave, open, onToggle }: Props & { open: boolean; onToggle: () => void }) {
  const sp = settings.servicePricing || {};
  const enabledCount = Object.values(sp).filter((s) => s && s.enabled !== false).length;
  const totalCount = Object.keys(sp).length;
  const maxPrice = Object.values(sp).reduce((m, s) => Math.max(m, Number(s?.basePrice || 0)), 0);
  const summary = totalCount > 0
    ? `${enabledCount} of ${totalCount} services enabled · Max ${money(maxPrice)}`
    : 'No services configured';

  return (
    <AccordionShell title="Pricing" icon="💰" summary={summary} open={open} onToggle={onToggle}>
      <PricingForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function PricingForm({ settings, onSave }: Props) {
  // Active vertical's canonical service catalog. The editor lists
  // ONLY services declared in the vertical's config — so a mechanic
  // account never shows leftover tire services and vice versa. User-
  // edited prices from settings.servicePricing still win on a per-
  // service basis; absent services fall back to the vertical's
  // defaults (basePrice / minProfit / enabledByDefault).
  const vertical = useActiveVertical();
  // Dirty-aware draft of the servicePricing map. See useDirtyDraft.
  const {
    draft: sp,
    dirty,
    replace: setSp,
    markClean,
  } = useDirtyDraft<Record<string, ServicePricing>>(settings.servicePricing || {});

  // Resolve the canonical list of service IDs to render — vertical
  // catalog order, ALL services (including ones the operator hasn't
  // customized yet, which fall back to defaults from the config).
  const renderableServices = vertical.services.map((svc) => {
    const stored = sp[svc.id];
    return {
      id: svc.id,
      label: svc.label,
      basePrice: stored?.basePrice ?? svc.defaultBasePrice,
      minProfit: stored?.minProfit ?? svc.defaultMinProfit,
      enabled: stored?.enabled ?? svc.enabledByDefault,
    };
  });

  const updateService = (k: string, patch: Partial<ServicePricing>) => {
    setSp({ ...sp, [k]: { ...sp[k], ...patch } });
  };

  const save = async () => {
    try { await onSave({ servicePricing: sp }); markClean(); } catch { /* */ }
  };

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
        Service base price + min profit per row.
      </div>

      {/* Compact pricing rows — table-style. Each row: name, base, min profit,
          enabled toggle. Fits ~5 services on a typical phone screen instead
          of the ~2 you'd get with the stacked-card layout. */}
      <div style={{
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {renderableServices.map((row, idx) => (
          <div
            key={row.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 70px 70px 50px',
              gap: 8,
              alignItems: 'center',
              padding: '8px 10px',
              borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
              opacity: row.enabled ? 1 : 0.55,
              transition: 'opacity .15s ease',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.label}
            </div>
            <NumberField
              value={row.basePrice}
              onChange={(n) => updateService(row.id, { basePrice: n })}
              placeholder="Base"
              disabled={!row.enabled}
            />
            <NumberField
              value={row.minProfit}
              onChange={(n) => updateService(row.id, { minProfit: n })}
              placeholder="Profit"
              disabled={!row.enabled}
            />
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              cursor: 'pointer', minHeight: 32,
            }}>
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => updateService(row.id, { enabled: e.target.checked })}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </label>
          </div>
        ))}
      </div>

      <div style={{
        fontSize: 10, color: 'var(--t3)', marginTop: 8,
        display: 'grid', gridTemplateColumns: '1fr 70px 70px 50px', gap: 8, padding: '0 10px',
      }}>
        <span>Service</span>
        <span style={{ textAlign: 'left' }}>Base $</span>
        <span style={{ textAlign: 'left' }}>Profit $</span>
        <span style={{ textAlign: 'right' }}>On</span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 14 }}>
        Estimated travel charge for 10 mi: {money(Math.max(0, 10 - (settings.freeMilesIncluded || 0)) * (settings.costPerMile || 0))}
      </div>

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 14, width: '100%' }}>
          Save Pricing
        </button>
      )}
    </>
  );
}
