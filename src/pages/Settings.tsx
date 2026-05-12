import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Settings as SettingsT, ServicePricing, VehiclePricing, Brand } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { NumberField } from '@/components/NumberField';
import { addToast } from '@/lib/toast';
import { uploadLogo, _auth } from '@/lib/firebase';
import { signOut, updatePassword } from 'firebase/auth';
import { APP_LOGO } from '@/lib/defaults';
import { money } from '@/lib/utils';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

/**
 * Settings — refactored for mobile-first one-handed use.
 *
 * Structure:
 *   - Every section is an Accordion. One open at a time (mutex).
 *   - Each collapsed card shows a summary preview so the operator can
 *     scan what's configured without expanding.
 *   - Pricing is now a compact table-style list.
 *   - Vehicle Add-ons split into its own section (was nested inside Pricing).
 *   - Role-based hiding: technicians never see Pricing, Vehicle Add-ons,
 *     Subscription, or the Owners block inside Business.
 *
 * Section order matches the spec: Brand → Business → Pricing →
 * Vehicle Add-ons → Team → Subscription → Account.
 */
export function Settings({ settings, onSave }: Props) {
  const permissions = usePermissions();

  // Mutex: which section is currently open. null = all collapsed.
  const [openSection, setOpenSection] = useState<string | null>('brand');

  // Role gates. Owners and admins see everything. Technicians get a
  // stripped-down view per the spec.
  const canSeePricing = permissions.canEditPricingSettings || permissions.canViewPricingSettings;
  const canSeeFinancials = permissions.canViewFinancials;
  const canSeeBilling = permissions.canManageBilling;

  return (
    <div className="page page-enter" style={{ paddingBottom: 96 /* room for sticky save */ }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Settings</div>

      <BrandAccordion
        open={openSection === 'brand'}
        onToggle={() => setOpenSection(openSection === 'brand' ? null : 'brand')}
      />

      <BusinessAccordion
        settings={settings}
        onSave={onSave}
        open={openSection === 'business'}
        onToggle={() => setOpenSection(openSection === 'business' ? null : 'business')}
        showOwners={canSeeFinancials}
      />

      {canSeePricing && (
        <PricingAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'pricing'}
          onToggle={() => setOpenSection(openSection === 'pricing' ? null : 'pricing')}
        />
      )}

      {canSeePricing && (
        <VehicleAddonsAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'vehicle'}
          onToggle={() => setOpenSection(openSection === 'vehicle' ? null : 'vehicle')}
        />
      )}

      <TeamAccordion
        settings={settings}
        open={openSection === 'team'}
        onToggle={() => setOpenSection(openSection === 'team' ? null : 'team')}
      />

      {canSeeBilling && (
        <SubscriptionAccordion
          settings={settings}
          open={openSection === 'subscription'}
          onToggle={() => setOpenSection(openSection === 'subscription' ? null : 'subscription')}
        />
      )}

      <AccountAccordion
        open={openSection === 'account'}
        onToggle={() => setOpenSection(openSection === 'account' ? null : 'account')}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Brand accordion
// ─────────────────────────────────────────────────────────────────────

function BrandAccordion({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { brand } = useBrand();
  const summary = [
    brand.businessName || 'Unnamed business',
    [brand.mainCity, brand.state].filter(Boolean).join(', ') || '—',
  ].join(' · ');

  return (
    <AccordionShell
      title="Brand"
      icon="🎨"
      summary={summary}
      open={open}
      onToggle={onToggle}
      logoUrl={brand.logoUrl}
    >
      <BrandForm />
    </AccordionShell>
  );
}

function BrandForm() {
  const { brand, businessId, updateBrand } = useBrand();
  const [draft, setDraft] = useState<Brand>(brand);
  const [logoUploading, setLogoUploading] = useState(false);
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

  const save = async () => {
    setBusy(true);
    try {
      await updateBrand(draft);
      addToast('Brand saved', 'success');
    } catch (e) {
      addToast((e as Error).message || 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="field">
        <label>Logo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={draft.logoUrl || APP_LOGO} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'contain', background: 'var(--s3)' }} />
          <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogo(f); if (logoInputRef.current) logoInputRef.current.value = ''; }} />
          <button className="btn sm secondary" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}>
            {logoUploading ? 'Uploading…' : 'Upload logo'}
          </button>
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
          <NumberField
            value={draft.serviceRadius || 25}
            onChange={(n) => set('serviceRadius', n)}
            decimals={false}
            placeholder="25"
          />
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
      <button className="btn primary" onClick={save} disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Saving…' : 'Save Brand'}
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Business accordion
// ─────────────────────────────────────────────────────────────────────

function BusinessAccordion({
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
  useEffect(() => { setDraft(settings); setDirty(false); }, [settings]);

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

// ─────────────────────────────────────────────────────────────────────
//  Pricing accordion (services only)
// ─────────────────────────────────────────────────────────────────────

function PricingAccordion({ settings, onSave, open, onToggle }: Props & { open: boolean; onToggle: () => void }) {
  const sp = settings.servicePricing || {};
  const enabledCount = Object.values(sp).filter((s) => s && s.enabled !== false).length;
  const totalCount = Object.keys(sp).length;
  const maxPrice = Object.values(sp).reduce((m, s) => Math.max(m, Number(s?.basePrice || 0)), 0);
  const summary = totalCount > 0
    ? `${enabledCount} of ${totalCount} services enabled · Max ${money(maxPrice)}`
    : 'No services configured';

  return (
    <AccordionShell title="Pricing" icon="💰" summary={summary} open={open} onToggle={onToggle}>
      <PricingForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function PricingForm({ settings, onSave }: Props) {
  const [sp, setSp] = useState<Record<string, ServicePricing>>(settings.servicePricing || {});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSp(settings.servicePricing || {});
    setDirty(false);
  }, [settings.servicePricing]);

  const updateService = (k: string, patch: Partial<ServicePricing>) => {
    setSp((p) => ({ ...p, [k]: { ...p[k], ...patch } })); setDirty(true);
  };

  const save = async () => {
    try { await onSave({ servicePricing: sp }); setDirty(false); } catch { /* */ }
  };

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
        Service base price + min profit per row.
      </div>

      {/* Compact pricing rows — table-style. Each row: name, base, min profit,
          enabled toggle. Fits ~5 services on a typical phone screen instead
          of the ~2 you'd get with the stacked-card layout. */}
      <div style={{
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {Object.keys(sp).map((k, idx) => {
          const row = sp[k];
          const enabled = row.enabled !== false;
          return (
            <div
              key={k}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 70px 70px 50px',
                gap: 8,
                alignItems: 'center',
                padding: '8px 10px',
                borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
                opacity: enabled ? 1 : 0.55,
                transition: 'opacity .15s ease',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {k}
              </div>
              <NumberField
                value={row.basePrice}
                onChange={(n) => updateService(k, { basePrice: n })}
                placeholder="Base"
                disabled={!enabled}
              />
              <NumberField
                value={row.minProfit}
                onChange={(n) => updateService(k, { minProfit: n })}
                placeholder="Profit"
                disabled={!enabled}
              />
              <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                cursor: 'pointer', minHeight: 32,
              }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => updateService(k, { enabled: e.target.checked })}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
              </label>
            </div>
          );
        })}
      </div>

      <div style={{
        fontSize: 10, color: 'var(--t3)', marginTop: 8,
        display: 'grid', gridTemplateColumns: '1fr 70px 70px 50px', gap: 8, padding: '0 10px',
      }}>
        <span>Service</span>
        <span style={{ textAlign: 'left' }}>Base $</span>
        <span style={{ textAlign: 'left' }}>Profit $</span>
        <span style={{ textAlign: 'right' }}>On</span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 14 }}>
        Estimated travel charge for 10 mi: {money(Math.max(0, 10 - (settings.freeMilesIncluded || 0)) * (settings.costPerMile || 0))}
      </div>

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 14, width: '100%' }}>
          Save Pricing
        </button>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Vehicle Add-ons accordion
