import { money } from '@/lib/utils';
import { AccordionShell } from '@/components/settings/AccordionShell';
import type { LaborPartsPricingModel, PackageMultiplierPricingModel } from '@/config/businessTypes/registry';

// ═══════════════════════════════════════════════════════════════════
//  Vertical-specific pricing-defaults accordions
//
//  These are READ-ONLY in Phase 2.1. They surface the active
//  vertical's pricingModel defaults (labor rate / parts markup /
//  diagnostic fee / min service charge for mechanic; vehicle-size
//  multipliers for detailing) so the operator can see the formulas
//  the engine is applying.
//
//  Editing these defaults — wiring them into Settings + the engines
//  as per-business overrides — is deferred to Phase 2.2 (mechanic
//  full slice) and Phase 2.3 (detailing full slice). The
//  abstraction is correct now; what's missing is a couple of
//  optional override fields on the Settings type and a small
//  precedence rule inside each engine. Trivial follow-up work.
// ═══════════════════════════════════════════════════════════════════

export function LaborPartsDefaultsAccordion({
  model, open, onToggle,
}: {
  model: LaborPartsPricingModel;
  open: boolean;
  onToggle: () => void;
}) {
  const summary =
    `Labor ${money(model.defaultLaborRate)}/hr · Parts +${model.defaultPartsMarkupPct}%`;
  return (
    <AccordionShell title="Labor & Parts Defaults" icon="🔧" summary={summary} open={open} onToggle={onToggle}>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
        These defaults drive the suggested price and breakdown
        calculations for every mechanic job. Editing the values is
        coming in Phase 2.2 — for now they reflect the current
        labor+parts pricing engine.
      </div>
      <DefaultsRow label="Labor rate" value={`${money(model.defaultLaborRate)} / hour`} />
      <DefaultsRow label="Parts markup" value={`${model.defaultPartsMarkupPct}%`} />
      <DefaultsRow label="Diagnostic fee" value={`${money(model.defaultDiagnosticFee)} (auto on diagnostic-named services)`} />
      <DefaultsRow label="Min service charge" value={money(model.defaultMinServiceCharge)} />
    </AccordionShell>
  );
}

export function PackageMultiplierDefaultsAccordion({
  model, open, onToggle,
}: {
  model: PackageMultiplierPricingModel;
  open: boolean;
  onToggle: () => void;
}) {
  const sizes = Object.keys(model.vehicleSizeMultipliers);
  const summary = sizes.length === 0
    ? 'No multipliers configured'
    : `${sizes.length} vehicle size${sizes.length === 1 ? '' : 's'}`;
  return (
    <AccordionShell title="Vehicle Size Multipliers" icon="🚗" summary={summary} open={open} onToggle={onToggle}>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
        Package prices are multiplied by these factors per vehicle
        size. Editing is coming in Phase 2.3 alongside the detailing
        full slice — for now this surfaces the current multipliers.
      </div>
      {sizes.map((sz) => (
        <DefaultsRow key={sz} label={sz} value={`×${model.vehicleSizeMultipliers[sz]}`} />
      ))}
    </AccordionShell>
  );
}

function DefaultsRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 4px', borderBottom: '1px solid var(--border2)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--t2)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>{value}</span>
    </div>
  );
}
