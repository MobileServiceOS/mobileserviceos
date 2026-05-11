import { useEffect, useRef, useState } from 'react';
import type { Settings as SettingsT, ServicePricing, VehiclePricing, Brand } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { addToast } from '@/lib/toast';
import { uploadLogo, _auth } from '@/lib/firebase';
import { signOut, updatePassword } from 'firebase/auth';
import { APP_LOGO } from '@/lib/defaults';
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
      <PlanSection settings={settings} />
      <TeamPlaceholderSection settings={settings} />
      <PricingSection settings={settings} onSave={onSave} />
      <AccountSection />
    </div>
  );
}

function BrandSection() {
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
    <div className="form-group card-anim">
      <div className="form-group-title">Brand</div>
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

      {/* ── Technician permissions (only visible / meaningful on Pro, but
            we show it on Core too so the owner can pre-configure before
            inviting their first technician). ──────────────────── */}
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

      {dirty && <button className="btn primary" onClick={save} style={{ marginTop: 12 }}>Save Business</button>}
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
 * Read-only plan display. Shows current tier + status + a stub upgrade button
 * that's intentionally disabled — Stripe wiring lands in a future batch.
 *
 * Owners can manually flip `plan` to 'pro' in Firestore for testing the
 * team-management UI; the proper upgrade flow comes later.
 */
function PlanSection({ settings }: { settings: SettingsT }) {
  const plan: 'core' | 'pro' = settings.plan === 'pro' ? 'pro' : 'core';
  const isPro = plan === 'pro';

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Plan</div>
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
              {isPro ? 'Active' : 'Solo'}
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
    </div>
  );
}

/**
 * Team Management placeholder. Renders as locked on Core, and as a "coming
 * soon" stub on Pro — the actual invite/role/disable UI lands in batch 3.
 *
 * Why ship a placeholder now? Two reasons:
 *   1. It anchors the new section's position in Settings so the navigation
 *      muscle memory is set before the real UI lands.
 *   2. Core users see the Pro feature in context, which is the right
 *      conversion surface for the upgrade button above.
 */
function TeamPlaceholderSection({ settings }: { settings: SettingsT }) {
  const isPro = settings.plan === 'pro';

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Team Management</div>
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
