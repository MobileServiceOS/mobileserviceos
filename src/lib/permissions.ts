import type { Role, Permissions, Plan, Settings, MemberDoc } from '@/types';

/**
 * Centralized permissions helper.
 *
 * All UI gating and Firestore-rule reasoning flows through this module so
 * permission logic lives in exactly one place. Three callers exist:
 *
 *   1. UI code: `usePermissions()` hook (added in batch 2) returns the
 *      resolved Permissions for the current user/business.
 *   2. Pure helpers: `getRolePermissions(role)` returns the role default
 *      without needing membership context — useful for previews.
 *   3. Backend reasoning: `firestore.rules` mirrors these checks server-side
 *      so security doesn't rely on the UI being honest.
 *
 * Permission resolution order (most → least specific):
 *   1. Per-member `permissions` override (rare; only set explicitly)
 *   2. Role default (owner | admin | technician)
 *   3. ALL FALSE — the safe baseline if anything is missing/invalid
 *
 * Plan tier (`core` vs `pro`) caps a few permissions:
 *   • `canManageTeam` requires Pro (Core is solo-only)
 *   • `canViewAdvancedReports` requires Pro
 *
 * Business setting `allowTechnicianPriceOverride` further restricts
 * `canOverrideJobPrice` for technicians.
 */

const ALL_FALSE: Permissions = {
  canViewFinancials: false,
  canViewRevenue: false,
  canViewProfit: false,
  canManageExpenses: false,
  canManageInventory: false,
  canEditPricingSettings: false,
  canViewPricingSettings: false,
  canUsePricingEngine: false,
  canOverrideJobPrice: false,
  canManageTeam: false,
  canEditBusinessSettings: false,
  canUploadLogo: false,
  canGenerateInvoices: false,
  canSendReviews: false,
  canCreateJobs: false,
  canEditJobs: false,
  canDeleteJobs: false,
  canViewAdvancedReports: false,
  canManageBilling: false,
};

const OWNER_PERMISSIONS: Permissions = {
  canViewFinancials: true,
  canViewRevenue: true,
  canViewProfit: true,
  canManageExpenses: true,
  canManageInventory: true,
  canEditPricingSettings: true,
  canViewPricingSettings: true,
  canUsePricingEngine: true,
  canOverrideJobPrice: true,
  canManageTeam: true,
  canEditBusinessSettings: true,
  canUploadLogo: true,
  canGenerateInvoices: true,
  canSendReviews: true,
  canCreateJobs: true,
  canEditJobs: true,
  canDeleteJobs: true,
  canViewAdvancedReports: true,
  canManageBilling: true,
};

/**
 * Admin = owner-equivalent operationally, but cannot manage billing or
 * remove the owner. The "cannot remove the owner" check is enforced at the
 * team-management action level (in TeamManagement.tsx and firestore.rules);
 * permissions alone can't express it.
 */
const ADMIN_PERMISSIONS: Permissions = {
  ...OWNER_PERMISSIONS,
  canManageBilling: false,
};

/**
 * Technician — field worker. Sees what they need to work on a job. Hidden
 * from anything that reveals company financials or lets them change pricing.
 * `canOverrideJobPrice` is FALSE here at the role level — the business-
 * setting toggle `allowTechnicianPriceOverride` can flip it ON via
 * `applyBusinessOverrides()` below.
 */
const TECHNICIAN_PERMISSIONS: Permissions = {
  ...ALL_FALSE,
  canUsePricingEngine: true,
  canCreateJobs: true,
  canEditJobs: true,        // own jobs only — enforced in rules + UI
  canGenerateInvoices: true,
  canSendReviews: true,
  canViewPricingSettings: false, // can quote, but can't see settings page
  // The following remain FALSE explicitly for clarity even though spread
  // already set them: canViewFinancials, canViewRevenue, canViewProfit,
  // canManageExpenses, canManageInventory, canEditPricingSettings,
  // canManageTeam, canEditBusinessSettings, canUploadLogo, canDeleteJobs,
  // canViewAdvancedReports, canManageBilling, canOverrideJobPrice.
};

/**
 * Role-only default permissions. Use when business plan / settings aren't
 * available (e.g. role preview in invite dialog).
 */
export function getRolePermissions(role: Role): Permissions {
  switch (role) {
    case 'owner':      return { ...OWNER_PERMISSIONS };
    case 'admin':      return { ...ADMIN_PERMISSIONS };
    case 'technician': return { ...TECHNICIAN_PERMISSIONS };
    default:           return { ...ALL_FALSE };
  }
}

/**
 * Apply plan-tier caps to a permission set. Some permissions require Pro:
 *   • `canManageTeam` — Core is solo-only by definition
 *   • `canViewAdvancedReports` — Pro feature
 *
 * Owner of a Core business STILL gets `canEditBusinessSettings`, etc; the
 * only thing they can't do is invite teammates.
 */
function applyPlanCaps(p: Permissions, plan: Plan): Permissions {
  if (plan === 'pro') return p;
  return {
    ...p,
    canManageTeam: false,
    canViewAdvancedReports: false,
  };
}

/**
 * Apply business-level setting overrides. Currently:
 *   • `allowTechnicianPriceOverride` flips `canOverrideJobPrice` ON for
 *     technicians when enabled. Doesn't affect owner/admin (already true).
 */
function applyBusinessOverrides(
  p: Permissions,
  role: Role,
  settings: Pick<Settings, 'allowTechnicianPriceOverride'>
): Permissions {
  if (role !== 'technician') return p;
  if (settings.allowTechnicianPriceOverride === true) {
    return { ...p, canOverrideJobPrice: true };
  }
  return p;
}

/**
 * Resolve the effective permission set for a member in a business.
 *
 * Order of precedence:
 *   1. Per-member explicit `permissions` overrides (if set on MemberDoc)
 *   2. Role default
 *   3. Plan cap (Pro-only features stripped on Core)
 *   4. Business override (technician price override toggle)
 *
 * Pass an empty/null member to get the safe-default ALL_FALSE set — used
 * for unauthenticated / pre-load states.
 */
export function getPermissions(
  member: MemberDoc | null | undefined,
  settings: Pick<Settings, 'plan' | 'allowTechnicianPriceOverride'>
): Permissions {
  if (!member || member.status === 'disabled') return { ...ALL_FALSE };

  const role = member.role;
  const plan: Plan = settings.plan === 'pro' ? 'pro' : 'core';

  let p = getRolePermissions(role);
  p = applyPlanCaps(p, plan);
  p = applyBusinessOverrides(p, role, settings);

  // Per-member overrides applied last so they always win — useful for
  // promoting a technician to manage inventory without making them admin.
  if (member.permissions) {
    p = { ...p, ...member.permissions };
  }
  return p;
}

/**
 * Convenience: can this role be assigned by the given actor?
 *
 * Rules:
 *   • Owner can assign any role
 *   • Admin can assign admin or technician (not owner)
 *   • Technician cannot assign anyone
 */
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole !== 'owner';
  return false;
}

/**
 * Plan-tier seat limit. Returns the max number of *member* docs (including
 * owner) that can exist on this plan. Used to gate the invite button.
 */
export function planSeatLimit(settings: Pick<Settings, 'plan' | 'maxUsers'>): number {
  const plan: Plan = settings.plan === 'pro' ? 'pro' : 'core';
  if (plan === 'core') return 1;
  return Math.max(1, Number(settings.maxUsers || 5));
}
