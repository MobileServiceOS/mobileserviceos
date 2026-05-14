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
import { attachStripeSync } from '@/lib/stripeSync';
import { SubscribeButton } from '@/components/SubscribeButton';
import { isBillingExempt } from '@/lib/planAccess';
import { PRO_PRICE, PRO_PRICE_LINE_COMPACT } from '@/lib/pricing-display';
import { TeamManagement } from '@/components/TeamManagement';
import {
  setLifetimeAccess,
  revokeLifetimeAccess,
  isLifetimeOwner,
} from '@/lib/lifetimeAccess';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

/**
 * Hard cap on logo upload time. Firebase Storage retries internally,
 * but if the network never settles we still want to release the
 * spinner so the user isn't stuck. 30s is generous for a sub-MB image.
 */
const LOGO_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * 14-day free trial — matches the value used in Onboarding. Surfaced
 * in the Subscription card so the user can see how many days remain.
 */
const TRIAL_DAYS = 14;

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
 *
 * Plan model: single Pro plan ($89.99/mo, 14-day trial). The
 * Subscription section renders the new PlanCard layout; Team
 * management is no longer plan-gated because every account is Pro.
 */
export function Settings({ settings, onSave }: Props) {
  const permissions = usePermissions();
  const { businessId } = useBrand();

  // Mutex: which section is currently open. null = all collapsed.
  const [openSection, setOpenSection] = useState<string | null>('brand');

  // Role gates. Owners and admins see everything. Technicians get a
  // stripped-down view per the spec.
  const canSeePricing = permissions.canEditPricingSettings || permissions.canViewPricingSettings;
  const canSeeFinancials = permissions.canViewFinancials;
  const canSeeBilling = permissions.canManageBilling;

  // Stripe → Firestore subscription mirror. While the Settings page is
  // mounted, listen to the Stripe Extension's per-user subscription
  // docs and reflect status changes back into Settings. The listener
  // is idempotent and self-detaches on unmount; safe to run even
  // before the Stripe Extension is installed (the source collection
  // simply stays empty).
  //
  // Mounting here (rather than App-wide) means the mirror only runs
  // while the user is actively on the Settings page. That's fine —
  // the Stripe webhook keeps Firestore consistent regardless; this
  // listener is just for snappier in-app status updates.
  useEffect(() => {
    const uid = _auth?.currentUser?.uid;
    if (!uid || !businessId) return;
    const unsub = attachStripeSync(uid, businessId);
    return () => unsub();
  }, [businessId]);

  return (
    <div className="page page-enter settings-page">
      {/* Page title — the global sticky Header above already shows the
          business name + sync pill + sign-out. This is just the page
          label; spacing/safe-area is handled by .settings-page in CSS
          (see src/styles/app.css). */}
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

      {/* Lifetime Pro Access — hidden owner-only panel. Renders only
          when:
            (a) this account is already billing-exempt (so the owner
                can see the grant + revoke), OR
            (b) localStorage has `msos_show_dev_tools=1` (so a developer
                can grant themselves for testing).
          Always gated by canSeeBilling (== canManageBilling permission)
          so technicians never see this section. */}
      {canSeeBilling && (isBillingExempt(settings) || _isDevToolsEnabled()) && (
        <LifetimeAccessAccordion
          settings={settings}
          open={openSection === 'lifetime'}
          onToggle={() => setOpenSection(openSection === 'lifetime' ? null : 'lifetime')}
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

  /**
   * Logo upload with a hard timeout so the spinner can never get stuck.
   * Promise.race against a setTimeout rejection — whichever settles
   * first wins. The `finally` block guarantees state cleanup on every
   * branch (success / error / timeout). Toast feedback on each outcome.
   */
  const handleLogo = async (file: File) => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    if (logoUploading) return;
    setLogoUploading(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // `uploadLogo` returns `Promise<string | null>` (null on a quietly-
      // skipped upload). The timeout race arm must use the same union
      // so the generic type-checks; we narrow back to a non-null string
      // at the use site below.
      const url = await Promise.race<string | null>([
        uploadLogo(businessId, file),
        new Promise<string | null>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Logo upload timed out — please try again')),
            LOGO_UPLOAD_TIMEOUT_MS,
          );
        }),
      ]);
      if (url) {
        set('logoUrl', url);
        await updateBrand({ logoUrl: url });
        addToast('Logo updated', 'success');
      } else {
        addToast('Upload returned no URL', 'error');
      }
    } catch (e) {
      addToast((e as Error).message || 'Upload failed', 'error');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setLogoUploading(false);
    }
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
        {!draft.logoUrl && !logoUploading && (
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            Logo appears on invoices and customer-facing receipts. PNG or
            JPG, square preferred.
          </div>
        )}
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
//  Team accordion
//
//  No longer plan-gated. Every account is on Pro, so the lock screen
//  has been replaced with the "coming soon" placeholder (matches the
//  pattern other in-progress features use elsewhere in the app).
// ─────────────────────────────────────────────────────────────────────

function TeamAccordion({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <AccordionShell title="Team Management" icon="🧑‍🔧" summary="Invite & manage" open={open} onToggle={onToggle}>
      <TeamManagement />
    </AccordionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Subscription accordion — single Pro plan card
//
//  Replaces the old Core-vs-Pro comparison UI. Mobile Service OS now
//  offers one plan ($89.99/mo Pro with a 14-day free trial). Shows:
//    - Plan name + price
//    - Trial countdown pill when subscriptionStatus === 'trialing'
//    - "Billing integration coming soon" notice
//    - The full feature checklist (Pro includes everything)
//
//  No upgrade button, no plan toggle, no Core comparison.
// ─────────────────────────────────────────────────────────────────────

const PRO_FEATURES: ReadonlyArray<string> = [
  'Quick Quote',
  'Job Logging',
  'Customer Management',
  'Branded Invoices',
  'Review Requests',
  'Expense Tracking',
  'Tire Inventory',
  'Profit Dashboard',
  'Pending Payment Tracking',
  'Technician Accounts',
  'Role Permissions',
  'Technician Attribution',
  'Team Inventory Workflow',
  'Advanced Analytics',
  'Owner / Admin Visibility',
  'Multi-user Operations',
  'PWA Install',
];

/**
 * Compute remaining trial days. Returns null when not trialing or
 * when the trialEndsAt field is missing/unparseable. Handles ISO
 * string, JS Date, and Firestore Timestamp shapes — see Settings
 * type for why all three are valid at rest.
 */
function trialDaysLeft(settings: SettingsT): number | null {
  if (settings.subscriptionStatus !== 'trialing') return null;
  const raw = settings.trialEndsAt;
  if (!raw) return null;
  let endMs: number;
  try {
    if (typeof raw === 'string') endMs = new Date(raw).getTime();
    else if (raw instanceof Date) endMs = raw.getTime();
    else if (raw && typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
      endMs = (raw as { toMillis: () => number }).toMillis();
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (Number.isNaN(endMs)) return null;
  const diffMs = endMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function SubscriptionAccordion({ settings, open, onToggle }: { settings: SettingsT; open: boolean; onToggle: () => void }) {
  const daysLeft = trialDaysLeft(settings);
  const isTrialing = settings.subscriptionStatus === 'trialing';
  const exempt = isBillingExempt(settings);
  const summary = exempt
    ? `Pro · Lifetime${settings.subscriptionOverride && settings.subscriptionOverride !== 'lifetime'
        ? ` (${settings.subscriptionOverride})` : ''}`
    : isTrialing && daysLeft !== null
      ? `Pro · Trial · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
      : `Pro Plan · ${PRO_PRICE_LINE_COMPACT}`;

  return (
    <AccordionShell
      title="Subscription"
      icon="⭐"
      summary={summary}
      open={open}
      onToggle={onToggle}
      badge={exempt ? 'Lifetime' : 'Pro'}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--t1)',
            letterSpacing: '-.3px',
            lineHeight: 1.1,
          }}>
            {exempt ? 'Lifetime Pro Access' : 'Pro Plan'}
          </div>
          <div style={{
            fontSize: 13,
            color: 'var(--t2)',
            marginTop: 6,
          }}>
            {exempt ? (
              <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                No billing required — full Pro features unlocked permanently
              </span>
            ) : (
              <>
                <span style={{ fontWeight: 800, color: 'var(--brand-primary)' }}>{PRO_PRICE}</span>
                <span> / month · {TRIAL_DAYS}-day free trial</span>
              </>
            )}
          </div>
        </div>

        {!exempt && isTrialing && daysLeft !== null && (
          <div
            title="Free trial in progress"
            style={{
              fontSize: 9, fontWeight: 800,
              color: 'var(--brand-primary)',
              textTransform: 'uppercase', letterSpacing: '1px',
              padding: '4px 9px', borderRadius: 99,
              background: 'rgba(200,164,74,.1)',
              border: '1px solid rgba(200,164,74,.3)',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            Trial · {daysLeft}d left
          </div>
        )}
      </div>

      <div style={{
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 12,
        color: 'var(--t2)',
        marginBottom: 14,
        lineHeight: 1.5,
      }}>
        {exempt
          ? 'This account has lifetime Pro access. Stripe billing checks are bypassed; no payment is ever required. Manage exemption details in the Lifetime Pro Access panel below.'
          : isTrialing
            ? 'Your free trial is active. Subscribe any time to keep your Pro features when the trial ends.'
            : settings.subscriptionStatus === 'active'
              ? 'Subscription active. Use Manage billing to update card, view invoices, or cancel.'
              : settings.subscriptionStatus === 'past_due'
                ? 'Payment past due. Update your card via Manage billing to keep Pro features.'
                : settings.subscriptionStatus === 'canceled'
                  ? 'Subscription canceled. Subscribe again to restore Pro features.'
                  : 'Subscribe to keep Pro features active after the trial.'}
      </div>

      <div style={{
        fontSize: 11,
        color: 'var(--t3)',
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 10,
      }}>
        What's included
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px 14px',
        marginBottom: 16,
      }}>
        {PRO_FEATURES.map((feat) => (
          <div key={feat} style={{
            fontSize: 12,
            color: 'var(--t1)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}>
            <span style={{ color: 'var(--brand-primary)', fontWeight: 800, flexShrink: 0 }}>✓</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {feat}
            </span>
          </div>
        ))}
      </div>

      {/* Stripe subscribe / portal button — hidden entirely for exempt
          accounts since billing doesn't apply. Renders a disabled
          "coming soon" placeholder if the Stripe price ID env var
          isn't configured at build time. */}
      {!exempt && <SubscribeButton settings={settings} />}
    </AccordionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Lifetime Pro Access — hidden owner-only panel
//
//  Renders only when:
//    (a) account is currently billing-exempt — owner sees grant details
//        + revoke button, OR
//    (b) developer mode is enabled (localStorage `msos_show_dev_tools=1`)
//        — owner sees the grant form
//
//  Permission gating happens at the parent (canSeeBilling), so this
//  component does not re-check; it trusts its parent.
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the developer-tools flag from localStorage. Returns false during
 * SSR / build (no window). Used to gate visibility of the grant UI for
 * non-exempt accounts so a regular owner can't see "Grant Lifetime
 * Access" by default.
 */
function _isDevToolsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('msos_show_dev_tools') === '1';
  } catch {
    return false;
  }
}

function LifetimeAccessAccordion({
  settings, open, onToggle,
}: { settings: SettingsT; open: boolean; onToggle: () => void }) {
  const { businessId } = useBrand();
  const exempt = isBillingExempt(settings);
  const lifetime = isLifetimeOwner(settings);
  const summary = exempt
    ? `Granted${settings.subscriptionOverride ? ` · ${settings.subscriptionOverride}` : ''}`
    : 'Developer · grant lifetime access';

  // ─── Grant form state ────────────────────────────────────────────
  const [reason, setReason] = useState('Founder account');
  const [override, setOverride] = useState<'lifetime' | 'beta' | 'comp' | 'internal'>('lifetime');
  const [busy, setBusy] = useState(false);

  const grant = async () => {
    if (!businessId) { addToast('No business context', 'warn'); return; }
    if (!reason.trim()) { addToast('Reason is required', 'warn'); return; }
    setBusy(true);
    try {
      await setLifetimeAccess(businessId, { reason: reason.trim(), override });
      addToast('Lifetime Pro access granted', 'success');
    } catch (e) {
      addToast((e as Error).message || 'Grant failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!businessId) { addToast('No business context', 'warn'); return; }
    const ok = window.confirm(
      'Revoke lifetime access? The account will fall back to whatever Stripe says — likely Core if no active subscription exists.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await revokeLifetimeAccess(businessId, 'Manual revoke from Settings');
      addToast('Lifetime access revoked', 'info');
    } catch (e) {
      addToast((e as Error).message || 'Revoke failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccordionShell
      title="Lifetime Pro Access"
      icon="🛡️"
      summary={summary}
      open={open}
      onToggle={onToggle}
      badge={lifetime ? 'Lifetime' : exempt ? 'Exempt' : 'Dev'}
    >
      {exempt ? (
        <>
          <div style={{
            padding: 14,
            background: 'linear-gradient(160deg, rgba(200,164,74,.08) 0%, var(--s1) 100%)',
            border: '1px solid rgba(200,164,74,.3)',
            borderRadius: 10,
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--brand-primary)', marginBottom: 8 }}>
              ✓ Lifetime Pro access active
            </div>
            <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--t2)' }}>
              <div>
                <strong style={{ color: 'var(--t1)' }}>Override type:</strong>{' '}
                {settings.subscriptionOverride || 'lifetime'}
              </div>
              {settings.exemptionReason && (
                <div>
                  <strong style={{ color: 'var(--t1)' }}>Reason:</strong> {settings.exemptionReason}
                </div>
              )}
              {settings.exemptionGrantedAt && (
                <div>
                  <strong style={{ color: 'var(--t1)' }}>Granted:</strong>{' '}
                  {new Date(settings.exemptionGrantedAt).toLocaleDateString()}
                </div>
              )}
              {settings.exemptionGrantedBy && (
                <div>
                  <strong style={{ color: 'var(--t1)' }}>By:</strong>{' '}
                  <code style={{ fontSize: 10 }}>{settings.exemptionGrantedBy.slice(0, 12)}…</code>
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5, marginBottom: 12 }}>
            This account bypasses all Stripe checks. Webhook events, payment
            failures, and subscription expirations cannot revoke access.
            Revocation is manual only.
          </div>
          <button
            className="btn danger"
            onClick={revoke}
            disabled={busy}
            style={{ width: '100%' }}
          >
            {busy ? 'Revoking…' : 'Revoke lifetime access'}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>
            Developer mode. Grant this business lifetime Pro access — bypasses
            Stripe billing permanently. Use for founder accounts, beta
            participants, or comp grants.
          </div>
          <div className="field">
            <label>Reason</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Founder account"
            />
          </div>
          <div className="field">
            <label>Override type</label>
            <select
              value={override}
              onChange={(e) => setOverride(e.target.value as typeof override)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--s1)', color: 'var(--t1)' }}
            >
              <option value="lifetime">Lifetime (founder)</option>
              <option value="beta">Beta tester</option>
              <option value="comp">Comp account</option>
              <option value="internal">Internal / team</option>
            </select>
          </div>
          <button
            className="btn primary"
            onClick={grant}
            disabled={busy || !reason.trim()}
            style={{ width: '100%' }}
          >
            {busy ? 'Granting…' : 'Grant Lifetime Pro Access'}
          </button>
        </>
      )}
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
  // Use a controlled card + click handler so mutex works. The existing
  // Accordion component manages its own open state internally — not a fit
  // for mutex. So we render the same visual shape inline here.
  //
  // Height tracking: we use a ResizeObserver instead of measuring once on
  // open. Without the observer, when the inner form becomes "dirty" and
  // adds a Save button (or a form row grows), the initial maxHeight stays
  // locked to the pre-growth measurement and the new content gets clipped
  // by the surrounding `overflow: hidden` — visually overlapping the
  // accordion below. The observer fires on every size change so maxH
  // tracks the live content height and the accordion expands smoothly
  // whenever the form grows.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (!open) {
      setMaxH(0);
      return;
    }

    // Initial measurement on open. Use rAF so the DOM has settled and
    // any newly-mounted children have laid out before we measure.
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) setMaxH(el.scrollHeight);
    });

    // Live size tracking — fires whenever the inner content grows or
    // shrinks (dirty-state Save buttons appearing, form rows wrapping,
    // pending-invite lists updating, etc.). ResizeObserver is widely
    // supported (Safari 13.1+, all modern Chromium / Firefox). The
    // typeof guard keeps this safe in case of an old browser or test
    // environment where ResizeObserver isn't defined — we just fall
    // back to the rAF-only measurement.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // contentRect.height excludes padding-box noise; scrollHeight
          // would also work here but contentRect is the value the
          // observer was designed to surface, and it doesn't risk
          // a forced layout pass on every fire.
          const next = Math.ceil(entry.contentRect.height) + 28; // +28 ≈ inner padding (top+bottom 12+16)
          // Only update when the value actually changes to avoid an
          // infinite re-render loop in pathological cases.
          setMaxH((prev) => (prev === next ? prev : next));
        }
      });
      observer.observe(el);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      if (observer) observer.disconnect();
    };
  }, [open]);

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

