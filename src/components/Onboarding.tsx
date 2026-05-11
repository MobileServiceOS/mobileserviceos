import { useState } from 'react';
import type { Brand, Settings, ServicePricing, Plan } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { uploadLogo } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { APP_LOGO } from '@/lib/defaults';

interface Props {
  settings: Settings;
  onComplete: (brandPatch: Partial<Brand>, settingsPatch: Partial<Settings>) => Promise<void>;
}

type Step = 1 | 2 | 3 | 4 | 5;
const TRIAL_DAYS = 14;

export function Onboarding({ settings, onComplete }: Props) {
  const { brand, businessId } = useBrand();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  const [businessName, setBusinessName] = useState(brand.businessName || '');
  const [phone, setPhone] = useState(brand.phone || '');
  const [email, setEmail] = useState(brand.email || '');
  const [logoUrl, setLogoUrl] = useState(brand.logoUrl || '');

  const [stateCode, setStateCode] = useState(brand.state || '');
  const [mainCity, setMainCity] = useState(brand.mainCity || '');
  const [serviceCitiesText, setServiceCitiesText] = useState((brand.serviceCities || []).join(', '));
  const [serviceRadius, setServiceRadius] = useState<number>(Number(brand.serviceRadius || 25));

  const [plan, setPlan] = useState<Plan>(settings.plan || 'core');
  const [planTouched, setPlanTouched] = useState<boolean>(Boolean(settings.plan));

  const [weeklyGoal, setWeeklyGoal] = useState<number>(Number(settings.weeklyGoal || 1500));
  const [tireRepairProfit, setTireRepairProfit] = useState<number>(
    Number(settings.tireRepairTargetProfit ?? settings.servicePricing?.['Flat Tire Repair']?.minProfit ?? 90)
  );
  const [tireReplaceProfit, setTireReplaceProfit] = useState<number>(
    Number(settings.tireReplacementTargetProfit ?? settings.servicePricing?.['Tire Replacement']?.minProfit ?? 110)
  );
  const [installationProfit, setInstallationProfit] = useState<number>(
    Number(settings.servicePricing?.['Tire Installation']?.minProfit ?? 110)
  );
  const [costPerMile, setCostPerMile] = useState<number>(Number(settings.costPerMile || 0.65));
  const [freeMiles, setFreeMiles] = useState<number>(Number(settings.freeMilesIncluded || 5));

  const totalSteps: Step = 5;
  const next = () => {
    if (step === 3 && !planTouched) {
      addToast('Please select a plan to continue', 'warn');
      return;
    }
    setStep((s) => (Math.min(totalSteps, s + 1) as Step));
  };
  const back = () => setStep((s) => (Math.max(1, s - 1) as Step));

  const handleLogo = async (file: File) => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    setLogoUploading(true);
    try {
      const url = await uploadLogo(businessId, file);
      if (url) { setLogoUrl(url); addToast('Logo uploaded', 'success'); }
    } catch (e) {
      addToast((e as Error).message || 'Logo upload failed', 'error');
    } finally {
      setLogoUploading(false);
    }
  };

  const finish = async () => {
    if (!businessName.trim()) { addToast('Business name required', 'warn'); setStep(1); return; }
    if (!stateCode || !mainCity.trim()) { addToast('State and main city required', 'warn'); setStep(2); return; }
    if (!planTouched) { addToast('Please select a plan to continue', 'warn'); setStep(3); return; }
    setBusy(true);
    try {
      const serviceCities = serviceCitiesText.split(',').map((s) => s.trim()).filter(Boolean);
      const brandPatch: Partial<Brand> = {
        businessName: businessName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        logoUrl,
        state: stateCode,
        mainCity: mainCity.trim(),
        serviceCities,
        serviceRadius,
        serviceArea: serviceCities.length
          ? serviceCities.slice(0, 3).join(' · ') + (stateCode ? `, ${stateCode}` : '')
          : `${mainCity.trim()}${stateCode ? `, ${stateCode}` : ''}`,
        onboardingComplete: true,
        onboardingCompletedAt: new Date().toISOString(),
      };

      const sp: Record<string, ServicePricing> = { ...(settings.servicePricing || {}) };
      const update = (key: string, profit: number) => {
        const prev = sp[key] || { enabled: true, basePrice: profit, minProfit: profit };
        sp[key] = { ...prev, enabled: true, minProfit: profit };
      };
      update('Flat Tire Repair', tireRepairProfit);
      update('Tire Replacement', tireReplaceProfit);
      update('Tire Installation', installationProfit);

      const trialStart = new Date();
      const trialEnd = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const isPro = plan === 'pro';

      const settingsPatch: Partial<Settings> = {
        weeklyGoal,
        costPerMile,
        freeMilesIncluded: freeMiles,
        tireRepairTargetProfit: tireRepairProfit,
        tireReplacementTargetProfit: tireReplaceProfit,
        defaultTargetProfit: Math.round((tireRepairProfit + tireReplaceProfit + installationProfit) / 3),
        servicePricing: sp,
        plan,
        subscriptionStatus: 'trialing',
        trialStartedAt: trialStart.toISOString(),
        trialEndsAt: trialEnd.toISOString(),
        maxUsers: isPro ? 5 : 1,
        featureFlags: {
          teamAccess: isPro,
          technicianRoles: isPro,
          advancedReports: isPro,
        },
      };

      await onComplete(brandPatch, settingsPatch);
    } catch (e) {
      addToast((e as Error).message || 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-screen">
      <div className="onboarding-container">
        <div className="onboarding-header">
          <img src={logoUrl || APP_LOGO} alt="" className="onboarding-logo" />
          <div>
            <div className="onboarding-title">Welcome to Mobile Service OS</div>
            <div className="onboarding-sub">Step {step} of {totalSteps}</div>
          </div>
        </div>

        <div className="onboarding-progress">
          <div className="onboarding-progress-fill" style={{ width: (step / totalSteps) * 100 + '%' }} />
        </div>

        <div className="onboarding-body">
          {step === 1 && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Brand</div>
              <div className="onboarding-step-sub">This appears on invoices and review requests.</div>
              <div className="field">
                <label>Business name *</label>
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your business name" />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Phone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
              </div>
              <div className="field">
                <label>Logo (optional)</label>
                {logoUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src={logoUrl} alt="Logo" style={{ width: 56, height: 56, borderRadius: 10, border: '1px solid var(--border)' }} />
                    <button className="btn sm secondary" onClick={() => setLogoUrl('')}>Remove</button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleLogo(f); }}
                    disabled={logoUploading}
                  />
                )}
                {logoUploading && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Uploading…</div>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Service area</div>
              <div className="onboarding-step-sub">Where do you operate? You can edit this anytime.</div>
              <CityStateSelect
                state={stateCode}
                city={mainCity}
                onChange={({ city, state }) => { setMainCity(city); setStateCode(state); }}
                stateLabel="State *" cityLabel="Main city *"
                cityPlaceholder="Start typing your city" required
              />
              <div className="field" style={{ marginTop: 14 }}>
                <label>Other service cities (optional)</label>
                <input value={serviceCitiesText} onChange={(e) => setServiceCitiesText(e.target.value)} placeholder="Hollywood, Hialeah, Miramar" />
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Comma-separated. Used in invoices and review requests.</div>
              </div>
              <div className="field">
                <label>Service radius (miles)</label>
                <input type="number" inputMode="numeric" value={serviceRadius} onChange={(e) => setServiceRadius(Number(e.target.value))} placeholder="25" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Choose your plan</div>
              <div className="onboarding-step-sub">
                Both plans start with a {TRIAL_DAYS}-day free trial. No card required.
                You can switch plans later in Settings.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                <PlanTile
                  selected={plan === 'core' && planTouched}
                  badge="Solo operator"
                  name="Core"
                  price="Free during trial"
                  description="Everything you need to run a one-person mobile tire business."
                  features={[
                    '1 owner account',
                    'Quick Quote pricing engine',
                    'Job logging + history',
                    'Customer database',
                    'Premium invoices',
                    'Review request SMS',
                    'Inventory tracker',
                    'Expense tracking',
                    'Dashboard + reporting',
                  ]}
                  onSelect={() => { setPlan('core'); setPlanTouched(true); }}
                />
                <PlanTile
                  selected={plan === 'pro' && planTouched}
                  badge="Recommended for teams"
                  name="Pro"
                  price="Free during trial"
                  description="Everything in Core, plus the tools to bring on technicians."
                  features={[
                    'Everything in Core',
                    'Team access (up to 5 users)',
                    'Technician login accounts',
                    'Role-based permissions',
                    'Restrict technician financial access',
                    'Multi-user ready',
                    'Advanced reporting (coming soon)',
                  ]}
                  onSelect={() => { setPlan('pro'); setPlanTouched(true); }}
                />
              </div>
              <div style={{
                marginTop: 14, padding: '10px 12px',
                background: 'rgba(200,164,74,.06)',
                border: '1px solid rgba(200,164,74,.2)',
                borderRadius: 10, fontSize: 11, color: 'var(--t2)', lineHeight: 1.5,
              }}>
                <strong style={{ color: 'var(--brand-primary)' }}>Note:</strong> Billing
                will be connected later. During this beta, all features are unlocked
                while we wire up payments. Your plan choice is saved.
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Profit targets</div>
              <div className="onboarding-step-sub">Used to suggest pricing on every quote.</div>
              <div className="field">
                <label>Weekly revenue goal ($)</label>
                <input type="number" inputMode="decimal" value={weeklyGoal} onChange={(e) => setWeeklyGoal(Number(e.target.value))} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Flat repair profit ($)</label>
                  <input type="number" inputMode="decimal" value={tireRepairProfit} onChange={(e) => setTireRepairProfit(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Replacement profit ($)</label>
                  <input type="number" inputMode="decimal" value={tireReplaceProfit} onChange={(e) => setTireReplaceProfit(Number(e.target.value))} />
                </div>
              </div>
              <div className="field">
                <label>Installation profit ($)</label>
                <input type="number" inputMode="decimal" value={installationProfit} onChange={(e) => setInstallationProfit(Number(e.target.value))} />
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Travel & mileage</div>
              <div className="onboarding-step-sub">How travel costs are calculated.</div>
              <div className="field-row">
                <div className="field">
                  <label>Cost per mile ($)</label>
                  <input type="number" inputMode="decimal" step="0.05" value={costPerMile} onChange={(e) => setCostPerMile(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Free miles included</label>
                  <input type="number" inputMode="numeric" value={freeMiles} onChange={(e) => setFreeMiles(Number(e.target.value))} />
                </div>
              </div>
              <div className="onboarding-summary">
                <div className="onboarding-summary-row"><span>Business</span><strong>{businessName || '—'}</strong></div>
                <div className="onboarding-summary-row"><span>Service area</span><strong>{mainCity}{stateCode ? `, ${stateCode}` : ''}</strong></div>
                <div className="onboarding-summary-row"><span>Plan</span><strong style={{ textTransform: 'capitalize' }}>{plan} · {TRIAL_DAYS}-day trial</strong></div>
                <div className="onboarding-summary-row"><span>Weekly goal</span><strong>${weeklyGoal.toLocaleString()}</strong></div>
                <div className="onboarding-summary-row"><span>Profit targets</span><strong>${tireRepairProfit} / ${tireReplaceProfit} / ${installationProfit}</strong></div>
                <div className="onboarding-summary-row"><span>Travel</span><strong>${costPerMile.toFixed(2)}/mi · {freeMiles} free</strong></div>
              </div>
            </div>
          )}
        </div>

        <div className="onboarding-footer">
          {step > 1 ? (
            <button className="btn secondary" onClick={back} disabled={busy}>Back</button>
          ) : <span />}
          {step < totalSteps ? (
            <button className="btn primary" onClick={next}>Continue</button>
          ) : (
            <button className="btn primary" onClick={finish} disabled={busy}>
              {busy ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlanTileProps {
  selected: boolean;
  badge: string;
  name: string;
  price: string;
  description: string;
  features: string[];
  onSelect: () => void;
}

function PlanTile({ selected, badge, name, price, description, features, onSelect }: PlanTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        background: selected
          ? 'linear-gradient(160deg, rgba(200,164,74,.14) 0%, var(--s1) 80%)'
          : 'var(--s1)',
        border: selected ? '2px solid var(--brand-primary)' : '1px solid var(--border)',
        padding: selected ? '13px 13px' : '14px 14px',
        borderRadius: 14,
        color: 'var(--t1)',
        cursor: 'pointer',
        boxShadow: selected ? '0 8px 24px rgba(200,164,74,.18)' : 'none',
        transition: 'all .15s ease',
        width: '100%',
        display: 'block',
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 800, color: 'var(--brand-primary)',
        textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4,
      }}>
        {badge}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>{price}</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 10 }}>
        {description}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {features.map((f) => (
          <li key={f} style={{ fontSize: 12, color: 'var(--t2)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: 'var(--brand-primary)', fontWeight: 800, flexShrink: 0 }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {selected && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: '1px solid var(--border)',
          fontSize: 11, fontWeight: 700, color: 'var(--brand-primary)',
          textAlign: 'center',
        }}>
          ✓ Selected
        </div>
      )}
    </button>
  );
}
