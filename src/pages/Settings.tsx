import { useEffect, useState } from 'react';
import type { Settings as SettingsT } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { _auth } from '@/lib/firebase';
import { attachStripeSync } from '@/lib/stripeSync';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { BrandAccordion } from '@/components/settings/BrandSection';
import { BusinessAccordion } from '@/components/settings/BusinessSection';
import { PricingAccordion } from '@/components/settings/PricingSection';
import { VehicleAddonsAccordion } from '@/components/settings/VehiclePricingSection';
import {
  LaborPartsDefaultsAccordion,
  PackageMultiplierDefaultsAccordion,
} from '@/components/settings/VerticalDefaultsSection';
import { TeamAccordion } from '@/components/settings/TeamSection';
import { SubscriptionAccordion } from '@/components/settings/SubscriptionSection';
import { ReferralAccordion } from '@/components/settings/ReferralSection';
import { AccountAccordion } from '@/components/settings/AccountSection';

interface Props {
  settings: SettingsT;
  onSave: (next: Partial<SettingsT>) => Promise<void>;
}

/**
 * 14-day free trial — matches the value used in Onboarding. Surfaced
 * in the Subscription card so the user can see how many days remain.
 */

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
  // Active vertical drives which pricing sections render. Tire and
  // anything with pricingModel.kind === 'flat' shows the Vehicle
  // Add-ons accordion (flat-model add-on-per-vehicle-type). Mechanic
  // (labor_parts) shows the Labor & Parts Defaults accordion.
  // Detailing (package_multiplier) shows the Vehicle-Size Multipliers
  // accordion. Each section is RENDER-only in Phase 2.1 for non-tire
  // verticals (editing requires widening Settings with override
  // fields and threading them into the engines; deferred to 2.2/2.3).
  const vertical = useActiveVertical();

  // Mutex: which section is currently open. null = all collapsed.
  const [openSection, setOpenSection] = useState<string | null>('brand');

  // Auto-expand Subscription accordion when the TrialCountdownBanner's
  // Subscribe button was tapped. The banner sets a sessionStorage flag
  // before routing to this tab; we read + clear it on first render.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('msos_open_subscription') === '1') {
        sessionStorage.removeItem('msos_open_subscription');
        setOpenSection('subscription');
        // Scroll the accordion into view after the layout settles.
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>('[data-section="subscription"]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    } catch { /* */ }
  }, []);

  // Role gates. Owners and admins see everything. Technicians get a
  // stripped-down view (only Account + Sign out) per the role spec.
  //
  // Gate strategy: HIDE the accordion entirely (don't render) rather
  // than disable. This is true defense in depth — the field tech
  // never sees the controls, and Firestore rules separately block
  // the underlying writes (defense in depth #2).
  const canSeePricing = permissions.canEditPricingSettings || permissions.canViewPricingSettings;
  const canSeeFinancials = permissions.canViewFinancials;
  const canSeeBilling = permissions.canManageBilling;
  // Brand + Business + Team accordions live under one umbrella permission:
  // canEditBusinessSettings. Technicians don't have this; owners + admins
  // do. The "showOwners" block inside BusinessAccordion remains separately
  // gated by canSeeFinancials so admins can edit business settings
  // without seeing owner split %.
  const canSeeBusinessSettings = permissions.canEditBusinessSettings;
  const canSeeTeam = permissions.canManageTeam;

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

      {canSeeBusinessSettings && (
        <BrandAccordion
          open={openSection === 'brand'}
          onToggle={() => setOpenSection(openSection === 'brand' ? null : 'brand')}
        />
      )}

      {canSeeBusinessSettings && (
        <BusinessAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'business'}
          onToggle={() => setOpenSection(openSection === 'business' ? null : 'business')}
          showOwners={canSeeFinancials}
        />
      )}

      {canSeePricing && (
        <PricingAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'pricing'}
          onToggle={() => setOpenSection(openSection === 'pricing' ? null : 'pricing')}
        />
      )}

      {/* Vehicle Add-ons editor is a flat-model concept (per-vehicle
          surcharge added to the service base price). Hidden for
          verticals whose pricing model doesn't use this notion
          (mechanic / detailing). */}
      {canSeePricing && vertical.pricingModel.kind === 'flat' && (
        <VehicleAddonsAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'vehicle'}
          onToggle={() => setOpenSection(openSection === 'vehicle' ? null : 'vehicle')}
        />
      )}

      {/* Mechanic-specific defaults — read-only in Phase 2.1.
          Editing these would require widening Settings with override
          fields (laborRateOverride, partsMarkupPctOverride, etc.)
          and threading them into the labor_parts pricing engine.
          Scheduled for Phase 2.2 (mechanic full slice). */}
      {canSeePricing && vertical.pricingModel.kind === 'labor_parts' && (
        <LaborPartsDefaultsAccordion
          model={vertical.pricingModel}
          open={openSection === 'labor_parts_defaults'}
          onToggle={() => setOpenSection(openSection === 'labor_parts_defaults' ? null : 'labor_parts_defaults')}
        />
      )}

      {/* Detailing-specific defaults — read-only in Phase 2.1.
          Scheduled for Phase 2.3 (detailing full slice). */}
      {canSeePricing && vertical.pricingModel.kind === 'package_multiplier' && (
        <PackageMultiplierDefaultsAccordion
          model={vertical.pricingModel}
          open={openSection === 'package_multiplier_defaults'}
          onToggle={() => setOpenSection(openSection === 'package_multiplier_defaults' ? null : 'package_multiplier_defaults')}
        />
      )}

      {canSeeTeam && (
        <TeamAccordion
          open={openSection === 'team'}
          onToggle={() => setOpenSection(openSection === 'team' ? null : 'team')}
        />
      )}

      {canSeeBilling && (
        <SubscriptionAccordion
          settings={settings}
          open={openSection === 'subscription'}
          onToggle={() => setOpenSection(openSection === 'subscription' ? null : 'subscription')}
        />
      )}

      {/* Referrals — every business has a referral link. Free-month
          rewards apply automatically when a referred business completes
          their first paid month. Always visible (no permission gate)
          since referral revenue is owner-relevant data. Hidden until
          businessId resolves (BrandContext race on first auth load). */}
      {businessId && (
        <ReferralAccordion
          businessId={businessId}
          settings={settings}
          open={openSection === 'referrals'}
          onToggle={() => setOpenSection(openSection === 'referrals' ? null : 'referrals')}
        />
      )}
      <AccountAccordion
        open={openSection === 'account'}
        onToggle={() => setOpenSection(openSection === 'account' ? null : 'account')}
      />
    </div>
  );
}
