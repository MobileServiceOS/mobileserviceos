import { useState } from 'react';
import type { Brand, Settings, ServicePricing } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { uploadLogo } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { APP_LOGO } from '@/lib/defaults';

interface Props {
  settings: Settings;
  onComplete: (brandPatch: Partial<Brand>, settingsPatch: Partial<Settings>) => Promise<void>;
}

type Step = 1 | 2 | 3 | 4;

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

  const totalSteps: Step = 4;
  const next = () => setStep((s) => (Math.min(totalSteps, s + 1) as Step));
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

      const settingsPatch: Partial<Settings> = {
        weeklyGoal,
        costPerMile,
        freeMilesIncluded: freeMiles,
        tireRepairTargetProfit: tireRepairProfit,
        tireReplacementTargetProfit: tireReplaceProfit,
        defaultTargetProfit: Math.round((tireRepairProfit + tireReplaceProfit + installationProfit) / 3),
        servicePricing: sp,
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
          <img src={APP_LOGO} alt="" className="onboarding-logo" />
          <div>
            <div className="onboarding-title">Let's set up your business</div>
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
              <div className="field">
                <label>Logo (optional)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <img
                    src={logoUrl || APP_LOGO}
                    alt=""
                    style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'contain', background: 'var(--s3)' }}
                    onError={(e) => { (e.target as HTMLImageElement).src = APP_LOGO; }}
                  />
                  <div style={{ flex: 1 }}>
                    <input
                      id="onb-logo" type="file" accept="image/*"
                      style={{ display: 'none' }} disabled={logoUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogo(f); }}
                    />
                    <label htmlFor="onb-logo" className="btn sm secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>
                      {logoUploading ? 'Uploading…' : 'Upload logo'}
                    </label>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>PNG/JPG · Square recommended</div>
                  </div>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Phone</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
                </div>
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
                <input value={serviceCitiesText} onChange={(e) => setServiceCitiesText(e.target.value)} placeholder="e.g. additional cities you serve" />
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

          {step === 4 && (
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
