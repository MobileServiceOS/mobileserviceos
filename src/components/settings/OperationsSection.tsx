import type { Settings as SettingsT } from '@/types';
import { NumberField } from '@/components/NumberField';
import { money } from '@/lib/utils';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { useDirtyDraft } from '@/lib/useDirtyDraft';

// ─────────────────────────────────────────────────────────────────────
//  Operations & Goals — the operational-rhythm settings every vertical
//  uses. Carved out of the old Business junk drawer so the operator
//  doesn't have to scroll past tire-specific profit targets, mechanic
//  defaults, and owner splits just to change their weekly goal.
//
//  Owns:
//    • weeklyGoal              — revenue target for the goal ring
//    • workWeekStartDay        — anchors all weekly rollups
//    • technicianWeeklyJobsGoal — per-tech goal shown on the tech hero
//    • costPerMile             — travel surcharge per job
//    • freeMilesIncluded       — pre-charge-free distance
//    • taxRate                 — sales tax on the job itself
//
//  invoiceTaxRate moves to the new Invoices section in Phase 2 so the
//  job-level tax and the invoice line-item tax stay clearly separate.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

export function OperationsAccordion({
  settings, onSave, open, onToggle,
}: Props & { open: boolean; onToggle: () => void }) {
  const summary = `Goal ${money(settings.weeklyGoal || 0)} · ${settings.taxRate || 0}% tax · ${money(settings.costPerMile || 0)}/mi`;

  return (
    <AccordionShell title="Goals & Operations" icon="🎯" summary={summary} open={open} onToggle={onToggle}>
      <OperationsForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function OperationsForm({ settings, onSave }: Props) {
  const { draft, dirty, set, markClean } = useDirtyDraft<SettingsT>(settings);

  const save = async () => {
    try { await onSave(draft); markClean(); } catch { /* toast in caller */ }
  };

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Weekly revenue goal ($)</label>
          <NumberField value={draft.weeklyGoal} onChange={(n) => set('weeklyGoal', n)} placeholder="1500" />
        </div>
        <div className="field">
          <label>Tax rate (%)</label>
          <NumberField value={draft.taxRate} onChange={(n) => set('taxRate', n)} placeholder="0" />
        </div>
      </div>

      {/* Work-week start day — affects Dashboard "This Week's Profit"
          and Payouts "Week's Earnings" rollups. Default is Monday (1),
          which matches the ISO standard. Some operators run Sat→Fri
          or Sun→Sat — this lets each business align the rollup with
          their actual operational week. */}
      <div className="field-row">
        <div className="field">
          <label>Work week starts on</label>
          <select
            value={typeof draft.workWeekStartDay === 'number' ? draft.workWeekStartDay : 1}
            onChange={(e) => set('workWeekStartDay', Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
            <option value={2}>Tuesday</option>
            <option value={3}>Wednesday</option>
            <option value={4}>Thursday</option>
            <option value={5}>Friday</option>
            <option value={6}>Saturday</option>
          </select>
        </div>
        <div className="field">
          <label>Technician weekly jobs goal</label>
          <NumberField
            value={draft.technicianWeeklyJobsGoal ?? 5}
            onChange={(n) => set('technicianWeeklyJobsGoal', n)}
            decimals={false}
            placeholder="5"
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Cost per mile ($)</label>
          <NumberField value={draft.costPerMile} onChange={(n) => set('costPerMile', n)} placeholder="0" />
        </div>
        <div className="field">
          <label>Free miles included</label>
          <NumberField
            value={draft.freeMilesIncluded || 0}
            onChange={(n) => set('freeMilesIncluded', n)}
            decimals={false}
            placeholder="0"
          />
        </div>
      </div>

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 12, width: '100%' }}>
          Save Operations
        </button>
      )}
    </>
  );
}