// ─────────────────────────────────────────────────────────────────────

function VehicleAddonsAccordion({ settings, onSave, open, onToggle }: Props & { open: boolean; onToggle: () => void }) {
  const vp = settings.vehiclePricing || {};
  // Surface the two most operationally relevant adders in the preview.
  const suvAddon = Number(vp['SUV/Truck']?.addOnProfit || vp['SUV']?.addOnProfit || 0);
  const semiAddon = Number(vp['Tractor-Trailer']?.addOnProfit || vp['Semi-Truck']?.addOnProfit || vp['Semi']?.addOnProfit || 0);
  const summary = `SUV/Truck ${money(suvAddon)} · Semi ${money(semiAddon)}`;

  return (
    <AccordionShell title="Vehicle Add-ons" icon="🚚" summary={summary} open={open} onToggle={onToggle}>
      <VehicleAddonsForm settings={settings} onSave={onSave} />
    </AccordionShell>
  );
}

function VehicleAddonsForm({ settings, onSave }: Props) {
  const [vp, setVp] = useState<Record<string, VehiclePricing>>(settings.vehiclePricing || {});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setVp(settings.vehiclePricing || {});
    setDirty(false);
  }, [settings.vehiclePricing]);

  const updateVehicle = (k: string, patch: Partial<VehiclePricing>) => {
    setVp((p) => ({ ...p, [k]: { ...p[k], ...patch } })); setDirty(true);
  };

  const save = async () => {
    try { await onSave({ vehiclePricing: vp }); setDirty(false); } catch { /* */ }
  };

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
        Profit add-on per vehicle type, added on top of the service base price.
      </div>

      {/* Compact 2-col rows: vehicle type → input. Right-aligned input,
          consistent width across rows. */}
      <div style={{
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {Object.keys(vp).map((k, idx) => (
          <div
            key={k}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 110px',
              gap: 10,
              alignItems: 'center',
              padding: '10px 12px',
              borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{k}</span>
            <NumberField
              value={vp[k].addOnProfit}
              onChange={(n) => updateVehicle(k, { addOnProfit: n })}
              placeholder="0"
            />
          </div>
        ))}
      </div>

      {dirty && (
        <button className="btn primary" onClick={save} style={{ marginTop: 14, width: '100%' }}>
          Save Vehicle Add-ons
        </button>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Team accordion (placeholder — full impl deferred)
// ─────────────────────────────────────────────────────────────────────

function TeamAccordion({ settings, open, onToggle }: { settings: SettingsT; open: boolean; onToggle: () => void }) {
  const isPro = settings.plan === 'pro';
  const summary = isPro ? 'Coming soon · Pro feature' : 'Pro plan required';

  return (
    <AccordionShell title="Team Management" icon="🧑‍🔧" summary={summary} open={open} onToggle={onToggle} badge={isPro ? undefined : 'Pro'}>
      {isPro ? (
        <div style={{
          padding: 14, background: 'var(--s2)', border: '1px dashed var(--border2)',
          borderRadius: 10, textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
            Team management coming soon
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
            Invite admins and technicians, manage roles, and control what your team can see.
          </div>
        </div>
      ) : (
        <div style={{
          padding: 16, background: 'linear-gradient(160deg, rgba(200,164,74,.04) 0%, var(--s1) 100%)',
          border: '1px solid var(--border)', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>🔒</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
              Team access is available on Pro
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
              Add admins and technicians, restrict pricing changes, and track who logged each job.
            </div>
          </div>
        </div>
      )}
    </AccordionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Subscription accordion (was PlanSection)
// ─────────────────────────────────────────────────────────────────────

function SubscriptionAccordion({ settings, open, onToggle }: { settings: SettingsT; open: boolean; onToggle: () => void }) {
  const isPro = settings.plan === 'pro';
  const status = isPro ? 'Active' : 'Solo';
  const summary = `${isPro ? 'Pro Plan' : 'Core Plan'} · ${status}`;

  return (
    <AccordionShell
      title="Subscription"
      icon="⭐"
      summary={summary}
      open={open}
      onToggle={onToggle}
      badge={isPro ? 'Pro' : undefined}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: 12, background: 'var(--s2)',
        border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--t1)' }}>
              {isPro ? 'Pro Plan' : 'Core Plan'}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 800, color: isPro ? 'var(--brand-primary)' : 'var(--t3)',
              textTransform: 'uppercase', letterSpacing: '1px',
              padding: '2px 7px', borderRadius: 99,
              background: isPro ? 'rgba(200,164,74,.1)' : 'var(--s3)',
              border: `1px solid ${isPro ? 'rgba(200,164,74,.3)' : 'var(--border)'}`,
            }}>
              {status}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4, lineHeight: 1.5 }}>
            {isPro
              ? 'Multi-user team access · advanced reporting · priority support'
              : 'Solo operator · 1 user · all core features included'}
          </div>
        </div>
        {!isPro && (
          <button
            className="btn sm secondary"
            disabled
            title="Stripe checkout coming soon"
            style={{ flexShrink: 0, opacity: 0.6 }}
          >
            Upgrade
          </button>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 8 }}>
        Subscription billing is not yet wired. Future paywall will use Stripe.
      </div>
    </AccordionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Account accordion
// ─────────────────────────────────────────────────────────────────────

function AccountAccordion({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const email = _auth?.currentUser?.email || '';
  // Provider id reflects Google/Apple/etc. Default Firebase email/password
  // signups report as 'password'. Surface that as 'Email' for readability.
  const providerId = _auth?.currentUser?.providerData?.[0]?.providerId;
  const provider = providerId === 'password' ? 'Email' : (providerId || 'Email');
  const summary = email ? `${email} · ${provider}` : 'Not signed in';

  return (
    <AccordionShell title="Account" icon="🔐" summary={summary} open={open} onToggle={onToggle}>
      <AccountForm />
    </AccordionShell>
  );
}

function AccountForm() {
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
    <>
      <div className="field">
        <label>Email</label>
        <input value={_auth?.currentUser?.email || ''} disabled />
      </div>
      <div className="field">
        <label>New password</label>
        <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="At least 6 characters" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn secondary" onClick={changePass} disabled={busy || !newPass} style={{ flex: 1 }}>
          Update password
        </button>
        <button className="btn danger" onClick={logout} style={{ flex: 1 }}>Sign out</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  AccordionShell — wraps the existing Accordion with a richer header
//  that supports logo thumbnail, summary line, and a tappable behavior
//  controlled by the parent (for mutex).
// ─────────────────────────────────────────────────────────────────────

interface AccordionShellProps {
  title: string;
  icon?: string;
  summary?: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  logoUrl?: string;
  children: ReactNode;
}

function AccordionShell({ title, icon, summary, badge, open, onToggle, logoUrl, children }: AccordionShellProps) {
  // Use a controlled <details> + click handler so mutex works. The existing
  // Accordion component manages its own open state internally — not a fit
  // for mutex. So we render the same visual shape inline here.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (open) {
      // Use rAF so the DOM has settled before measuring.
      const id = requestAnimationFrame(() => setMaxH(el.scrollHeight));
      return () => cancelAnimationFrame(id);
    }
    setMaxH(0);
  }, [open, children]);

  return (
    <div className="card card-anim" style={{ overflow: 'hidden', marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          color: 'var(--t1)',
          textAlign: 'left',
          cursor: 'pointer',
          minHeight: 64,
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            style={{
              width: 36, height: 36, borderRadius: 8,
              objectFit: 'contain', background: 'var(--s2)',
              flexShrink: 0,
            }}
          />
        ) : icon ? (
          <span style={{
            fontSize: 20, width: 36, height: 36, borderRadius: 8,
            background: 'var(--s2)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {icon}
          </span>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, fontWeight: 800, color: 'var(--t1)',
          }}>
            {title}
            {badge && (
              <span style={{
                fontSize: 9, fontWeight: 800,
                color: 'var(--brand-primary)',
                textTransform: 'uppercase', letterSpacing: '1px',
                padding: '2px 6px', borderRadius: 99,
                background: 'rgba(200,164,74,.1)',
                border: '1px solid rgba(200,164,74,.3)',
              }}>
                {badge}
              </span>
            )}
          </div>
          {summary && (
            <div style={{
              fontSize: 11, color: 'var(--t3)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {summary}
            </div>
          )}
        </div>
        <span
          aria-hidden
          style={{
            fontSize: 14,
            color: 'var(--t3)',
            transition: 'transform .25s ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          ▸
        </span>
      </button>
      <div
        style={{
          maxHeight: open ? maxH : 0,
          overflow: 'hidden',
          transition: 'max-height .25s ease',
        }}
      >
        <div
          ref={contentRef}
          style={{
            padding: '12px 16px 16px',
            borderTop: '1px solid var(--border2)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
