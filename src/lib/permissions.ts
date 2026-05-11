import type { Role, Permissions, Plan, Settings, MemberDoc } from '@/types';

/**
 * Centralized permissions helper.
 *
 * All UI gating and Firestore-rule reasoning flows through this module so
 * permission logic lives in exactly one place.
 *
 * Resolution order (most → least specific):
 *   1. Per-member `permissions` override (rare; only set explicitly)
 *   2. Role default (owner | admin | technician)
 *   3. Plan cap (Pro-only features stripped on Core)
 *   4. Business setting overrides (e.g. allowTechnicianPriceOverride)
 *
 * The safe baseline is ALL FALSE — a missing or invalid role grants nothing.
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
 * remove the owner. The "cannot remove the owner" rule is enforced at the
 * team-management action level (TeamManagement.tsx + firestore.rules) since
 * a single boolean can't capture it cleanly.
 */
const ADMIN_PERMISSIONS: Permissions = {
  ...OWNER_PERMISSIONS,
  canManageBilling: false,
};

/**
 * Technician — field worker. Sees what's needed to complete a job. Hidden
 * from anything that reveals company financials or lets them edit pricing.
 * `canOverrideJobPrice` is FALSE here; the business setting
 * `allowTechnicianPriceOverride` flips it ON via `applyBusinessOverrides()`.
 */
const TECHNICIAN_PERMISSIONS: Permissions = {
  ...ALL_FALSE,
  canUsePricingEngine: true,
  canCreateJobs: true,
  canEditJobs: true, // own jobs only — enforced in rules + UI
  canGenerateInvoices: true,
  canSendReviews: true,
};

/**
 * Role-only default permissions. Use when business plan / settings aren't
 * available (e.g. role preview in an invite dialog before settings load).
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
 * Apply plan-tier caps. Some permissions require Pro:
 *   • canManageTeam — Core is solo-only by definition
 *   • canViewAdvancedReports — Pro-only feature
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
 * Apply business-setting overrides:
 *   • allowTechnicianPriceOverride flips canOverrideJobPrice ON for techs.
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
 * Pass a null/undefined member to get the safe ALL_FALSE set — used for
 * unauthenticated or pre-load states.
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
  // promoting a technician to manage inventory without giving them admin.
  if (member.permissions) {
    p = { ...p, ...member.permissions };
  }
  return p;
}

/**
 * Can this actor assign the given target role?
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
 * Maximum member count allowed under this plan. Core = 1, Pro = configurable
 * (defaults to 5). Used to gate the invite button in TeamManagement.
 */
export function planSeatLimit(settings: Pick<Settings, 'plan' | 'maxUsers'>): number {
  const plan: Plan = settings.plan === 'pro' ? 'pro' : 'core';
  if (plan === 'core') return 1;
  return Math.max(1, Number(settings.maxUsers || 5));
}
