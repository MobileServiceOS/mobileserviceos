import { useEffect, useRef, useState } from 'react';
import type { Settings as SettingsT, ServicePricing, VehiclePricing, Brand, MultiTirePricing } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { addToast } from '@/lib/toast';
import { uploadLogo, deleteLogo, _auth } from '@/lib/firebase';
import { signOut, updatePassword } from 'firebase/auth';
import { DEFAULT_MULTI_TIRE } from '@/lib/defaults';
import { money } from '@/lib/utils';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

export function Settings({ settings, onSave }: Props) {
  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Settings</div>
      <BrandSection />
      <BusinessSection settings={settings} onSave={onSave} />
      <InvoiceStyleSection settings={settings} onSave={onSave} />
      <PricingSection settings={settings} onSave={onSave} />
      <MultiTirePricingSection settings={settings} onSave={onSave} />
      <AccountSection />
    </div>
  );
}

function BrandSection() {
  const { brand, businessId, updateBrand } = useBrand();
  const [draft, setDraft] = useState<Brand>(brand);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(brand); }, [brand]);

  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const handleLogo = async (file: File) => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    setLogoUploading(true);
    try {
      const url = await uploadLogo(businessId, file);
      if (url) {
        set('logoUrl', url);
        await updateBrand({ logoUrl: url });
        addToast('Logo updated', 'success');
      }
    } catch (e) {
      addToast((e as Error).message || 'Upload failed', 'error');
    } finally { setLogoUploading(false); }
  };

  const handleRemoveLogo = async () => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    if (!draft.logoUrl) return;
    if (!window.confirm('Remove your business logo? Invoices will fall back to your business name only.')) return;
    setLogoRemoving(true);
    try {
      // Clear the URL in brand settings first so the UI updates immediately,
      // then delete the storage objects in the background.
      await updateBrand({ logoUrl: '' });
      set('logoUrl', '');
      await deleteLogo(businessId);
      addToast('Logo removed', 'success');
    } catch (e) {
      addToast((e as Error).message || 'Remove failed', 'error');
    } finally { setLogoRemoving(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateBrand(draft);
      addToast('Brand saved', 'success');
    } catch (e) {
      addToast((e as Error).message || 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  const hasLogo = Boolean(draft.logoUrl);

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Brand</div>

      {/* ── Logo block ── premium preview on dark background so the owner sees
           the logo the way it will look on invoices/PDFs (which use dark hero). */}
      <div className="field">
        <label>Business logo</label>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: 14,
          background: 'linear-gradient(160deg, #0a0b10 0%, #141620 100%)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}>
          {/* Preview tile — matches the proportions used on the invoice */}
          <div style={{
            width: 72,
            height: 72,
            borderRadius: 10,
            background: hasLogo ? '#fff' : 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            {hasLogo ? (
              <img
                src={draft.logoUrl}
                alt="Business logo preview"
                style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }}
                onError={(e) => {
                  // If the URL is broken, hide the image and let the fallback show
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                No logo
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogo(f);
                  if (logoInputRef.current) logoInputRef.current.value = '';
                }}
              />
              <button
                className="btn sm secondary"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading || logoRemoving}
              >
                {logoUploading ? 'Uploading…' : hasLogo ? 'Change logo' : 'Upload logo'}
              </button>
              {hasLogo && (
                <button
                  className="btn sm secondary"
                  onClick={handleRemoveLogo}
                  disabled={logoUploading || logoRemoving}
                  style={{ color: 'var(--red)' }}
                >
                  {logoRemoving ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 8, lineHeight: 1.4 }}>
              PNG, JPG, or WEBP · max 5MB · square or wide logos work best
            </div>
          </div>
        </div>
      </div>

      <div className="field">
        <label>Business name</label>
        <input value={draft.businessName} onChange={(e) => set('businessName', e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Phone</label>
          <input type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      </div>
      <CityStateSelect
        state={draft.state || ''}
        city={draft.mainCity || ''}
        onChange={({ city, state, fullLocationLabel }) => setDraft((d) => ({ ...d, mainCity: city, state, fullLocationLabel }))}
        cityLabel="Main city" stateLabel="State"
      />
      <div className="field" style={{ marginTop: 14 }}>
        <label>Service cities (comma-separated)</label>
        <input
          value={(draft.serviceCities || []).join(', ')}
          onChange={(e) => set('serviceCities', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Service radius (mi)</label>
          <input type="number" inputMode="numeric" value={draft.serviceRadius || 25}
            onChange={(e) => set('serviceRadius', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Review URL</label>
          <input value={draft.reviewUrl} onChange={(e) => set('reviewUrl', e.target.value)} placeholder="https://g.page/r/…" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Primary color</label>
          <input value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} placeholder="#c8a44a" />
        </div>
        <div className="field">
          <label>Accent color</label>
          <input value={draft.accentColor} onChange={(e) => set('accentColor', e.target.value)} placeholder="#e5c770" />
        </div>
      </div>
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Brand'}</button>
    </div>
  );
}

function BusinessSection({ settings, onSave }: Props) {
  const [draft, setDraft] = useState<SettingsT>(settings);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(settings); setDirty(false); }, [settings]);

  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => {
    setDraft((d) => ({ ...d, [k]: v })); setDirty(true);
  };

  const save = async () => {
    try { await onSave(draft); setDirty(false); } catch { /* toast in caller */ }
  };

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Business</div>
      <div className="field-row">
        <div className="field">
          <label>Weekly goal ($)</label>
          <input type="number" inputMode="decimal" value={draft.weeklyGoal} onChange={(e) => set('weeklyGoal', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Tax rate (%)</label>
          <input type="number" inputMode="decimal" value={draft.taxRate} onChange={(e) => set('taxRate', Number(e.target.value))} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Cost per mile ($)</label>
          <input type="number" inputMode="decimal" step="0.05" value={draft.costPerMile} onChange={(e) => set('costPerMile', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Free miles included</label>
          <input type="number" inputMode="numeric" value={draft.freeMilesIncluded || 0} onChange={(e) => set('freeMilesIncluded', Number(e.target.value))} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Flat repair target profit ($)</label>
          <input type="number" inputMode="decimal" value={draft.tireRepairTargetProfit || 0} onChange={(e) => set('tireRepairTargetProfit', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Replacement target profit ($)</label>
          <input type="number" inputMode="decimal" value={draft.tireReplacementTargetProfit || 0} onChange={(e) => set('tireReplacementTargetProfit', Number(e.target.value))} />
        </div>
      </div>
      <div className="form-group-title" style={{ marginTop: 16, fontSize: 12 }}>Owners</div>
      <div className="field-row">
        <div className="field">
          <label>Owner 1 name</label>
          <input value={draft.owner1Name} onChange={(e) => set('owner1Name', e.target.value)} />
        </div>
        <div className="field">
          <label>Split %</label>
          <input type="number" inputMode="numeric" value={draft.profitSplit1} onChange={(e) => set('profitSplit1', Number(e.target.value))} />
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
          <input type="number" inputMode="numeric" value={draft.profitSplit2} onChange={(e) => set('profitSplit2', Number(e.target.value))} />
        </div>
      </div>
      <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="checkbox" checked={draft.owner2Active} onChange={(e) => set('owner2Active', e.target.checked)} /> Active
      </label>
      {dirty && <button className="btn primary" onClick={save}>Save Business</button>}
    </div>
  );
}

function PricingSection({ settings, onSave }: Props) {
  const [sp, setSp] = useState<Record<string, ServicePricing>>(settings.servicePricing || {});
  const [vp, setVp] = useState<Record<string, VehiclePricing>>(settings.vehiclePricing || {});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSp(settings.servicePricing || {});
    setVp(settings.vehiclePricing || {});
    setDirty(false);
  }, [settings.servicePricing, settings.vehiclePricing]);

  const updateService = (k: string, patch: Partial<ServicePricing>) => {
    setSp((p) => ({ ...p, [k]: { ...p[k], ...patch } })); setDirty(true);
  };
  const updateVehicle = (k: string, patch: Partial<VehiclePricing>) => {
    setVp((p) => ({ ...p, [k]: { ...p[k], ...patch } })); setDirty(true);
  };

  const save = async () => {
    try { await onSave({ servicePricing: sp, vehiclePricing: vp }); setDirty(false); } catch { /* */ }
  };

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Pricing</div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>Service base price + min profit</div>
      {Object.keys(sp).map((k) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{k}</span>
            <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={sp[k].enabled !== false} onChange={(e) => updateService(k, { enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <input type="number" inputMode="decimal" value={sp[k].basePrice} onChange={(e) => updateService(k, { basePrice: Number(e.target.value) })} placeholder="Base" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <input type="number" inputMode="decimal" value={sp[k].minProfit} onChange={(e) => updateService(k, { minProfit: Number(e.target.value) })} placeholder="Min profit" />
            </div>
          </div>
        </div>
      ))}
      <div className="form-group-title" style={{ marginTop: 14, fontSize: 12 }}>Vehicle add-on profit</div>
      {Object.keys(vp).map((k) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{k}</span>
          <input type="number" inputMode="decimal" value={vp[k].addOnProfit}
            onChange={(e) => updateVehicle(k, { addOnProfit: Number(e.target.value) })}
            style={{ maxWidth: 120 }} />
        </div>
      ))}
      {dirty && <button className="btn primary" onClick={save}>Save Pricing</button>}
      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 10 }}>
        Estimated travel charge for 10 mi: {money(Math.max(0, 10 - (settings.freeMilesIncluded || 0)) * (settings.costPerMile || 0))}
      </div>
    </div>
  );
}

/**
 * Invoice line-item display style picker.
 *
 *   • Transparent Line Items (default) — splits replacement/installation jobs
 *     into Tire / Mobile Service & Dispatch / Mounting & Balancing. Travel
 *     cost is absorbed into Mobile Service & Dispatch, never shown as a
 *     separate fee.
 *   • Single-Line Service — prints the service as one combined line item.
 *
 * Internal pricing math is unaffected by this setting. It only controls how
 * line items render on the customer's PDF.
 */
function InvoiceStyleSection({ settings, onSave }: Props) {
  const current: 'transparent' | 'single' =
    settings.invoicePricingStyle === 'single' ? 'single' : 'transparent';
  const [draft, setDraft] = useState<'transparent' | 'single'>(current);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const v = settings.invoicePricingStyle === 'single' ? 'single' : 'transparent';
    setDraft(v);
    setDirty(false);
  }, [settings.invoicePricingStyle]);

  const select = (v: 'transparent' | 'single') => {
    setDraft(v);
    setDirty(v !== current);
  };

  const save = async () => {
    try {
      await onSave({ invoicePricingStyle: draft });
      setDirty(false);
      addToast('Invoice style saved', 'success');
    } catch { /* toast handled in caller */ }
  };

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Invoice Display Style</div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>
        Choose how line items appear on customer invoices. This only affects the PDF —
        your internal pricing, profit, and dashboard math are unchanged.
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => select('transparent')}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select('transparent')}
        style={{
          border: '1px solid ' + (draft === 'transparent' ? 'var(--brand-primary)' : 'var(--border)'),
          background: draft === 'transparent' ? 'rgba(200,164,74,.06)' : 'var(--s1)',
          borderRadius: 10, padding: 12, marginBottom: 10, cursor: 'pointer',
          transition: 'border-color .15s ease, background .15s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>Transparent Line Items</span>
          {draft === 'transparent' && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--brand-primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Active</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
          Professional 3-line breakdown for replacement jobs.
        </div>
        <div style={{ background: 'var(--s2)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: 'var(--t2)', fontFamily: 'ui-monospace,Menlo,monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tire</span><span style={{ color: 'var(--t1)' }}>$50</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Mobile Service &amp; Dispatch</span><span style={{ color: 'var(--t1)' }}>$65</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Mounting &amp; Balancing</span><span style={{ color: 'var(--t1)' }}>$55</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 5, paddingTop: 5, display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--t1)' }}>
            <span>TOTAL</span><span>$170</span>
          </div>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => select('single')}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select('single')}
        style={{
          border: '1px solid ' + (draft === 'single' ? 'var(--brand-primary)' : 'var(--border)'),
          background: draft === 'single' ? 'rgba(200,164,74,.06)' : 'var(--s1)',
          borderRadius: 10, padding: 12, marginBottom: 10, cursor: 'pointer',
          transition: 'border-color .15s ease, background .15s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>Single-Line Service</span>
          {draft === 'single' && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--brand-primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Active</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
          One combined line per service.
        </div>
        <div style={{ background: 'var(--s2)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: 'var(--t2)', fontFamily: 'ui-monospace,Menlo,monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tire Replacement</span><span style={{ color: 'var(--t1)' }}>$170</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 5, paddingTop: 5, display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--t1)' }}>
            <span>TOTAL</span><span>$170</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4, lineHeight: 1.5 }}>
        Flat tire repairs and other simple services always print as a single line regardless of this setting.
      </div>

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 12, width: '100%' }}>
          Save Invoice Style
        </button>
      )}
    </div>
  );
}

/**
 * Edit replacement multipliers and flat installation prices.
 */
function MultiTirePricingSection({ settings, onSave }: Props) {
  const current: MultiTirePricing = settings.multiTirePricing || DEFAULT_MULTI_TIRE;
  const [draft, setDraft] = useState<MultiTirePricing>(current);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(settings.multiTirePricing || DEFAULT_MULTI_TIRE);
    setDirty(false);
  }, [settings.multiTirePricing]);

  const setMult = (key: 'two' | 'three' | 'four', v: number) => {
    setDraft((d) => ({ ...d, replacementMultipliers: { ...d.replacementMultipliers, [key]: v } }));
    setDirty(true);
  };
  const setInstall = (key: 'one' | 'two' | 'three' | 'four', v: number) => {
    setDraft((d) => ({ ...d, installationByQuantity: { ...d.installationByQuantity, [key]: v } }));
    setDirty(true);
  };

  const resetDefaults = () => {
    setDraft(DEFAULT_MULTI_TIRE);
    setDirty(true);
  };

  const save = async () => {
    try {
      await onSave({ multiTirePricing: draft });
      setDirty(false);
      addToast('Multi-tire pricing saved', 'success');
    } catch { /* toast handled in caller */ }
  };

  const baseReplacementProfit = Number(
    settings.servicePricing?.['Tire Replacement']?.minProfit
      ?? settings.tireReplacementTargetProfit
      ?? 110
  );

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Multi-Tire Pricing</div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>
        Pricing controls for jobs with more than 1 tire. Replacement multipliers scale your target
        profit when replacing multiple tires. Installation prices are flat labor charges when the
        customer supplies their own tires.
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
        Tire Replacement Multipliers
      </div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
        Base target profit: <strong style={{ color: 'var(--t1)' }}>{money(baseReplacementProfit)}</strong>
      </div>
      <div className="field-row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>2 tires ×</label>
          <input type="number" inputMode="decimal" step="0.1" value={draft.replacementMultipliers.two}
            onChange={(e) => setMult('two', Number(e.target.value))} />
          <div style={{ fontSize: 10, color: 'var(--brand-primary)', fontWeight: 700, marginTop: 4 }}>
            → {money(baseReplacementProfit * Number(draft.replacementMultipliers.two || 0))} profit
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>3 tires ×</label>
          <input type="number" inputMode="decimal" step="0.1" value={draft.replacementMultipliers.three}
            onChange={(e) => setMult('three', Number(e.target.value))} />
          <div style={{ fontSize: 10, color: 'var(--brand-primary)', fontWeight: 700, marginTop: 4 }}>
            → {money(baseReplacementProfit * Number(draft.replacementMultipliers.three || 0))} profit
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>4 tires ×</label>
          <input type="number" inputMode="decimal" step="0.1" value={draft.replacementMultipliers.four}
            onChange={(e) => setMult('four', Number(e.target.value))} />
          <div style={{ fontSize: 10, color: 'var(--brand-primary)', fontWeight: 700, marginTop: 4 }}>
            → {money(baseReplacementProfit * Number(draft.replacementMultipliers.four || 0))} profit
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '1px', margin: '18px 0 8px 0' }}>
        Tire Installation Prices (customer supplies tires)
      </div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
        Flat labor charge by quantity. Travel and surcharges still apply on top.
      </div>
      <div className="field-row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>1 tire ($)</label>
          <input type="number" inputMode="decimal" value={draft.installationByQuantity.one}
            onChange={(e) => setInstall('one', Number(e.target.value))} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>2 tires ($)</label>
          <input type="number" inputMode="decimal" value={draft.installationByQuantity.two}
            onChange={(e) => setInstall('two', Number(e.target.value))} />
        </div>
      </div>
      <div className="field-row" style={{ marginTop: 8 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>3 tires ($)</label>
          <input type="number" inputMode="decimal" value={draft.installationByQuantity.three}
            onChange={(e) => setInstall('three', Number(e.target.value))} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>4 tires ($)</label>
          <input type="number" inputMode="decimal" value={draft.installationByQuantity.four}
            onChange={(e) => setInstall('four', Number(e.target.value))} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn secondary" onClick={resetDefaults}>Reset defaults</button>
        {dirty && <button className="btn primary" style={{ flex: 1 }} onClick={save}>Save Multi-Tire Pricing</button>}
      </div>
    </div>
  );
}

function AccountSection() {
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);

  const changePass = async () => {
    if (!_auth?.currentUser) return;
    if (newPass.length < 6) { addToast('Password too short', 'warn'); return; }
    setBusy(true);
    try {
      await updatePassword(_auth.currentUser, newPass);
      addToast('Password updated', 'success');
      setNewPass('');
    } catch (e) {
      addToast((e as Error).message || 'Update failed', 'error');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    if (!_auth) return;
    try { await signOut(_auth); } catch { /* */ }
  };

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Account</div>
      <div className="field">
        <label>Email</label>
        <input value={_auth?.currentUser?.email || ''} disabled />
      </div>
      <div className="field">
        <label>New password</label>
        <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="At least 6 characters" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn secondary" onClick={changePass} disabled={busy || !newPass}>Update password</button>
        <button className="btn danger" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
