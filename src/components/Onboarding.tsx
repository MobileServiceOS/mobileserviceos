import { useMemo, useState } from 'react';
import type { Brand, Settings, ServicePricing } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { uploadLogo } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { APP_LOGO } from '@/lib/defaults';
import { money } from '@/lib/utils';
import { sanitizeSubscriptionWrite } from '@/lib/planAccess';
import { foundingMemberStamp, isGrowthMode, FOUNDER_DISCOUNT_PERCENT, FOUNDER_DISCOUNT_TERM_MONTHS } from '@/lib/growthMode';
import { verticalFromBusinessType } from '@/lib/useActiveVertical';
import type { VerticalKey } from '@/lib/verticals';
import {
  readPendingRefCode,
  resolveRefCode,
  createReferralDoc,
  ensureReferralCode,
  clearPendingRefCode,
} from '@/lib/referral';
import { _auth } from '@/lib/firebase';

interface Props {
  settings: Settings;
  onComplete: (brandPatch: Partial<Brand>, settingsPatch: Partial<Settings>) => Promise<void>;
}

type Step = 1 | 2 | 3 | 4;
const TRIAL_DAYS = 14;
/**
 * Hard cap on logo upload time. The Firebase Storage SDK already
 * retries internally, but if the underlying network never settles we
 * still want to release the spinner so the user isn't stuck on a
 * "Uploading…" message forever. 30s is generous for a sub-MB image.
 */
const LOGO_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Onboarding — 4-step setup for new businesses.
 *
 *   1. Brand (name, contact, optional logo)
 *   2. Service area (state, main city, service cities, radius)
 *   3. Profit targets (weekly goal + per-service profit defaults)
 *   4. Travel & mileage (cost-per-mile + free miles) — with a final
 *      summary of every value before the user commits.
 *
 * Plan model: Mobile Service OS now ships a single Pro plan with a
 * 14-day free trial. No plan picker — `finish()` auto-assigns
 *   plan = 'pro', subscriptionStatus = 'trialing',
 *   trialStartedAt = now, trialEndsAt = +14 days, maxUsers = 5,
 * and feature flags for team/role/reports unlocked.
 *
 * The old 5-step flow with a Core-vs-Pro picker has been collapsed.
 * All Pro features ship to every new account during the trial; the
 * billing transition (Stripe) is wired in a later batch.
 */
