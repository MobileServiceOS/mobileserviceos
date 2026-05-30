import { useEffect, useMemo, useState } from 'react';
import {
  doc, onSnapshot, getDocs, collection, setDoc,
} from 'firebase/firestore';
import { _db, scopedCol } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { useMembership } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
import { uid, money } from '@/lib/utils';
import { extractTireSize, normalizeTireSizeQuery } from '@/lib/inventoryNotesParser';
import {
  DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS,
  type TireQuoteEngineSettings,
  type TireSupplierPrice,
  type TireQuote,
  type TireQuoteOption,
  type QuoteOptionTier,
  type QuoteSearchInput,
} from '@/lib/tireQuoteTypes';
import { buildQuoteOptionsFromPrices } from '@/lib/tireQuotePricing';
import { openSmsForQuote, openEmailForQuote } from '@/lib/tireQuoteMessage';
import { QuoteSearchForm, EMPTY_QUOTE_FORM, type QuoteSearchFormValue } from '@/components/tireQuote/QuoteSearchForm';
import { QuoteOptionCard } from '@/components/tireQuote/QuoteOptionCard';

// ─────────────────────────────────────────────────────────────────────
//  src/pages/TireQuoteEngine.tsx — Phase 3 of the Tire Quote Engine.
//
//  Tech-accessible page. Cost/profit columns hide for techs (gate
//  via permissions.canEditPricingSettings). Owners + admins see the
//  full picture.
//
//  Flow:
//    1. Search form at top — size / brand / model / qty + customer info
//    2. Tap "Search Tire Options" → loads matching supplier prices
//       (one-shot getDocs, NOT a long-lived listener — quote searches
//       are punctuated, not continuous)
//    3. buildQuoteOptionsFromPrices() splits into Used + New tracks,
//       picks one option per tier within each track, prices them via
//       the Phase 1 formula
//    4. Results render in two visually-distinct sections (Used /
//       New); tech sees prices only, owner sees prices + cost +
//       profit + supplier
//    5. User picks a tier → action buttons appear (Save / Text /
//       Email / Create Job)
//
//  Mobile-first: search form is collapsible after first search so
//  results take the visual anchor. Pricing is the visual emphasis
//  on every card.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  // TabId from src/types is the canonical tab union; relax to string
  // here so the caller can pass whatever its setTab signature is —
  // this page only ever calls setTab('add').
  setTab?: (tab: never) => void;
  onCreateJobFromQuote?: (quote: TireQuote, option: TireQuoteOption) => void | Promise<void>;
}

