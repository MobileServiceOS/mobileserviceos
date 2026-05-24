import { useState } from 'react';
import type { Brand, Settings as SettingsT } from '@/types';
import { NumberField } from '@/components/NumberField';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { useBrand } from '@/context/BrandContext';
import { useDirtyDraft } from '@/lib/useDirtyDraft';
import { addToast } from '@/lib/toast';

// ─────────────────────────────────────────────────────────────────────
//  Invoices — every-vertical invoice configuration. Replaces the
//  previously-bifurcated state where some invoice fields lived on
//  Settings (invoiceTaxRate, warrantyPolicy) and some on Brand
//  (invoiceFooter, warrantyEnabled, warrantyText), and NONE had a
//  user-facing editor.
//
//  Owns:
//    settings.invoiceTaxRate    — sales-tax line on the invoice
//    settings.warrantyPolicy    — universal warranty footer text
//                                  (was buried in mechanic-only Business
//                                  section before Phase 1 cleanup)
//    brand.invoiceFooter        — Pro white-label footer
//    brand.warrantyEnabled +    — dedicated warranty box (Pro-gated
//    brand.warrantyText           at invoice render time)
//
//  Both persistence paths are required: Settings fields flow through
//  the onSave callback (operational_settings/main), Brand fields
//  flow through BrandContext.updateBrand (brand doc). Save fires
//  both writes; toast covers the failure of either.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

export function InvoicesAccordion({
  settings, onSave, open, onToggle,
}: Props & { open: boolean; onToggle: () => void }) {
  const summary =
    `${settings.invoiceTaxRate || 0}% tax`
    + (settings.warrantyPolicy ? ' · warranty set' : '');

  return (
    <AccordionShell title="Invoices" icon="🧾" summary={summary} open={open} onToggle={onToggle}>
      <InvoicesForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function InvoicesForm({ settings, onSave }: Props) {
  const { brand, updateBrand } = useBrand();
  // Two parallel dirty-aware drafts — one per persistence path.
  // The form save button is enabled when EITHER is dirty.
  const sDraft = useDirtyDraft<SettingsT>(settings);
  const bDraft = useDirtyDraft<Brand>(brand);
  const [saving, setSaving] = useState(false);

  const dirty = sDraft.dirty || bDraft.dirty;

  const save = async () => {
    setSaving(true);
    try {
      // Only push the fields this section owns from each draft. Avoids
      // accidentally overwriting unrelated Brand or Settings fields
      // that another section may have edited in parallel.
      if (sDraft.dirty) {
        await onSave({
          invoiceTaxRate: sDraft.draft.invoiceTaxRate,
          warrantyPolicy: sDraft.draft.warrantyPolicy,
        });
        sDraft.markClean();
      }
      if (bDraft.dirty) {
        await updateBrand({
          invoiceFooter: bDraft.draft.invoiceFooter,
          warrantyEnabled: bDraft.draft.warrantyEnabled,
          warrantyText: bDraft.draft.warrantyText,
        });
        bDraft.markClean();
      }
      addToast('Invoice settings saved', 'success');
    } catch {
      addToast('Could not save invoice settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Tax line — the single most important field, surfaces first. */}
      <div className="field">
        <label>Sales tax rate on invoices (%)</label>
        <NumberField
          value={sDraft.draft.invoiceTaxRate}
          onChange={(n) => sDraft.set('invoiceTaxRate', n)}
          placeholder="0"
        />
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, lineHeight: 1.5 }}>
          Applied to the invoice subtotal. Leave at 0 if you don't
          collect sales tax (e.g. labor-only services in your state).
        </div>
      </div>

      {/* Warranty footer policy — universal, no Pro gate. Was
          previously buried in the mechanic-only Business form; now
          available to every vertical (tire shops + detailers also
          offer warranties). */}
      <div className="field">
        <label>Warranty / policy footer</label>
        <textarea
          value={sDraft.draft.warrantyPolicy ?? ''}
          onChange={(e) => sDraft.set('warrantyPolicy', e.target.value)}
          rows={2}
          placeholder="e.g. All parts carry manufacturer warranty. Labor warranty: 30 days."
          style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 8 }}
        />
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, lineHeight: 1.5 }}>
          Printed at the bottom of every invoice, regardless of vertical.
        </div>
      </div>

      {/* Dedicated warranty box (Pro feature) — toggle + body text.
          Renders as a highlighted box on the invoice rather than
          plain footer text, so it carries more visual weight when
          the operator wants the warranty to stand out. */}
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(bDraft.draft.warrantyEnabled)}
            onChange={(e) => bDraft.set('warrantyEnabled', e.target.checked)}
          />
          Show a highlighted warranty box on invoices
        </label>
        {bDraft.draft.warrantyEnabled && (
          <textarea
            value={bDraft.draft.warrantyText ?? ''}
            onChange={(e) => bDraft.set('warrantyText', e.target.value)}
            rows={2}
            placeholder="e.g. 90-day workmanship warranty on eligible services."
            style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 8, marginTop: 8 }}
          />
        )}
      </div>

      {/* Custom footer — white-label slot for branding / contact
          repeats / pay-by links. */}
      <div className="field">
        <label>Custom invoice footer (optional)</label>
        <textarea
          value={bDraft.draft.invoiceFooter ?? ''}
          onChange={(e) => bDraft.set('invoiceFooter', e.target.value)}
          rows={2}
          placeholder="Thanks for your business! Pay online: …"
          style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 8 }}
        />
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, lineHeight: 1.5 }}>
          Appears above the warranty footer. Keep it short — invoice
          space is precious.
        </div>
      </div>

      {dirty && (
        <button
          className="btn primary"
          onClick={save}
          disabled={saving}
          style={{ marginTop: 12, width: '100%' }}
        >
          {saving ? 'Saving…' : 'Save Invoice Settings'}
        </button>
      )}
    </>
  );
}
