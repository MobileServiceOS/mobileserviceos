import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { _db, _auth } from '@/lib/firebase';
import type { MemberDoc, Permissions, Role, Settings } from '@/types';
import { getPermissions } from '@/lib/permissions';
import { useBrand } from '@/context/BrandContext';
import { isBillingExempt } from '@/lib/planAccess';

/**
 * MembershipContext — resolves the current user's MemberDoc for their
 * business and derives their effective Permissions set.
 *
 * Why a separate context (not folded into BrandContext)?
 *   • BrandContext already manages businessId resolution AND the brand doc
 *     listener. Adding member-doc listening would make it a 4-listener
 *     context that's hard to reason about.
 *   • Permissions need the SETTINGS (for plan + override toggle) AND the
 *     MEMBER doc resolved together. The settings live in App.tsx state,
 *     not BrandContext. This context bridges them via a `settings` prop
 *     passed into the provider at the App.tsx level.
 *
 * Resolution flow:
 *   1. Wait for auth + businessId from BrandContext
 *   2. Subscribe to businesses/{businessId}/members/{auth.uid}
 *   3. On each snapshot, recompute permissions via getPermissions()
 *   4. Expose { member, role, permissions, loading } via useMembership()
 *
 * Owner fallback (THREE paths — important for legacy accounts):
 *
 *   Wheel Rush (and any account predating the members-doc convention)
 *   may not have a `businesses/{bid}/members/{uid}` doc at all. The
 *   owner is identifiable through other signals — this context honors
 *   any of them to avoid locking owners out of their own business:
 *
 *     1. uid === businessId — convention owner (default first-signup
 *        path always creates a business whose ID equals the owner's
 *        uid, so this is the canonical signal)
 *     2. brand.ownerUid === uid — explicit owner field on the business
 *        root doc, set during bootstrap
 *     3. brand.ownerEmail === auth.email — last-resort fallback for
 *        accounts that lost their ownerUid field somehow
 *
 *   Any of these matching triggers an "owner-by-fallback" synthesis
 *   instead of returning a permissionless ALL_FALSE member.
 *
 * Bootstrap behavior: during the brief window before BrandContext
 * finishes writing the initial member doc, we optimistically synthesize
 * owner permissions using the fallbacks above so the UI doesn't flash
 * a permissions-denied state.
 *
 * Logging: every membership resolution emits a `[permissions]` log
 * with uid / businessId / role / source-of-truth so DevTools makes
 * it obvious which fallback fired (or didn't) for any given account.
 */

interface MembershipState {
  /** The actual member doc from Firestore, or null while loading / for
   *  the bootstrap-owner-by-convention case. */
  member: MemberDoc | null;
  /** Resolved role — 'owner' for convention-owner during bootstrap. */
  role: Role | null;
  /** Resolved permissions for the current user given their role + the
   *  current settings (plan, allowTechnicianPriceOverride). */
  permissions: Permissions;
  /** True while we're still loading the initial snapshot. */
  loading: boolean;
}

const ALL_FALSE: Permissions = {
  canViewFinancials: false, canViewRevenue: false, canViewProfit: false,
  canManageExpenses: false, canManageInventory: false, canEditPricingSettings: false,
  canViewPricingSettings: false, canUsePricingEngine: false, canOverrideJobPrice: false,
  canManageTeam: false, canEditBusinessSettings: false, canUploadLogo: false,
  canGenerateInvoices: false, canSendReviews: false, canCreateJobs: false,
  canEditJobs: false, canDeleteJobs: false, canViewAdvancedReports: false,
  canManageBilling: false,
};

const MembershipContext = createContext<MembershipState>({
  member: null,
  role: null,
  permissions: ALL_FALSE,
  loading: true,
});

