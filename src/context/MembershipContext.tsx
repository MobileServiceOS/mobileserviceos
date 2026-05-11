import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { _db, _auth } from '@/lib/firebase';
import type { MemberDoc, Permissions, Role, Settings } from '@/types';
import { getPermissions } from '@/lib/permissions';
import { useBrand } from '@/context/BrandContext';

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
 * Bootstrap behavior: when a brand-new owner signs up, BrandContext writes
 * the members doc as part of bootstrap. There's a brief window before that
 * write settles where we have a businessId but no member doc. During this
 * window we synthesize an "owner-by-convention" placeholder member so the
 * UI doesn't flash a permissions-denied state during normal signup.
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
   * plan. We only need a Pick of the relevant fields.
   */
  settings: Pick<Settings, 'plan' | 'allowTechnicianPriceOverride'>;
  children: ReactNode;
}

export function MembershipProvider({ settings, children }: ProviderProps) {
  const { businessId } = useBrand();
  const [member, setMember] = useState<MemberDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!_db || !_auth?.currentUser || !businessId) {
      setMember(null);
      setLoading(true);
      return;
    }

    const uid = _auth.currentUser.uid;
    const ref = doc(_db, `businesses/${businessId}/members/${uid}`);
    let unsub: Unsubscribe | null = null;

    try {
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            // No member doc yet. If we're the convention-owner (uid ==
            // businessId) we synthesize a placeholder so the UI doesn't
            // wait or flash a permissions-denied state. The next bootstrap
            // write will replace this synthesized member with the real one.
            if (uid === businessId) {
              setMember({
                uid,
                email: _auth?.currentUser?.email || '',
                role: 'owner',
                status: 'active',
                assignedBusinessId: businessId,
              });
            } else {
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
            email: data.email || _auth?.currentUser?.email || '',
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
          console.warn('[membership] subscribe error:', err);
          // Don't synthesize on error — we don't know if it's a permissions
          // problem or a network blip. Leave member null and let permissions
          // resolve to ALL_FALSE, which is the safe default.
          setMember(null);
          setLoading(false);
        }
      );
    } catch (e) {
      console.warn('[membership] subscribe threw:', e);
      setLoading(false);
    }

    return () => { if (unsub) unsub(); };
  }, [businessId]);

  const permissions = useMemo(
    () => getPermissions(member, settings),
    [member, settings.plan, settings.allowTechnicianPriceOverride] // eslint-disable-line react-hooks/exhaustive-deps
  );

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
