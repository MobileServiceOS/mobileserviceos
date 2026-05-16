import { useState } from 'react';
import type { Brand, Settings, ServicePricing } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { uploadLogo } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { APP_LOGO } from '@/lib/defaults';
import { sanitizeSubscriptionWrite } from '@/lib/planAccess';
import { foundingMemberStamp, isGrowthMode, FOUNDER_DISCOUNT_PERCENT, FOUNDER_DISCOUNT_TERM_MONTHS } from '@/lib/growthMode';
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
      const settingsPatch: Partial<Settings> = {
        weeklyGoal,
        costPerMile,
        freeMilesIncluded: freeMiles,
        tireRepairTargetProfit: tireRepairProfit,
        tireReplacementTargetProfit: tireReplaceProfit,
        defaultTargetProfit: Math.round((tireRepairProfit + tireReplaceProfit + installationProfit) / 3),
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