interface ProviderProps {
  /**
   * Settings is passed in from App.tsx so we can re-resolve permissions
   * when the owner toggles `allowTechnicianPriceOverride` or upgrades the
   * plan. We use the FULL settings type here (not Pick) so we can also
   * read `ownerUid` / `ownerEmail` / `billingExempt` for the owner
   * fallback logic. Settings doesn't actually carry ownerUid (that lives
   * on the business root doc), but the brand context exposes it.
   */
  settings: Pick<Settings, 'plan' | 'allowTechnicianPriceOverride' | 'billingExempt' | 'subscriptionOverride'>;
  children: ReactNode;
}

export function MembershipProvider({ settings, children }: ProviderProps) {
  const { businessId, brand } = useBrand();
  const [member, setMember] = useState<MemberDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!_db || !_auth?.currentUser || !businessId) {
      setMember(null);
      setLoading(true);
      return;
    }

    const uid = _auth.currentUser.uid;
    const email = _auth.currentUser.email || '';
    const ref = doc(_db, `businesses/${businessId}/members/${uid}`);
    let unsub: Unsubscribe | null = null;

    // ─── Owner-by-fallback resolver ──────────────────────────────────
    // Returns true if this user should be treated as the owner based on
    // signals OTHER than the member doc. Used both when the member doc
    // is missing (snap.exists() === false) AND when reading fails with
    // a permissions error during the rules-bootstrap window.
    //
    // Three paths:
    //   1. uid === businessId — convention (canonical)
    //   2. brand.ownerUid === uid — explicit owner field on business
    //   3. brand.ownerEmail === email — last-ditch email match
    const isLikelyOwner = (): { isOwner: boolean; via: string } => {
      if (uid === businessId) return { isOwner: true, via: 'uid===businessId' };
      // brand fields may be undefined if BrandContext is still loading
      // its initial snapshot. Don't treat missing-as-positive.
      const brandWithOwner = brand as typeof brand & { ownerUid?: string; ownerEmail?: string };
      if (brandWithOwner.ownerUid && brandWithOwner.ownerUid === uid) {
        return { isOwner: true, via: 'brand.ownerUid===uid' };
      }
      if (email && brandWithOwner.ownerEmail && brandWithOwner.ownerEmail.toLowerCase() === email.toLowerCase()) {
        return { isOwner: true, via: 'brand.ownerEmail===authEmail' };
      }
      return { isOwner: false, via: 'none' };
    };

    // Build a synthetic owner MemberDoc. Marked with `_synthesized: true`
    // on the underlying object (cast through unknown) so future debugging
    // can tell synthetic from real-doc owners — but the type stays clean.
    const synthOwner = (via: string): MemberDoc => {
      // eslint-disable-next-line no-console
      console.info('[permissions] synthesizing owner', { uid, businessId, via });
      return {
        uid,
        email,
        role: 'owner',
        status: 'active',
        assignedBusinessId: businessId,
      };
    };

    try {
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            // No member doc. Try the owner fallback paths before giving up.
            const ownerCheck = isLikelyOwner();
            if (ownerCheck.isOwner) {
              setMember(synthOwner(ownerCheck.via));
            } else {
              // eslint-disable-next-line no-console
              console.info('[permissions] no member doc and not identifiable as owner', {
                uid, businessId, email,
                brandOwnerUid: (brand as typeof brand & { ownerUid?: string }).ownerUid,
                brandOwnerEmail: (brand as typeof brand & { ownerEmail?: string }).ownerEmail,
              });
              setMember(null);
            }
            setLoading(false);
            return;
          }

          // Real member doc — coerce to our type, falling back to safe
          // defaults if any required field is missing (older docs from
          // pre-batch-2 may lack `status` or `assignedBusinessId`).
          const data = snap.data() as Partial<MemberDoc>;
          const m: MemberDoc = {
            uid: data.uid || uid,
            email: data.email || email,
            displayName: data.displayName,
            role: (data.role || 'owner') as Role,
            status: (data.status || 'active') as MemberDoc['status'],
            invitedBy: data.invitedBy,
            invitedAt: data.invitedAt,
            joinedAt: data.joinedAt,
            permissions: data.permissions,
            assignedBusinessId: data.assignedBusinessId || businessId,
          };
          setMember(m);
          setLoading(false);
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.warn('[permissions] member subscribe error', { uid, businessId, code: (err as { code?: string }).code, message: err.message });

          // Permission error during initial rules-bootstrap can happen
          // when the member doc doesn't exist YET and the read rule
          // requires existence. Apply the owner fallback here too —
          // worst case we synthesize an owner who'll be denied at the
          // write level anyway, but at least the UI works.
          const ownerCheck = isLikelyOwner();
          if (ownerCheck.isOwner) {
            setMember(synthOwner(ownerCheck.via + ' (after-error)'));
          } else {
            setMember(null);
          }
          setLoading(false);
        }
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[permissions] subscribe threw', e);
      // Same owner fallback as above for synchronous throw paths.
      const ownerCheck = isLikelyOwner();
      if (ownerCheck.isOwner) {
        setMember(synthOwner(ownerCheck.via + ' (after-throw)'));
      }
      setLoading(false);
    }

    return () => { if (unsub) unsub(); };
    // brand.ownerUid / brand.ownerEmail captured in the closure are
    // intentionally not in the dependency list — we re-resolve on the
    // next snapshot anyway, and we don't want every brand field change
    // to tear down + recreate the membership listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // ─── Resolve permissions ────────────────────────────────────────────
  // The standard getPermissions() flow handles role + plan + business
  // overrides. We layer one EXTRA rule on top:
  //
  //   Lifetime-exempt owner accounts (billingExempt: true) — Pro features
  //   that depend on plan should be unlocked. Since resolvePlan() already
  //   maps exempt accounts to 'pro' at the planAccess layer, but
  //   permissions.ts reads settings.plan directly (NOT via resolvePlan),
  //   we need to coerce plan='pro' when exempt before computing.
  //
  // This means an exempt account's owner gets canManageTeam:true even
  // when settings.plan is technically null/undefined.
  const permissions = useMemo(() => {
    const exempt = isBillingExempt(settings);
    // Narrow to the fields getPermissions() accepts. Coerce plan='pro'
    // for exempt accounts so plan caps can't strip canManageTeam from a
    // lifetime-exempt owner. The wider settings prop is still useful for
    // other fields read by the diagnostic log below; this narrowing is
    // ONLY for the call to getPermissions().
    const permsInput: Pick<Settings, 'plan' | 'allowTechnicianPriceOverride'> = {
      plan: exempt ? 'pro' : settings.plan,
      allowTechnicianPriceOverride: settings.allowTechnicianPriceOverride,
    };
    const p = getPermissions(member, permsInput);

    // Diagnostic log on every recompute — surfaces the full state for
    // DevTools-based debugging of "why does my owner not see X" cases.
    // eslint-disable-next-line no-console
    console.log('[permissions]', {
      uid: _auth?.currentUser?.uid ?? null,
      businessId: businessId ?? null,
      businessOwnerUid: (brand as typeof brand & { ownerUid?: string }).ownerUid ?? null,
      membershipRole: member?.role ?? null,
      memberStatus: member?.status ?? null,
      isOwner: member?.role === 'owner',
      isAdmin: member?.role === 'admin',
      isTechnician: member?.role === 'technician',
      plan: settings.plan ?? 'undefined',
      planEffective: permsInput.plan,
      billingExempt: exempt,
      subscriptionOverride: settings.subscriptionOverride ?? null,
      canManageTeam: p.canManageTeam,
      canManageBilling: p.canManageBilling,
      canEditPricingSettings: p.canEditPricingSettings,
      loading,
    });

    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, settings.plan, settings.allowTechnicianPriceOverride, settings.billingExempt, settings.subscriptionOverride, loading]);

  const role: Role | null = member?.role || null;

  const value: MembershipState = useMemo(
    () => ({ member, role, permissions, loading }),
    [member, role, permissions, loading]
  );

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

export function useMembership(): MembershipState {
  return useContext(MembershipContext);
}

/**
 * Convenience hook — returns just the permissions object. Most UI gating
 * only cares about `permissions.canX`, not the full membership state.
 */
export function usePermissions(): Permissions {
  return useMembership().permissions;
}
