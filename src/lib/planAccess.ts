import type { Plan, Settings } from '@/types';
import { isGrowthMode } from '@/lib/growthMode';

// ─────────────────────────────────────────────────────────────────────
//  Mobile Service OS — Plan Access Module
//  Single source of truth for plan-based feature gating.
//
//  All gating decisions (UI hide/disable, route blocking, server-side
//  authorization) MUST route through this module so we have exactly
//  one place to audit when the plan structure evolves.
//
//  Public API:
//    - PlanFeature           — string-literal union of every gateable feature
//    - canAccessFeature()    — boolean check for a plan + feature key
//    - hasProAccess()        — Pro-or-higher shortcut
//    - isTeamEnabled()       — multi-user / team-workflow shortcut
//    - resolvePlan()         — normalize Settings.plan into a concrete Plan
//                              (handles undefined, legacy values, future tiers)
//    - upgradeRequiredCopy   — canonical headline/body/CTA used by UpgradeModal
//    - PLAN_FEATURE_MATRIX   — readable record showing which plans grant which features
//
//  Design constraints:
//    - Pure functions only. No React, no Firestore, no side effects.
//    - Fully typed. No `any`, no `ts-ignore`.
//    - Trialing accounts are treated as Pro for the duration of the
//      trial (matches isProEntitled() in invoice.ts — see resolvePlan).
// ─────────────────────────────────────────────────────────────────────

/**
 * Gateable feature keys. Each key represents a distinct capability the
 * UI or backend may want to allow/deny based on plan. Adding a feature
 * here is the ONLY place a new gate gets defined — call sites then use
 * `canAccessFeature(plan, 'newKey')` instead of writing their own check.
 *
 * Keep these in PascalCase or camelCase for readability. They are NOT
 * surfaced to users; the human-readable upgrade copy lives in
 * `upgradeRequiredCopy`.
 */
export type PlanFeature =
  // ── Core-tier features (available to all paying plans) ────────────
  | 'quickQuote'
  | 'jobLogging'
  | 'customerManagement'
  | 'basicInvoices'
  | 'expenseTracking'
  | 'basicInventory'
  | 'pendingPayments'
  | 'profitTracking'
  | 'reviewRequests'
  | 'basicDashboard'
  | 'mobilePwa'
  | 'singleUserAccess'
  // ── Pro-exclusive features ────────────────────────────────────────
  | 'multipleUsers'
  | 'technicianAccounts'
  | 'rolePermissions'
  | 'technicianAttribution'
  | 'technicianActivityTracking'
  | 'teamInventoryWorkflow'
  | 'advancedAnalytics'
  | 'adminDashboard'
  | 'teamVisibility'
  | 'dispatchWorkflow'
  | 'multiUserJobManagement'
  | 'technicianAssignment'
  | 'teamExpenseVisibility'
  | 'teamPerformanceTracking'
  | 'ownerVsTechnicianPermissions'
  | 'multiDeviceTeamOperations'
  | 'expandedReporting'
  | 'futureIntegrationsSupport'
  // ── Branding (Pro-exclusive — invoice.ts already gates on isProEntitled) ──
  | 'brandedInvoices';

/**
 * Plan tier with optional "trialing" pseudo-plan for entitlement
 * checks. Internally resolveable from Settings (see resolvePlan).
 *
 * NOT the same as the database `Plan` type — that's the strict on-disk
 * value. This is the resolved access tier used for UI gating only.
 */
export type AccessTier = 'core' | 'pro';

/**
 * Static matrix declaring which plans grant which features. Source of
 * truth for the spec. Edit here when adding a new feature or
 * promoting a feature between tiers.
 *
 * Sentinel value `true` = the plan grants this feature.
 * Sentinel value `false` = explicitly denied.
 *
 * A missing key is treated as denied (closed by default).
 */
