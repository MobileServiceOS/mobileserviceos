import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { addToast } from '@/lib/toast';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { NumberField } from '@/components/NumberField';
import { useDirtyDraft } from '@/lib/useDirtyDraft';
import {
  DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS,
  type TireQuoteEngineSettings,
  type RoundPriceTo,
} from '@/lib/tireQuoteTypes';

// ─────────────────────────────────────────────────────────────────────
//  src/components/settings/TireQuoteEngineSection.tsx
//  Phase 2 of the Tire Quote Engine.
//
//  Accordion exposing every pricing knob that drives quote totals.
//  Lives on the Settings page right after Profit Targets. Owner/admin
//  only — gated at the Settings registration level via
//  permissions.canEditPricingSettings.
//
//  Data lives in its own per-business doc:
//    businesses/{businessId}/pricingSettings/tireQuoteEngine
//
//  This is SEPARATE from settings/main — the Tire Quote Engine is a
//  feature-scoped config bundle, not a global business setting. Keeps
//  the surface narrow and the doc small.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onToggle: () => void;
}

export function TireQuoteEngineAccordion({ open, onToggle }: Props) {
  const { businessId } = useBrand();
  const [upstream, setUpstream] = useState<TireQuoteEngineSettings>(
    DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS,
  );
  const [loading, setLoading] = useState(true);

  // Subscribe to the per-business pricingSettings doc. Single-doc
  // listener (cheap) — keeps the local draft in sync if the operator
  // edits from another tab.
  useEffect(() => {
    if (!businessId || !_db) { setLoading(false); return; }
    const ref = doc(_db, 'businesses', businessId, 'pricingSettings', 'tireQuoteEngine');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<TireQuoteEngineSettings>;
          // Merge with defaults so a partial doc still produces a
          // complete object the form can render.
          setUpstream({ ...DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS, ...data });
        }
        setLoading(false);
      },
      (err) => {
        console.warn('[TireQuoteEngineSection] listener error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [businessId]);

  const summary = `Used $${upstream.defaultProfitTargetUsed} · New $${upstream.defaultProfitTargetNew} · Travel $${upstream.defaultTravelFee} · Tax ${(upstream.taxRate * 100).toFixed(1)}%`;

  return (
    <AccordionShell
      title="Tire Quote Engine"
      icon="🛞"
      summary={summary}
      open={open}
      onToggle={onToggle}
      badge="NEW"
    >
      {loading ? (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--t3)' }}>Loading…</div>
      ) : (
        <TireQuoteEngineForm upstream={upstream} businessId={businessId} />
      )}
    </AccordionShell>
  );
}

interface FormProps {
  upstream: TireQuoteEngineSettings;
  businessId: string | null;
}

function TireQuoteEngineForm({ upstream, businessId }: FormProps) {
  const { draft, dirty, set, markClean } = useDirtyDraft<TireQuoteEngineSettings>(upstream);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!businessId || !_db) return;
    setBusy(true);
    try {
      const ref = doc(_db, 'businesses', businessId, 'pricingSettings', 'tireQuoteEngine');
      await setDoc(ref, draft, { merge: true });
      markClean();
      addToast('Tire Quote Engine settings saved', 'success');
    } catch (e) {
      addToast(`Save failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ─── Profit targets ──────────────────────────────────────── */}
      <Group title="Profit targets">
        <div className="field-row">
          <Field label="Used tires ($/quote)">
            <NumberField
              value={draft.defaultProfitTargetUsed}
              onChange={(v) => set('defaultProfitTargetUsed', v)}
            />
          </Field>
          <Field label="New tires ($/quote)">
            <NumberField
              value={draft.defaultProfitTargetNew}
              onChange={(v) => set('defaultProfitTargetNew', v)}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Premium tires ($/quote)">
            <NumberField
              value={draft.defaultProfitTargetPremium}
              onChange={(v) => set('defaultProfitTargetPremium', v)}
            />
          </Field>
          <Field label="Minimum profit floor ($)">
            <NumberField
              value={draft.minimumProfit}
              onChange={(v) => set('minimumProfit', v)}
            />
          </Field>
        </div>
      </Group>

      {/* ─── Service fees ────────────────────────────────────────── */}
      <Group title="Service fees">
        <div className="field-row">
          <Field label="Travel fee ($)">
            <NumberField
              value={draft.defaultTravelFee}
              onChange={(v) => set('defaultTravelFee', v)}
            />
          </Field>
          <Field label="Per-mile fee ($/mi)">
            <NumberField
              value={draft.perMileFee}
              onChange={(v) => set('perMileFee', v)}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Free miles included">
            <NumberField
              value={draft.freeMilesIncluded}
              onChange={(v) => set('freeMilesIncluded', v)}
            />
          </Field>
          <Field label="Same-day fee ($)">
            <NumberField
              value={draft.sameDayFee}
              onChange={(v) => set('sameDayFee', v)}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Emergency fee ($)">
            <NumberField
              value={draft.emergencyFee}
              onChange={(v) => set('emergencyFee', v)}
            />
          </Field>
          <Field label="After-hours fee ($)">
            <NumberField
              value={draft.afterHoursFee}
              onChange={(v) => set('afterHoursFee', v)}
            />
          </Field>
        </div>
      </Group>

      {/* ─── Tax + price display ─────────────────────────────────── */}
      <Group title="Tax + price display">
        <div className="field-row">
          <Field label="Tax rate (%)">
            <NumberField
              value={draft.taxRate * 100}
              onChange={(v) => set('taxRate', Math.max(0, v) / 100)}
            />
          </Field>
          <Field label="Round prices to nearest">
            <select
              value={draft.roundPriceTo}
              onChange={(e) => set('roundPriceTo', Number(e.target.value) as RoundPriceTo)}
              style={selectStyle}
            >
              <option value={5}>$5 ($75, $80, $85)</option>
              <option value={9}>$9 endings ($79, $89, $99)</option>
              <option value={10}>$10 ($70, $80, $90)</option>
            </select>
          </Field>
        </div>
        <Toggle
          label="Show tax-included price to customers"
          value={draft.showTaxIncludedPrice}
          onChange={(v) => set('showTaxIncludedPrice', v)}
        />
        <Toggle
          label="Show cash + card prices side-by-side"
          value={draft.cashPriceEnabled}
          onChange={(v) => set('cashPriceEnabled', v)}
        />
      </Group>

      {dirty && (
        <button
          className="btn primary"
          onClick={handleSave}
          disabled={busy}
          style={{ width: '100%', marginTop: 6 }}
        >
          {busy ? 'Saving…' : 'Save Tire Quote Engine settings'}
        </button>
      )}
    </div>
  );
}

// ─── Tiny presentational helpers ───────────────────────────────────

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--s2)',
  color: 'var(--t1)',
  fontSize: 14,
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