export function TireQuoteEngine({ setTab, onCreateJobFromQuote }: Props) {
  const { businessId, brand } = useBrand();
  const { permissions, member } = useMembership();
  const canViewCost = permissions.canEditPricingSettings; // owner + admin

  // ─── Settings (subscribed once) ────────────────────────────────
  const [settings, setSettings] = useState<TireQuoteEngineSettings>(
    DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS,
  );
  useEffect(() => {
    if (!businessId || !_db) return;
    const ref = doc(_db, 'businesses', businessId, 'pricingSettings', 'tireQuoteEngine');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<TireQuoteEngineSettings>;
        setSettings({ ...DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS, ...data });
      }
    }, (err) => console.warn('[TireQuoteEngine] settings listener error:', err));
    return () => unsub();
  }, [businessId]);

  // ─── Search form state ────────────────────────────────────────
  const [form, setForm] = useState<QuoteSearchFormValue>(EMPTY_QUOTE_FORM);
  const [busy, setBusy] = useState(false);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<TireSupplierPrice[] | null>(null);
  const [selected, setSelected] = useState<QuoteOptionTier | null>(null);
  const [showForm, setShowForm] = useState(true);

  const search = async () => {
    if (!businessId || !_db) return;
    setBusy(true);
    setSelected(null);
    try {
      const col = collection(_db, 'businesses', businessId, 'tireSupplierPrices');
      const snap = await getDocs(col);
      const allPrices: TireSupplierPrice[] = [];
      snap.forEach((d) => {
        allPrices.push({ id: d.id, ...(d.data() as Omit<TireSupplierPrice, 'id'>) });
      });

      // Apply search filters in-memory. Phase 3 supports size + brand
      // + model. Size is normalized through extractTireSize so any of
      // 225/65R17, 225/65-17, 225-65-17 match the canonical form.
      const sizeQuery = normalizeTireSizeQuery(form.tireSize.trim().toLowerCase());
      const sizeCanonical = extractTireSize(form.tireSize.trim());
      const brandQuery = form.brand.trim().toLowerCase();
      const modelQuery = form.model.trim().toLowerCase();

      const filtered = allPrices.filter((p) => {
        // Size match (if provided) — canonical equality preferred,
        // substring fallback for partial like "225/65" without rim.
        if (sizeCanonical) {
          if (extractTireSize(p.tireSize) !== sizeCanonical) return false;
        } else if (sizeQuery) {
          if (!(p.tireSize || '').toLowerCase().includes(sizeQuery)) return false;
        }
        // Brand match (if provided)
        if (brandQuery && !(p.brand || '').toLowerCase().includes(brandQuery)) return false;
        // Model match (if provided)
        if (modelQuery && !(p.model || '').toLowerCase().includes(modelQuery)) return false;
        return true;
      });

      setMatches(filtered);
      setSearchedFor(form.tireSize || `${form.brand} ${form.model}`.trim());
      setShowForm(false); // collapse to give results the screen
    } catch (e) {
      addToast(`Search failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Compute the Good/Better/Best + Used Economy/Premium options
  // from the matched supplier rows + current settings.
  const options: TireQuoteOption[] = useMemo(() => {
    if (!matches) return [];
    return buildQuoteOptionsFromPrices(
      matches,
      form.quantity,
      form.urgency,
      form.miles,
      settings,
    );
  }, [matches, form.quantity, form.urgency, form.miles, settings]);

  const usedOptions = options.filter((o) => o.tier === 'used_economy' || o.tier === 'used_premium');
  const newOptions = options.filter((o) => o.tier === 'good' || o.tier === 'better' || o.tier === 'best');

  const selectedOption = useMemo(() => {
    if (!selected) return null;
    return options.find((o) => o.tier === selected) || null;
  }, [selected, options]);

  // ─── Build a TireQuote document from current state ────────────
  const buildQuote = (status: 'draft' | 'sent'): TireQuote => {
    const searchInput: QuoteSearchInput = form.tireSize.trim()
      ? {
          kind: 'size',
          tireSize: extractTireSize(form.tireSize) || form.tireSize,
          brand: form.brand.trim() || undefined,
          model: form.model.trim() || undefined,
        }
      : { kind: 'brandModel', brand: form.brand.trim(), model: form.model.trim() };

    const so = selected ? options.find((o) => o.tier === selected) : null;
    return {
      id: uid(),
      search: searchInput,
      customerName: form.customerName.trim() || undefined,
      customerPhone: form.customerPhone.trim() || undefined,
      customerCity: form.customerCity.trim() || undefined,
      customerZip: form.customerZip.trim() || undefined,
      miles: form.miles > 0 ? form.miles : undefined,
      serviceType: form.serviceType,
      urgency: form.urgency,
      quoteOptions: options,
      selectedOption: selected ?? undefined,
      customerPrice: so?.customerPrice ?? options[0]?.customerPrice ?? 0,
      estimatedProfit: so?.estimatedProfit ?? options[0]?.estimatedProfit ?? 0,
      status,
      source: 'admin',
      createdBy: member?.uid || '',
      createdAt: new Date().toISOString(),
    };
  };

  // ─── Quote actions ────────────────────────────────────────────
  const saveQuote = async (status: 'draft' | 'sent' = 'draft'): Promise<TireQuote | null> => {
    if (!businessId || !_db) {
      addToast('Sign in to save quotes', 'warn');
      return null;
    }
    const quote = buildQuote(status);
    try {
      await setDoc(
        doc(_db, 'businesses', businessId, 'tireQuotes', quote.id),
        quote,
      );
      addToast(status === 'sent' ? 'Quote sent + saved' : 'Quote saved', 'success');
      return quote;
    } catch (e) {
      addToast(`Save failed: ${humanizeFirestoreError(e)}`, 'error');
      return null;
    }
  };

  const textQuote = async () => {
    const quote = await saveQuote('sent');
    if (!quote) return;
    openSmsForQuote({
      phone: form.customerPhone,
      customerName: form.customerName,
      businessName: brand.businessName,
      tireSize: quote.search.kind === 'size' ? quote.search.tireSize : undefined,
      options: quote.quoteOptions,
      selectedTier: selected ?? undefined,
    });
  };

  const emailQuote = async () => {
    const quote = await saveQuote('sent');
    if (!quote) return;
    openEmailForQuote({
      email: '', // operator types in mail-app's To field
      customerName: form.customerName,
      businessName: brand.businessName,
      tireSize: quote.search.kind === 'size' ? quote.search.tireSize : undefined,
      options: quote.quoteOptions,
      selectedTier: selected ?? undefined,
    });
  };

  const createJob = async () => {
    if (!selectedOption || !onCreateJobFromQuote || !setTab) {
      addToast('Pick a tire first', 'warn');
      return;
    }
    const quote = await saveQuote('sent');
    if (!quote) return;
    // Stamp the selected quote-to-job link before handoff so the
    // parent can persist the lineage on the new Job's sourceQuoteId.
    await onCreateJobFromQuote({ ...quote, status: 'convertedToJob' }, selectedOption);
    (setTab as unknown as (t: string) => void)('add');
  };

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        Tire Quote Engine
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>
        Search supplier prices · build Good/Better/Best + Used options · text or convert to job
      </div>

      {showForm ? (
        <QuoteSearchForm
          value={form}
          onChange={setForm}
          onSearch={search}
          busy={busy}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          style={{
            width: '100%',
            padding: 10,
            background: 'var(--s2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: 'var(--t2)',
            fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 12,
            textAlign: 'left',
          }}
        >
          ▾ Searched: <strong style={{ color: 'var(--t1)' }}>{searchedFor || '(any)'}</strong> · qty {form.quantity} · {form.urgency} · tap to refine
        </button>
      )}

      {matches && (
        <>
          {options.length === 0 && (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-title">No supplier matches</div>
              <div className="empty-state-sub">
                {matches.length === 0
                  ? `No tires match "${searchedFor}" in the supplier database.`
                  : `Found ${matches.length} tire${matches.length === 1 ? '' : 's'} but couldn't price any. Check supplier records have a category set.`}
              </div>
            </div>
          )}

          {usedOptions.length > 0 && (
            <Section title="Used Options" subtitle="Pre-owned, ready to install">
              {usedOptions.map((opt) => (
                <QuoteOptionCard
                  key={opt.tier}
                  option={opt}
                  showCost={canViewCost}
                  selected={selected === opt.tier}
                  onSelect={() => setSelected(opt.tier)}
                />
              ))}
            </Section>
          )}

          {newOptions.length > 0 && (
            <Section title="New Options" subtitle="Brand new from supplier">
              {newOptions.map((opt) => (
                <QuoteOptionCard
                  key={opt.tier}
                  option={opt}
                  showCost={canViewCost}
                  selected={selected === opt.tier}
                  onSelect={() => setSelected(opt.tier)}
                />
              ))}
            </Section>
          )}

          {options.length > 0 && (
            <div style={{
              position: 'sticky',
              bottom: 0,
              background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
              padding: '14px 0 calc(8px + env(safe-area-inset-bottom)) 0',
              marginTop: 16,
            }}>
              <div style={{
                fontSize: 11, color: 'var(--t3)', marginBottom: 8, textAlign: 'center',
              }}>
                {selected
                  ? `Selected: ${selectedOption?.brand} ${selectedOption?.model} — ${money(selectedOption?.customerPrice || 0)}`
                  : 'Tap a tire to select it'}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="btn secondary"
                  onClick={() => saveQuote('draft')}
                  style={{ flex: 1, minWidth: 120 }}
                  disabled={busy}
                >
                  Save Quote
                </button>
                <button
                  className="btn secondary"
                  onClick={textQuote}
                  disabled={busy || !form.customerPhone.trim()}
                  style={{ flex: 1, minWidth: 120 }}
                  title={!form.customerPhone.trim() ? 'Add customer phone in form' : ''}
                >
                  Text Quote
                </button>
                <button
                  className="btn secondary"
                  onClick={emailQuote}
                  disabled={busy}
                  style={{ flex: 1, minWidth: 120 }}
                >
                  Email Quote
                </button>
                <button
                  className="btn primary"
                  onClick={createJob}
                  disabled={busy || !selected}
                  style={{ flex: 1, minWidth: 120 }}
                >
                  Create Job →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}
