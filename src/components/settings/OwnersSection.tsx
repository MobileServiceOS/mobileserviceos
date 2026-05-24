import type { Settings as SettingsT } from '@/types';
import { NumberField } from '@/components/NumberField';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { useDirtyDraft } from '@/lib/useDirtyDraft';

// ─────────────────────────────────────────────────────────────────────
//  Owners & Permissions — owner names + profit splits + the
//  technician-price-override permission. Gated by canViewFinancials
//  (owner-only at the page level), so this whole accordion stays
//  hidden for admins and technicians.
//
//  Carved out of the old Business junk drawer so the permission gate
//  is now a top-level section rather than a buried gray box at the
//  bottom of an unrelated form.
//
//  Owns:
//    • owner1Name / owner1Active / profitSplit1
//    • owner2Name / owner2Active / profitSplit2
//    • allowTechnicianPriceOverride
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

export function OwnersAccordion({
  settings, onSave, open, onToggle,
}: Props & { open: boolean; onToggle: () => void }) {
  const summary = `${settings.owner1Name || '—'}${settings.owner2Name ? ' · ' + settings.owner2Name : ''}`;

  return (
    <AccordionShell title="Owners & Permissions" icon="👥" summary={summary} open={open} onToggle={onToggle}>
      <OwnersForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function OwnersForm({ settings, onSave }: Props) {
  const { draft, dirty, set, markClean } = useDirtyDraft<SettingsT>(settings);

  const save = async () => {
    try { await onSave(draft); markClean(); } catch { /* toast in caller */ }
  };

  return (
    <>
      <div className="form-group-title" style={{ fontSize: 12 }}>Owners</div>
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
      <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input type="checkbox" checked={draft.owner2Active} onChange={(e) => set('owner2Active', e.target.checked)} /> Active
      </label>

      <div className="form-group-title" style={{ fontSize: 12, marginTop: 4 }}>Permissions</div>
      {/* Technician permission gate — promoted out of its buried-at-
          the-bottom gray box. Now visually anchored as a Permissions
          sub-section that the operator can find without scrolling
          past every other unrelated form. */}
      <div style={{
        padding: 10, background: 'var(--s2)',
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

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 12, width: '100%' }}>
          Save Owners
        </button>
      )}
    </>
  );
}