export function Onboarding({ settings, onComplete }: Props) {
  const { brand, businessId } = useBrand();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  // Business type selection drives Step 3's content + the service-
  // seeding behavior in finish(). Defaults to whatever was already on
  // settings/main (resolveVerticalKey falls back to 'tire' when blank),
  // so a re-entering user sees their prior choice instead of being
  // silently reset.
  const [businessType, setBusinessType] = useState<VerticalKey>(() => {
    const raw = brand.businessType;
    if (raw === 'mechanic' || raw === 'detailing' || raw === 'tire') return raw;
    return 'tire';
  });
  // Reactive vertical config — re-resolves whenever the user changes
  // the picker. Tire renders the legacy three-tire-service profit-
  // targets UI; mechanic / detailing render a read-only "model
  // defaults" preview because their pricing models don't have
  // per-service profit anchors the same way.
  const vertical = useMemo(
    () => verticalFromBusinessType(businessType),
    [businessType],
  );

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

  /**
   * Logo upload handler with a hard timeout so the spinner can never
   * get stuck. Wrap `uploadLogo` in Promise.race against a setTimeout
   * rejection — whichever settles first wins. The `finally` block
   * guarantees `logoUploading` flips back to false regardless of
   * outcome. Toast feedback fires on every branch (success / error
   * / timeout) so the user always knows what happened.
   */
  const handleLogo = async (file: File) => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    if (logoUploading) return; // double-tap guard
    setLogoUploading(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // `uploadLogo` returns `Promise<string | null>` (null on a quietly-
      // skipped upload, e.g. unauthenticated state). The timeout race
      // arm must use the same union so the generic type-checks; we
      // narrow back to a non-null string at the use site below.
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
        setLogoUrl(url);
        addToast('Logo uploaded', 'success');
      } else {
        addToast('Upload returned no URL', 'error');
      }
    } catch (e) {
      addToast((e as Error).message || 'Logo upload failed', 'error');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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
        businessType,
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

      // Service pricing seeding. Strategy:
      //   1. Start with the active vertical's catalog filtered to
      //      services flagged `enabledByDefault: true` — per the
      //      Phase 2.1 spec §11 decision. This ensures a fresh
      //      mechanic / detailing account ends onboarding with
      //      every default-on service already present in settings.
      //   2. Layer the existing settings.servicePricing on top so
      //      any operator customizations (e.g. someone who edited
      //      a service price before completing onboarding) win.
      //   3. For tire, apply the three profit-target overrides the
      //      operator entered on step 3. Mechanic + detailing
      //      don't have per-service profit anchors in the
      //      onboarding UI, so step 3's mechanic/detailing
      //      placeholders don't write any per-service overrides.
      const sp: Record<string, ServicePricing> = {};
      for (const svc of vertical.services) {
        if (!svc.enabledByDefault) continue;
        sp[svc.id] = {
          enabled: true,
          basePrice: svc.defaultBasePrice,
          minProfit: svc.defaultMinProfit,
        };
      }
      // Operator's existing customizations override the vertical defaults.
      for (const [key, value] of Object.entries(settings.servicePricing || {})) {
        if (value) sp[key] = { ...sp[key], ...value };
      }

      // Tire-only: apply the three profit-target overrides from step 3.
      // pricingModel.kind === 'flat' is the tire signal; detailing also
      // has services but no per-service profit-anchor onboarding step,
      // so this guard keeps tire-specific writes scoped to tire.
      if (vertical.pricingModel.kind === 'flat') {
        const updateProfit = (key: string, profit: number) => {
          const prev = sp[key] || { enabled: true, basePrice: profit, minProfit: profit };
          sp[key] = { ...prev, enabled: true, minProfit: profit };
        };
        updateProfit('Flat Tire Repair', tireRepairProfit);
        updateProfit('Tire Replacement', tireReplaceProfit);
        updateProfit('Tire Installation', installationProfit);
      }

      // New accounts complete onboarding with NO subscription state.
      // The user lands in the app and must click Subscribe on Core or
      // Pro to enter the 14-day free trial. Stripe's Checkout Session
      // is configured with `trial_period_days: 14` (see startCheckout
      // in src/lib/stripeSync.ts) — Stripe writes the trial dates back
      // to Firestore via the Firebase Extension. The mirror in
      // stripeSync.ts then populates `subscriptionStatus`, `plan`,
      // and `trialEndsAt` on the Settings doc. The app reads those
      // from there. No app-side trial bookkeeping.
      //
      // FOUNDING MEMBER (early-access phase): while growthMode is on,
      // `foundingMemberStamp()` adds the founder fields (foundingMember,
      // founderDiscountPercent/Term, billingDeferred, founderPricingLocked,
      // foundingJoinedAt). The account uses the app free of charge —
      // billing enforcement is bypassed via isBillingExempt(). When
      // growthMode is later turned off, foundingMemberStamp() returns
      // {} and new signups go through normal Stripe checkout instead.
      const isFlatModel = vertical.pricingModel.kind === 'flat';
      const settingsPatch: Partial<Settings> = {
        weeklyGoal,
        costPerMile,
        freeMilesIncluded: freeMiles,
        // Tire-specific target-profit fields are written only for tire.
        // Mechanic / detailing leave them undefined; their pricing
        // engines don't read these fields anyway.
        ...(isFlatModel ? {
          tireRepairTargetProfit: tireRepairProfit,
          tireReplacementTargetProfit: tireReplaceProfit,
          defaultTargetProfit: Math.round((tireRepairProfit + tireReplaceProfit + installationProfit) / 3),
        } : {}),
        servicePricing: sp,
        maxUsers: 5,
        featureFlags: {
          teamAccess: true,
          technicianRoles: true,
          advancedReports: true,
        },
        ...foundingMemberStamp(),
      };

      // Defensive: if an exempt account somehow lands back on
      // onboarding, the sanitizer strips plan / subscriptionStatus /
      // trialStartedAt / trialEndsAt from the patch so the exemption
      // is preserved. Non-exempt accounts pass through unchanged.
      const safePatch = sanitizeSubscriptionWrite(settings, settingsPatch);

      await onComplete(brandPatch, safePatch);

      // ─── Post-save: referral system bookkeeping ────────────────
      // After the business is created, do TWO referral-related things:
      //
      //   1. Ensure THIS business has its own referral code (so it
      //      can refer others starting day one).
      //   2. If signup happened via a `?ref=CODE` link, create the
      //      `referrals/{id}` doc that ties this new business to the
      //      referrer. Once a Stripe subscription becomes active for
      //      this account, a Cloud Function reads that doc and applies
      //      a free-month credit to the referrer.
      //
      // Both ops are best-effort: if they fail, we log and continue.
      // The business is already saved — referral bookkeeping is
      // additive, not blocking the user's first dashboard load.
      try {
        const uid = _auth?.currentUser?.uid;
        const email = (_auth?.currentUser?.email || '').toLowerCase().trim();
        const myBusinessId = uid; // businessId == uid for owner accounts
        if (myBusinessId) {
          // (1) Generate own code if missing.
          await ensureReferralCode(myBusinessId, settings).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[Onboarding] ensureReferralCode failed (non-fatal):', err);
          });

          // (2) If signup came via a referral link, attach.
          const pendingCode = readPendingRefCode();
          if (pendingCode) {
            const referrerBusinessId = await resolveRefCode(pendingCode, myBusinessId);
            if (referrerBusinessId) {
              const refDocId = await createReferralDoc({
                referrerBusinessId,
                referredBusinessId: myBusinessId,
                referredUid: uid || '',
                referredEmail: email,
                referralCode: pendingCode,
              });
              if (refDocId) {
                // Record the referrer relationship on THIS business's
                // settings so the dashboard can show "Referred by …".
                // referralDocId is a useful cross-link too.
                await onComplete({}, {
                  referredBy: referrerBusinessId,
                  referredByCode: pendingCode,
                  referralDocId: refDocId,
                });
              }
              // Clear the pending code regardless — we've either
              // recorded it or it was unresolvable.
              clearPendingRefCode();
            } else {
              // Code didn't resolve (unknown, expired, or self-referral
              // attempt). Drop it silently.
              clearPendingRefCode();
            }
          }
        }
      } catch (referralErr) {
        // eslint-disable-next-line no-console
        console.warn('[Onboarding] referral bookkeeping failed (non-fatal):', referralErr);
      }
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
              <div className="onboarding-step-sub">Pick your service type — it shapes services, pricing, and inventory.</div>
              <div className="field">
                <label>Business type *</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { key: 'tire' as VerticalKey, label: '🛞 Tire & Roadside' },
                    { key: 'mechanic' as VerticalKey, label: '🔧 Mobile Mechanic' },
                    { key: 'detailing' as VerticalKey, label: '🚗 Car Wash & Detailing' },
                  ]).map((opt) => {
                    const selected = businessType === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setBusinessType(opt.key)}
                        aria-pressed={selected}
                        style={{
                          flex: '1 1 30%', minWidth: 0,
                          padding: '11px 8px', borderRadius: 9,
                          background: selected ? 'rgba(200,164,74,0.10)' : 'var(--s3)',
                          border: selected
                            ? '1px solid var(--brand-primary)'
                            : '1px solid var(--border)',
                          color: selected ? 'var(--brand-primary)' : 'var(--t2)',
                          fontSize: 12.5, fontWeight: selected ? 700 : 600,
                          cursor: 'pointer', lineHeight: 1.3,
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
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
                    <img src={logoUrl} alt="Logo" style={{ width: 56, height: 56, borderRadius: 10, border: '1px solid var(--border)', objectFit: 'contain', background: 'var(--s3)' }} />
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
                {!logoUrl && !logoUploading && (
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                    Skip for now — you can add a logo later in Settings.
                  </div>
                )}
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

          {step === 3 && vertical.pricingModel.kind === 'flat' && (
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

          {step === 3 && vertical.pricingModel.kind === 'labor_parts' && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Labor & Parts defaults</div>
              <div className="onboarding-step-sub">
                These power the suggested price on every job. You can fine-tune each value in Settings later.
              </div>
              <div className="field">
                <label>Weekly revenue goal ($)</label>
                <input type="number" inputMode="decimal" value={weeklyGoal} onChange={(e) => setWeeklyGoal(Number(e.target.value))} />
              </div>
              <div className="onboarding-summary" style={{ marginTop: 14 }}>
                <div className="onboarding-summary-row"><span>Labor rate</span><strong>{money(vertical.pricingModel.defaultLaborRate)} / hour</strong></div>
                <div className="onboarding-summary-row"><span>Parts markup</span><strong>{vertical.pricingModel.defaultPartsMarkupPct}%</strong></div>
                <div className="onboarding-summary-row"><span>Diagnostic fee</span><strong>{money(vertical.pricingModel.defaultDiagnosticFee)}</strong></div>
                <div className="onboarding-summary-row"><span>Min service charge</span><strong>{money(vertical.pricingModel.defaultMinServiceCharge)}</strong></div>
              </div>
              <div style={{
                marginTop: 12, fontSize: 11, color: 'var(--t3)', lineHeight: 1.4,
              }}>
                Mechanic-specific defaults. Read-only here; editing
                arrives in Settings during Phase 2.2.
              </div>
            </div>
          )}

          {step === 3 && vertical.pricingModel.kind === 'package_multiplier' && (
            <div className="onboarding-step page-enter">
              <div className="onboarding-step-title">Vehicle Size Multipliers</div>
              <div className="onboarding-step-sub">
                Package prices scale by vehicle size. You can edit these in Settings after onboarding.
              </div>
              <div className="field">
                <label>Weekly revenue goal ($)</label>
                <input type="number" inputMode="decimal" value={weeklyGoal} onChange={(e) => setWeeklyGoal(Number(e.target.value))} />
              </div>
              <div className="onboarding-summary" style={{ marginTop: 14 }}>
                {Object.entries(vertical.pricingModel.vehicleSizeMultipliers).map(([size, mult]) => (
                  <div key={size} className="onboarding-summary-row">
                    <span>{size}</span><strong>×{mult}</strong>
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: 12, fontSize: 11, color: 'var(--t3)', lineHeight: 1.4,
              }}>
                Detailing-specific defaults. Add-ons + maintenance plans
                land in Phase 2.3.
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
                {/* Tire shows the three profit-target inputs from step 3;
                    mechanic / detailing show their pricing model defaults
                    from MECHANIC_CONFIG / DETAILING_CONFIG.pricingModel so
                    the summary always reflects what step 3 confirmed. */}
                {vertical.pricingModel.kind === 'flat' && (
                  <div className="onboarding-summary-row"><span>Profit targets</span><strong>${tireRepairProfit} / ${tireReplaceProfit} / ${installationProfit}</strong></div>
                )}
                {vertical.pricingModel.kind === 'labor_parts' && (
                  <div className="onboarding-summary-row">
                    <span>Labor / Parts</span>
                    <strong>{money(vertical.pricingModel.defaultLaborRate)}/hr · +{vertical.pricingModel.defaultPartsMarkupPct}%</strong>
                  </div>
                )}
                {vertical.pricingModel.kind === 'package_multiplier' && (
                  <div className="onboarding-summary-row">
                    <span>Vertical</span><strong>{vertical.displayName}</strong>
                  </div>
                )}
                <div className="onboarding-summary-row"><span>Travel</span><strong>${costPerMile.toFixed(2)}/mi · {freeMiles} free</strong></div>
              </div>
              <div style={{
                marginTop: 14, padding: '10px 12px',
                background: 'rgba(200,164,74,.06)',
                border: '1px solid rgba(200,164,74,.2)',
                borderRadius: 10, fontSize: 11, color: 'var(--t2)', lineHeight: 1.5,
              }}>
                {isGrowthMode() ? (
                  <>
                    <strong style={{ color: 'var(--brand-primary)' }}>Founding Member access</strong>
                    <span> — full Pro features, free during early access. Your
                    founder rate ({FOUNDER_DISCOUNT_PERCENT}% off for {FOUNDER_DISCOUNT_TERM_MONTHS} months)
                    is locked in for when paid plans launch. No card required.</span>
                  </>
                ) : (
                  <>
                    <strong style={{ color: 'var(--brand-primary)' }}>{TRIAL_DAYS}-day free trial</strong>
                    <span> — pick Core or Pro after setup. Full features unlocked during trial. No card required.</span>
                  </>
                )}
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
