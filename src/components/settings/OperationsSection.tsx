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
//    • taxRate                 — income-tax RESERVE percentage. NOT
//                                 sales tax. Drives the "Tax reserve"
//                                 number on the Payouts page so the
//                                 operator sees how much to set aside
//                                 each week for self-employment tax.
//                                 The customer-facing SALES tax is a
//                                 separate setting (settings.invoiceTaxRate)
//                                 configured under the Invoices accordion
//                                 and rendered on the invoice PDF.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

export function OperationsAccordion({
  settings, onSave, open, onToggle,
}: Props & { open: boolean; onToggle: () => void }) {
  const summary = `Goal ${money(settings.weeklyGoal || 0)} · ${settings.taxRate || 0}% reserve · ${money(settings.costPerMile || 0)}/mi`;

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
          <label htmlFor="settings-weekly-goal">Weekly revenue goal ($)</label>
          <NumberField id="settings-weekly-goal" value={draft.weeklyGoal} onChange={(n) => set('weeklyGoal', n)} placeholder="1500" />
        </div>
        <div className="field">
          <label htmlFor="settings-tax-reserve">Tax reserve (%)</label>
          <NumberField id="settings-tax-reserve" value={draft.taxRate} onChange={(n) => set('taxRate', n)} placeholder="25" />
          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, lineHeight: 1.4 }}>
            How much of net revenue to set aside for income/self-employment tax. Shows on Payouts. <em>This is NOT sales tax</em> — set customer-facing sales tax under Settings → Invoices.
          </div>
        </div>
      </div>

      {/* Work-week start day — affects Dashboard "This Week's Profit"
          and Payouts "Week's Earnings" rollups. Default is Monday (1),
          which matches the ISO standard. Some operators run Sat→Fri
          or Sun→Sat — this lets each business align the rollup with
          their actual operational week. */}
      <div className="field-row">
        <div className="field">
          <label htmlFor="settings-work-week-start">Work week starts on</label>
          <select
            id="settings-work-week-start"
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
          <label htmlFor="settings-tech-weekly-goal">Technician weekly jobs goal</label>
          <NumberField
            id="settings-tech-weekly-goal"
            value={draft.technicianWeeklyJobsGoal ?? 5}
            onChange={(n) => set('technicianWeeklyJobsGoal', n)}
            decimals={false}
            placeholder="5"
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="settings-cost-per-mile">Cost per mile ($)</label>
          <NumberField id="settings-cost-per-mile" value={draft.costPerMile} onChange={(n) => set('costPerMile', n)} placeholder="0" />
        </div>
        <div className="field">
          <label htmlFor="settings-free-miles">Free miles included</label>
          <NumberField
            id="settings-free-miles"
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
