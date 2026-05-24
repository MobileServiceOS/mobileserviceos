import type { Settings as SettingsT } from '@/types';
import { NumberField } from '@/components/NumberField';
import { money } from '@/lib/utils';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useDirtyDraft } from '@/lib/useDirtyDraft';

// ─────────────────────────────────────────────────────────────────────
//  Profit Targets — the per-vertical numbers that shape the pricing
//  engine's "Suggested" tile. Carved out of the old Business junk
//  drawer so operators can find them under a clear, vertical-aware
//  heading.
//
//  Tire vertical owns:
//    • tireRepairTargetProfit
//    • tireReplacementTargetProfit
//
//  Mechanic vertical owns the runtime override fields stored on
//  Settings (separate from vertical.pricingModel which is the
//  read-only catalog):
//    • laborRate              — override for the suggested labor rate
//    • partsMarkupDefault     — markup multiplier on part cost
//    • lowStockThreshold      — inventory warning threshold
//
//  Detailing has no editable targets yet (Phase 2.3 ships them);
//  the section hides for that vertical.
//
//  Mechanic warranty policy moves to the new Invoices section in
//  Phase 2 — it's about what prints on the invoice, not about how
//  the engine prices a job.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

export function ProfitTargetsAccordion({
  settings, onSave, open, onToggle,
}: Props & { open: boolean; onToggle: () => void }) {
  const vertical = useActiveVertical();

  // Tire shows the two profit-target inputs. Mechanic shows labor /
  // markup / low-stock. Detailing has no editable targets yet, so
  // the section is hidden via the visibility check below.
  const isTire = vertical.key === 'tire';
  const isMechanic = vertical.key === 'mechanic';
  if (!isTire && !isMechanic) return null;

  const summary = isTire
    ? `Repair ${money(settings.tireRepairTargetProfit || 0)} · Replace ${money(settings.tireReplacementTargetProfit || 0)}`
    : `Labor ${money(settings.laborRate ?? 95)}/hr · Parts ×${settings.partsMarkupDefault ?? 1.5}`;

  return (
    <AccordionShell title="Profit Targets" icon="💰" summary={summary} open={open} onToggle={onToggle}>
      <ProfitTargetsForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function ProfitTargetsForm({ settings, onSave }: Props) {
  const vertical = useActiveVertical();
  const { draft, dirty, set, markClean } = useDirtyDraft<SettingsT>(settings);

  const save = async () => {
    try { await onSave(draft); markClean(); } catch { /* toast in caller */ }
  };

  return (
    <>
      {vertical.key === 'tire' && (
        <div className="field-row">
          <div className="field">
            <label>Flat repair target profit ($)</label>
            <NumberField
              value={draft.tireRepairTargetProfit || 0}
              onChange={(n) => set('tireRepairTargetProfit', n)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label>Replacement target profit ($)</label>
            <NumberField
              value={draft.tireReplacementTargetProfit || 0}
              onChange={(n) => set('tireReplacementTargetProfit', n)}
              placeholder="0"
            />
          </div>
        </div>
      )}

      {vertical.key === 'mechanic' && (
        <>
          <div className="field-row">
            <div className="field">
              <label>Labor rate ($/hr)</label>
              <NumberField
                value={draft.laborRate ?? 95}
                onChange={(n) => set('laborRate', n)}
                placeholder="95"
              />
            </div>
            <div className="field">
              <label>Parts markup default (×)</label>
              <NumberField
                value={draft.partsMarkupDefault ?? 1.5}
                onChange={(n) => set('partsMarkupDefault', n)}
                placeholder="1.5"
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Low-stock threshold</label>
              <NumberField
                value={draft.lowStockThreshold ?? 2}
                onChange={(n) => set('lowStockThreshold', n)}
                decimals={false}
                placeholder="2"
              />
            </div>
          </div>
        </>
      )}

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 12, width: '100%' }}>
          Save Profit Targets
        </button>
      )}
    </>
  );
}