export const PLAN_FEATURE_MATRIX: Readonly<Record<AccessTier, Readonly<Partial<Record<PlanFeature, boolean>>>>> = {
  core: {
    quickQuote: true,
    jobLogging: true,
    customerManagement: true,
    basicInvoices: true,
    expenseTracking: true,
    basicInventory: true,
    pendingPayments: true,
    profitTracking: true,
    reviewRequests: true,
    basicDashboard: true,
    mobilePwa: true,
    singleUserAccess: true,
    // Everything below is Pro-only by spec — listed false here for
    // documentation clarity (closed-by-default would suffice but the
    // explicit `false` makes the matrix self-documenting).
    multipleUsers: false,
    technicianAccounts: false,
    rolePermissions: false,
    technicianAttribution: false,
    technicianActivityTracking: false,
    teamInventoryWorkflow: false,
    advancedAnalytics: false,
    adminDashboard: false,
    teamVisibility: false,
    dispatchWorkflow: false,
    multiUserJobManagement: false,
    technicianAssignment: false,
    teamExpenseVisibility: false,
    teamPerformanceTracking: false,
    ownerVsTechnicianPermissions: false,
    multiDeviceTeamOperations: false,
    expandedReporting: false,
    futureIntegrationsSupport: false,
    brandedInvoices: false,
  },
  pro: {
    // Pro inherits everything from Core and unlocks the Pro-exclusive set.
    quickQuote: true,
    jobLogging: true,
    customerManagement: true,
    basicInvoices: true,
    expenseTracking: true,
    basicInventory: true,
    pendingPayments: true,
    profitTracking: true,
    reviewRequests: true,
    basicDashboard: true,
    mobilePwa: true,
    singleUserAccess: true,
    multipleUsers: true,
    technicianAccounts: true,
    rolePermissions: true,
    technicianAttribution: true,
    technicianActivityTracking: true,
    teamInventoryWorkflow: true,
    advancedAnalytics: true,
    adminDashboard: true,
    teamVisibility: true,
    dispatchWorkflow: true,
    multiUserJobManagement: true,
    technicianAssignment: true,
    teamExpenseVisibility: true,
    teamPerformanceTracking: true,
    ownerVsTechnicianPermissions: true,
    multiDeviceTeamOperations: true,
    expandedReporting: true,
    futureIntegrationsSupport: true,
    brandedInvoices: true,
  },
};

/**
 * Normalize a Settings document into a concrete access tier.
 *
 * Resolution rules (in priority order — first match wins):
 *   1. `billingExempt === true` → always 'pro'. The VIP / founder /
 *      lifetime exemption layer; nothing else can downgrade.
 *   2. `subscriptionStatus === 'trialing'` always resolves to 'pro'
 *      regardless of stored plan — the trial unlocks the full product.
 *   3. `plan === 'pro'` resolves to 'pro'.
 *   4. Anything else (including undefined, legacy values, or future
 *      tiers we haven't taught the resolver) resolves to 'core' as the
 *      safe-by-default fallback. The UI then shows upgrade prompts
 *      rather than silently exposing Pro features.
 *
 * Pass the FULL Settings object — not just the plan field — because
 * the resolver needs to read `billingExempt`, `plan`, AND
 * `subscriptionStatus` to decide correctly.
 */
export function resolvePlan(settings: Settings | null | undefined): AccessTier {
  if (!settings) return 'core';
  // Founding Member early-access phase: every account gets full Pro
  // features. This mirrors the billing bypass in isBillingExempt() —
  // founders are promised the complete Pro feature set, so plan
  // resolution must grant it. When growthMode is turned off, this
  // branch stops applying and normal plan resolution resumes (a
  // founder who hasn't subscribed would then resolve per their
  // actual Stripe plan / status, as expected).
  if (isGrowthMode()) return 'pro';
  // Exemption takes precedence over every other check. By design, no
  // Stripe webhook event, expiration, or downgrade can take Pro away
  // from an exempt account. Audited via logExemptAccess() below.
  if (settings.billingExempt === true) {
    logExemptAccess(settings);
    return 'pro';
  }
  if (settings.subscriptionStatus === 'trialing') return 'pro';
  if (settings.plan === 'pro') return 'pro';
  return 'core';
}

