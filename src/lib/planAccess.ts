import type { Plan, Settings } from '@/types';

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
 * Resolution rules:
 *   1. `subscriptionStatus === 'trialing'` always resolves to 'pro'
 *      regardless of stored plan — the trial unlocks the full product.
 *   2. `plan === 'pro'` resolves to 'pro'.
 *   3. Anything else (including undefined, legacy values, or future
 *      tiers we haven't taught the resolver) resolves to 'core' as the
 *      safe-by-default fallback. The UI then shows upgrade prompts
 *      rather than silently exposing Pro features.
 *
 * Pass the FULL Settings object — not just the plan field — because
 * the resolver needs to read both `plan` AND `subscriptionStatus`.
 */
export function resolvePlan(settings: Settings | null | undefined): AccessTier {
  if (!settings) return 'core';
  if (settings.subscriptionStatus === 'trialing') return 'pro';
  if (settings.plan === 'pro') return 'pro';
  return 'core';
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
