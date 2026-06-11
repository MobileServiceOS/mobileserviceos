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

  if (vertical.key !== 'tire') return null;

  const summary = `Repair ${money(settings.tireRepairTargetProfit || 0)} · Replace ${money(settings.tireReplacementTargetProfit || 0)}`;

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
            <label htmlFor="settings-tire-repair-profit">Flat repair target profit ($)</label>
            <NumberField
              id="settings-tire-repair-profit"
              value={draft.tireRepairTargetProfit || 0}
              onChange={(n) => set('tireRepairTargetProfit', n)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="settings-tire-replace-profit">Replacement target profit ($)</label>
            <NumberField
              id="settings-tire-replace-profit"
              value={draft.tireReplacementTargetProfit || 0}
              onChange={(n) => set('tireReplacementTargetProfit', n)}
              placeholder="0"
            />
          </div>
        </div>
      )}

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 12, width: '100%' }}>
          Save Profit Targets
        </button>
      )}
    </>
  );
}