/**
 * Test whether an account is billing-exempt. Pure read — no side
 * effects. Useful for hiding Stripe-related UI (Subscribe button,
 * trial countdown, past-due banners) on exempt accounts.
 *
 * Two ways an account becomes exempt:
 *
 *   1. Per-account exemption — `settings.billingExempt === true`.
 *      Granted via Admin SDK for VIP / lifetime / founder-comp
 *      accounts (e.g. the Wheel Rush founder account). Permanent
 *      and account-scoped.
 *
 *   2. GROWTH MODE — during the Founding Member early-access phase
 *      (`isGrowthMode()`), EVERY account is treated as billing-exempt.
 *      This is the single chokepoint that bypasses forced checkout,
 *      trial-expiration lockouts, and feature-lock modals while the
 *      app is in early access. It deletes NO billing architecture —
 *      Stripe, webhooks, the subscription mirror, and referral
 *      rewards all stay intact. Flipping `GROWTH_MODE` to false in
 *      src/lib/growthMode.ts cleanly re-enables enforcement: this
 *      function stops returning true for non-exempt accounts, and
 *      every paywall path re-engages automatically.
 *
 * Note: a `growthMode`-driven exemption is intentionally NOT written
 * to Firestore — it is computed at read time. That keeps the toggle
 * a pure build-time switch with no data migration in either
 * direction, and prevents an exemption from being "stuck" on an
 * account after billing reactivates.
 */
export function isBillingExempt(settings: Settings | null | undefined): boolean {
  // Early-access phase: billing enforcement is globally bypassed.
  if (isGrowthMode()) return true;
  // Normal operation: only explicitly-granted accounts are exempt.
  return settings?.billingExempt === true;
}

/**
 * Does the account have a confirmed PAID or TRIALING subscription
 * mirrored from Stripe? Used by the Settings UI to decide whether to
 * show a "Current Plan" badge — never show that badge for accounts
 * that just have a defaulted plan field (i.e. brand-new signups that
 * haven't subscribed yet).
 *
 * Returns true when:
 *   - account is billing-exempt (Wheel Rush founder), OR
 *   - subscriptionStatus is 'active', 'trialing', or 'past_due'
 *     (past_due still shows current plan so the user knows what to
 *     update payment for).
 *
 * Returns false for new signups with no subscription, canceled
 * subscriptions, and any unknown / inactive state.
 */
export function hasActiveSubscription(settings: Settings | null | undefined): boolean {
  if (!settings) return false;
  // During the Founding Member early-access phase every account has
  // active (founder) access — keeps the Settings UI consistent with
  // isBillingExempt() above.
  if (isGrowthMode()) return true;
  if (settings.billingExempt === true) return true;
  const s = settings.subscriptionStatus;
  return s === 'active' || s === 'trialing' || s === 'past_due';
}

// ─────────────────────────────────────────────────────────────────────
//  Exemption access logging
//
//  Every plan resolution on an exempt account fires through here.
//  Logs are throttled per-session (10s minimum between repeats with the
//  same exemption reason) so a busy page doesn't flood the console.
//
//  Production: writes to console.info so the entry is visible without
//  being treated as an error by uptime monitors. Future enhancement
//  could pipe these through a Cloud Function for centralized audit
//  trail — leaving the local-console approach for now since it's
//  zero-cost and immediately useful for debugging.
// ─────────────────────────────────────────────────────────────────────

const _exemptLogThrottle = new Map<string, number>();
const EXEMPT_LOG_THROTTLE_MS = 10_000;

function logExemptAccess(settings: Settings): void {
  if (typeof window === 'undefined') return; // SSR/build-time skip
  const key = `${settings.exemptionGrantedBy || 'unknown'}:${settings.subscriptionOverride || 'unspecified'}`;
  const now = Date.now();
  const last = _exemptLogThrottle.get(key);
  if (last && now - last < EXEMPT_LOG_THROTTLE_MS) return;
  _exemptLogThrottle.set(key, now);
  // eslint-disable-next-line no-console
  console.info('[planAccess] Billing exemption active', {
    override: settings.subscriptionOverride || 'lifetime',
    reason: settings.exemptionReason || '(no reason recorded)',
    grantedAt: settings.exemptionGrantedAt || '(no timestamp)',
    grantedBy: settings.exemptionGrantedBy || '(unknown)',
  });
}

/**
 * Test whether a plan grants access to a specific feature.
 *
 * The first argument can be EITHER a resolved tier ('core' | 'pro')
 * OR a Settings object — the function detects which and resolves
 * internally. Most call sites should pass Settings so the trialing
 * resolution is automatic.
 *
 *   canAccessFeature(settings, 'teamInventoryWorkflow')   // ← preferred
 *   canAccessFeature('pro', 'teamInventoryWorkflow')      // ← also fine for tests
 *
 * Returns false on undefined feature keys (closed by default).
 */
