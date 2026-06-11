import { useEffect, useState } from 'react';
import type { Settings as SettingsT } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { _auth } from '@/lib/firebase';
import { attachStripeSync } from '@/lib/stripeSync';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { BrandAccordion } from '@/components/settings/BrandSection';
import { OperationsAccordion } from '@/components/settings/OperationsSection';
import { ProfitTargetsAccordion } from '@/components/settings/ProfitTargetsSection';
import { InvoicesAccordion } from '@/components/settings/InvoicesSection';
import { CustomerDirectorySettingsSection } from '@/components/settings/CustomerDirectorySettingsSection';
import { CommunicationsSettingsSection } from '@/components/settings/CommunicationsSettingsSection';
import { ReviewAutomationSection } from '@/components/settings/ReviewAutomationSection';
import { MissedCallRecoverySection } from '@/components/settings/MissedCallRecoverySection';
import { ZettleSettingsSection } from '@/components/settings/ZettleSettingsSection';
import { ZETTLE_ENABLED } from '@/lib/zettleEnabled';
import { OwnersAccordion } from '@/components/settings/OwnersSection';
import { PricingAccordion } from '@/components/settings/PricingSection';
import { VehicleAddonsAccordion } from '@/components/settings/VehiclePricingSection';
// Phase 3 settings cleanup: the read-only Labor & Parts Defaults +
// Vehicle Size Multipliers accordions used to render the active
// vertical's pricingModel defaults as static rows. They were
// scheduled to become editable in Phase 2.2 / 2.3 but that work
// never landed, so they sat in the UI as confusing placeholders.
// Removed from the page; the actual editable mechanic-defaults
// (laborRate / partsMarkupDefault / lowStockThreshold) live in the
// new Profit Targets accordion. If the deferred edit work is
// revived later, VerticalDefaultsSection.tsx is still on disk and
// can be re-imported.
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
        return;
      }
      // Generic section deep-link — any caller (e.g. Bandilero's inline
      // "Open in Settings" connect buttons) can set this to the accordion
      // key it wants expanded, then route to the Settings tab.
      const target = sessionStorage.getItem('msos_open_section');
      if (target) {
        sessionStorage.removeItem('msos_open_section');
        setOpenSection(target);
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>(`[data-section="${target}"]`);
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
  // Brand + Operations + Profit Targets + Team accordions live under
  // one umbrella permission: canEditBusinessSettings. Technicians don't
  // have this; owners + admins do. The separate Owners & Permissions
  // accordion adds a second gate on canSeeFinancials so admins can
  // edit operational settings without seeing owner split %.
  const canSeeBusinessSettings = permissions.canEditBusinessSettings;
  const canSeeTeam = permissions.canManageTeam;
  // PayPal Zettle payment integration — owner/admin only. Same HIDE-not-
  // disable strategy: technicians never render the section, and the
  // server callables + Firestore rules block the sensitive data too.
  const canSeePaymentIntegrations = permissions.canViewPaymentIntegrations;

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

      {/* Operations — every-vertical operational settings carved out
          of the old Business junk drawer (goals, week start, travel,
          job-level tax). */}
      {canSeeBusinessSettings && (
        <OperationsAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'operations'}
          onToggle={() => setOpenSection(openSection === 'operations' ? null : 'operations')}
        />
      )}

      {/* Profit Targets — vertical-aware (tire targets OR mechanic
          labor / parts / low-stock). Hides automatically for verticals
          with no editable targets (detailing for now). */}
      {canSeeBusinessSettings && (
        <ProfitTargetsAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'profit_targets'}
          onToggle={() => setOpenSection(openSection === 'profit_targets' ? null : 'profit_targets')}
        />
      )}

      {/* Invoices — sales-tax rate, warranty footer (universal),
          warranty box (Pro), and the custom invoice footer. The
          single place to configure everything that prints on a job's
          invoice. */}
      {canSeeBusinessSettings && (
        <InvoicesAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'invoices'}
          onToggle={() => setOpenSection(openSection === 'invoices' ? null : 'invoices')}
        />
      )}

      {/* SP3 Task 11: Customer Directory — auto-save toggle +
          owner-only Backfill admin button. */}
      {canSeeBusinessSettings && businessId && (
        <CustomerDirectorySettingsSection
          businessId={businessId}
          settings={settings}
          open={openSection === 'customerDirectory'}
          onToggle={() => setOpenSection(openSection === 'customerDirectory' ? null : 'customerDirectory')}
          onSaveSettings={onSave}
        />
      )}

      {/* SP3 Task 12: Communications — Twilio provider settings,
          event toggles (lookup / SMS logging / auto-text / outbound),
          and the owner-only Test Incoming Call admin action. Connect
          form is disabled until SP4 deploys. */}
      {canSeeBusinessSettings && businessId && (
        <CommunicationsSettingsSection
          businessId={businessId}
          settings={settings}
          open={openSection === 'communications'}
          onToggle={() => setOpenSection(openSection === 'communications' ? null : 'communications')}
          onSaveSettings={onSave}
        />
      )}

      {/* SP4A: Review Automation — toggle/delay/URL/template + history.
          Ships OFF; operator enables to start queuing review SMS on
          job completion. Drainer runs every 1min and is dormant until
          Twilio env secrets land in SP4B. */}
      {canSeeBusinessSettings && businessId && (
        <ReviewAutomationSection
          businessId={businessId}
          settings={settings}
          open={openSection === 'reviewAutomation'}
          onToggle={() => setOpenSection(openSection === 'reviewAutomation' ? null : 'reviewAutomation')}
          onSaveSettings={onSave}
        />
      )}

      {/* SP4B: Missed Call Recovery — Twilio Voice Status webhook +
          auto-text + Lead queue. Ships OFF (operator opts in). Drainer
          runs every 1min and is dormant when Twilio env secrets unset. */}
      {canSeeBusinessSettings && businessId && (
        <MissedCallRecoverySection
          businessId={businessId}
          settings={settings}
          open={openSection === 'missedCallRecovery'}
          onToggle={() => setOpenSection(openSection === 'missedCallRecovery' ? null : 'missedCallRecovery')}
          onSaveSettings={onSave}
        />
      )}

      {/* PayPal Zettle — connect a Zettle account to auto-import card
          payments, match them to jobs, and mark paid. Owner/admin only.
          Ships dormant until the Zettle app secrets are set server-side. */}
      {ZETTLE_ENABLED && canSeePaymentIntegrations && businessId && (
        <ZettleSettingsSection
          businessId={businessId}
          settings={settings}
          open={openSection === 'zettle'}
          onToggle={() => setOpenSection(openSection === 'zettle' ? null : 'zettle')}
          onSaveSettings={onSave}
        />
      )}

      {/* Owners & Permissions — owner names + splits + technician
          override permission. Gated to canSeeFinancials so admins
          and technicians never render the section at all. */}
      {canSeeBusinessSettings && canSeeFinancials && (
        <OwnersAccordion
          settings={settings}
          onSave={onSave}
          open={openSection === 'owners'}
          onToggle={() => setOpenSection(openSection === 'owners' ? null : 'owners')}
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
