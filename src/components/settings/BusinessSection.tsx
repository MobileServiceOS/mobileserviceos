import { useEffect, useState } from 'react';
import type { Settings as SettingsT } from '@/types';
import { NumberField } from '@/components/NumberField';
import { money } from '@/lib/utils';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { useActiveVertical } from '@/lib/useActiveVertical';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
//  Business accordion
// ─────────────────────────────────────────────────────────────────────

export function BusinessAccordion({
  settings, onSave, open, onToggle, showOwners,
}: Props & { open: boolean; onToggle: () => void; showOwners: boolean }) {
  const summary = `Goal ${money(settings.weeklyGoal || 0)} · Repair ${money(settings.tireRepairTargetProfit || 0)} · Replace ${money(settings.tireReplacementTargetProfit || 0)}`;

  return (
    <AccordionShell title="Business" icon="🏢" summary={summary} open={open} onToggle={onToggle}>
      <BusinessForm settings={settings} onSave={onSave} showOwners={showOwners} />
    </AccordionShell>
  );
}

function BusinessForm({ settings, onSave, showOwners }: Props & { showOwners: boolean }) {
  const [draft, setDraft] = useState<SettingsT>(settings);
  const [dirty, setDirty] = useState(false);
  const vertical = useActiveVertical();
  // Dirty-aware re-sync. The parent `settings` reference changes on
  // every Firestore snapshot — including background writes (Stripe
  // mirror, services-backfill loop, other tabs). The previous
  // implementation reset draft + cleared dirty unconditionally, so
  // a snapshot mid-edit wiped the user's in-progress changes.
  // Symptom: "I edit and it goes right back" reported on Wheel Rush.
  // Only re-sync when the user has no unsaved edits.
  useEffect(() => {
    if (!dirty) setDraft(settings);
  }, [settings, dirty]);

  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => {
    setDraft((d) => ({ ...d, [k]: v })); setDirty(true);
  };

  const save = async () => {
    try { await onSave(draft); setDirty(false); } catch { /* toast in caller */ }
  };

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Weekly goal ($)</label>
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

      {vertical.key === 'mechanic' && (
        <>
          <div className="form-group-title" style={{ marginTop: 16, fontSize: 12 }}>Mechanic settings</div>
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
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Warranty policy (printed on invoices)</label>
            <textarea
              value={draft.warrantyPolicy ?? ''}
              onChange={(e) => set('warrantyPolicy', e.target.value)}
              rows={2}
              placeholder="e.g. All parts carry manufacturer warranty. Labor warranty: 30 days."
              style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 8 }}
            />
          </div>
        </>
      )}

      {showOwners && (
        <>
          <div className="form-group-title" style={{ marginTop: 16, fontSize: 12 }}>Owners</div>
          <div className="field-row">
            <div className="field">
              <label>Owner 1 name</label>
              <input value={draft.owner1Name} onChange={(e) => set('owner1Name', e.target.value)} />
            </div>
            <div className="field">
              <label>Split %</label>
              <NumberField
                value={draft.profitSplit1}
                onChange={(n) => set('profitSplit1', n)}
                decimals={false}
                placeholder="50"
              />
            </div>
          </div>
          <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={draft.owner1Active} onChange={(e) => set('owner1Active', e.target.checked)} /> Active
          </label>
          <div className="field-row">
            <div className="field">
              <label>Owner 2 name</label>
              <input value={draft.owner2Name} onChange={(e) => set('owner2Name', e.target.value)} />
            </div>
            <div className="field">
              <label>Split %</label>
              <NumberField
                value={draft.profitSplit2}
                onChange={(n) => set('profitSplit2', n)}
                decimals={false}
                placeholder="50"
              />
            </div>
          </div>
          <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={draft.owner2Active} onChange={(e) => set('owner2Active', e.target.checked)} /> Active
          </label>

          {/* Technician permission gate. Owner-only setting that controls
              whether technicians can manually override the suggested price. */}
          <div style={{
            marginTop: 4, padding: 10, background: 'var(--s2)',
            border: '1px solid var(--border)', borderRadius: 8,
          }}>
            <label style={{ fontSize: 12, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(draft.allowTechnicianPriceOverride)}
                onChange={(e) => set('allowTechnicianPriceOverride', e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--t1)' }}>Allow technicians to override job price</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3, lineHeight: 1.5 }}>
                  When off, technicians can only use the system-suggested price. When on, they can
                  manually adjust revenue on the jobs they log. Pricing settings stay owner-only either way.
                </div>
              </div>
            </label>
          </div>
        </>
      )}

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 12, width: '100%' }}>
          Save Business
        </button>
      )}
    </>
  );
}