export function canAccessFeature(
  planOrSettings: AccessTier | Settings | null | undefined,
  feature: PlanFeature,
): boolean {
  // Branch on input shape — strings are pre-resolved tiers, anything
  // else (object/null/undefined) gets routed through resolvePlan().
  // TS needs an explicit literal narrowing here because the union
  // AccessTier | Settings overlaps neither at runtime; the explicit
  // 'core'/'pro' check satisfies the narrower without an `as` cast.
  let tier: AccessTier;
  if (planOrSettings === 'core' || planOrSettings === 'pro') {
    tier = planOrSettings;
  } else {
    tier = resolvePlan(planOrSettings);
  }
  const grant = PLAN_FEATURE_MATRIX[tier][feature];
  return grant === true;
}

/**
 * True when the resolved access tier is Pro (or trialing).
 * Shortcut for the common "is this user paid Pro?" check that
 * doesn't care about the specific feature.
 */
export function hasProAccess(settings: Settings | null | undefined): boolean {
  return resolvePlan(settings) === 'pro';
}

/**
 * True when team / multi-user features are available. Synonym for
 * `hasProAccess` today since team workflow is Pro-only, but kept as
 * a separate function so future tiers (e.g. "team-only Lite") can
 * change the semantics without touching every call site.
 */
export function isTeamEnabled(settings: Settings | null | undefined): boolean {
  return canAccessFeature(settings, 'multipleUsers');
}

/**
 * Canonical copy for the upgrade prompt. Imported by UpgradeModal and
 * any other component that needs to display the same message. Single
 * source of truth so marketing changes in one place.
 */
export const upgradeRequiredCopy = {
  headline: 'Upgrade to Pro',
  body: 'Unlock technician management, team workflows, advanced analytics, and multi-user operations.',
  cta: 'Upgrade to Pro',
} as const;

/**
 * Convenience predicate: does this Plan literal value map to Pro
 * access? Used in places that have a raw Plan string (e.g. from a
 * Firestore listener payload) and haven't yet read the full Settings
 * document. Prefer `hasProAccess(settings)` whenever Settings is
 * already in hand — that path also honors the trialing status.
 */
export function planLiteralIsPro(plan: Plan | null | undefined): boolean {
  return plan === 'pro';
}

// ─────────────────────────────────────────────────────────────────────
//  Defensive write guard for exempt accounts
//
//  Use as a final pre-flight on any code path that writes to the
//  Settings document. If the target account is billing-exempt, this
//  helper strips out fields that could downgrade or otherwise affect
//  the exemption, returning a sanitized patch. Non-exempt accounts
//  pass through unchanged.
//
//  Pattern:
//      const patch = sanitizeSubscriptionWrite(currentSettings, {
//        plan: 'core',
//        subscriptionStatus: 'canceled',
//        someOtherField: 'fine to write',
//      });
//      await setDoc(ref, patch, { merge: true });
//
//  For exempt accounts, the example above would write only
//  `{ someOtherField: 'fine to write' }`, leaving plan and
//  subscriptionStatus intact.
// ─────────────────────────────────────────────────────────────────────

/**
 * Fields that the exemption layer protects from being overwritten. If
 * any of these appear in a patch targeting an exempt account, they're
 * silently dropped by `sanitizeSubscriptionWrite()`. The exempt
 * account's own values for these fields stay authoritative.
 */
const PROTECTED_SUBSCRIPTION_FIELDS = [
  'plan',
  'subscriptionStatus',
  'trialStartedAt',
  'trialEndsAt',
] as const;

/**
 * Strip subscription-affecting fields from a write patch if the target
 * Settings is billing-exempt. Returns the input unchanged for non-
 * exempt accounts. Always returns a fresh object — never mutates the
 * input.
 *
 * @param currentSettings  The CURRENT Settings doc (read before the
 *                         write) — used to check the exemption flag
 * @param patch            The intended write payload
 */
export function sanitizeSubscriptionWrite<T extends Record<string, unknown>>(
  currentSettings: Settings | null | undefined,
  patch: T,
): Partial<T> {
  if (!isBillingExempt(currentSettings)) return patch;
  const out: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const key of Object.keys(patch)) {
    if ((PROTECTED_SUBSCRIPTION_FIELDS as readonly string[]).includes(key)) {
      stripped.push(key);
      continue;
    }
    out[key] = patch[key];
  }
  if (stripped.length > 0 && typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.info(
      '[planAccess] sanitizeSubscriptionWrite — stripped protected fields from exempt account',
      { stripped },
    );
  }
  return out as Partial<T>;
}
