import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { _db, _auth } from '@/lib/firebase';
import type { MemberDoc, Permissions, Role, Settings } from '@/types';
import { getPermissions } from '@/lib/permissions';
import { resolveMemberRole } from '@/lib/resolveMemberRole';
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
  canManageTeam: false, canManageOwners: false, canEditBusinessSettings: false, canUploadLogo: false,
  canGenerateInvoices: false, canSendReviews: false, canCreateJobs: false,
  canEditJobs: false, canDeleteJobs: false, canViewAdvancedReports: false,
  canManageBilling: false, canViewPaymentIntegrations: false,
};

const MembershipContext = createContext<MembershipState>({
  member: null,
  role: null,
  permissions: ALL_FALSE,
  loading: true,
});

interface ProviderProps {
  /**
   * Full Settings object. App.tsx already passes the complete settings
   * here at runtime; the type is widened to match so we can:
   *   - Read plan + allowTechnicianPriceOverride for getPermissions()
   *   - Read billingExempt + subscriptionOverride for exemption logic
   *   - Read subscriptionStatus for trial-state-aware permissions
   *   - Pass settings directly to getPermissions() without a Pick that
   *     might drift out of sync with what permissions.ts expects
   *
   * Earlier iterations used a narrower Pick, but that created an
   * impedance mismatch with permissions.ts's getPermissions(settings: Settings)
   * signature. Widening to the full type keeps both sides aligned and
   * makes future field additions zero-friction.
   */
  settings: Settings;
  children: ReactNode;
}

export function MembershipProvider({ settings, children }: ProviderProps) {
  const { businessId, brand } = useBrand();
  const [member, setMember] = useState<MemberDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // Owner identity lives on the ROOT business doc (businesses/{id}.ownerUid
  // / ownerEmail) — NOT on settings/main, which is what `brand` mirrors. So
  // `brand.ownerUid` is always undefined and can't identify the owner. We
  // read the root doc directly here; this is the authoritative owner signal
  // for the owner-by-fallback resolver below, which matters for a
  // multi-business owner viewing a business where uid !== businessId.
  const [bizOwner, setBizOwner] = useState<{ ownerUid?: string; ownerEmail?: string }>({});
  useEffect(() => {
    if (!_db || !businessId) { setBizOwner({}); return; }
    const unsub = onSnapshot(
      doc(_db, `businesses/${businessId}`),
      (snap) => {
        const d = (snap.data() || {}) as { ownerUid?: string; ownerEmail?: string };
        setBizOwner({ ownerUid: d.ownerUid, ownerEmail: d.ownerEmail });
      },
      () => setBizOwner({}),
    );
    return () => unsub();
  }, [businessId]);

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
      // Authoritative source: the root business doc's ownerUid/ownerEmail
      // (read into bizOwner above). These may be empty while that doc is
      // still loading — don't treat missing-as-positive.
      if (bizOwner.ownerUid && bizOwner.ownerUid === uid) {
        return { isOwner: true, via: 'business.ownerUid===uid' };
      }
      if (email && bizOwner.ownerEmail && bizOwner.ownerEmail.toLowerCase() === email.toLowerCase()) {
        return { isOwner: true, via: 'business.ownerEmail===authEmail' };
      }
      // Fallback: brand (settings/main) in case a tenant mirrors owner
      // fields there. Usually undefined — harmless.
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
          //
          // Hotfix (2026-05-31, audit P1): the role default was 'owner',
          // which silently granted full privileges to any member doc
          // with a missing role field. Now resolves via the typed
          // helper that defaults to 'technician' (least privilege).
          const data = snap.data() as Partial<MemberDoc>;

          // Resolve role (least-privilege default), THEN guard the
          // canonical owner. A stale/malformed member doc — e.g. a legacy
          // doc missing `role`, which now resolves to 'technician' — must
          // not demote the actual business owner and lock them out of
          // their own financials. The owner is identifiable through
          // authoritative signals a technician can NEVER match
          // (uid===businessId, brand.ownerUid===uid, brand.ownerEmail).
          // If any fire, honor owner — exactly as we'd synthesize one when
          // the doc is missing entirely.
          let resolvedRole = resolveMemberRole(data.role);
          if (resolvedRole !== 'owner') {
            const ownerCheck = isLikelyOwner();
            if (ownerCheck.isOwner) {
              // eslint-disable-next-line no-console
              console.info('[permissions] member doc role was', resolvedRole, '— elevating to owner via', ownerCheck.via);
              resolvedRole = 'owner';
            }
          }

          const m: MemberDoc = {
            uid: data.uid || uid,
            email: data.email || email,
            displayName: data.displayName,
            role: resolvedRole,
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
    // bizOwner.ownerUid / ownerEmail are in the deps so the listener (and
    // its isLikelyOwner closure) re-resolves once the root business doc
    // finishes loading. Without this, a multi-business owner where
    // uid !== businessId would be evaluated against EMPTY owner fields (the
    // member snapshot fires before the root doc loads, no further snapshot
    // comes, and the owner signals never match) — leaving the real owner
    // locked out of financials. These change at most once after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, bizOwner.ownerUid, bizOwner.ownerEmail]);

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
  // Effective member — grants owner identity OPTIMISTICALLY from
  // authoritative signals (uid===businessId convention owner, or the root
  // business doc's ownerUid/ownerEmail) WITHOUT waiting for the member-doc
  // snapshot. That snapshot can be slow, stuck loading, or blocked (e.g.
  // an App Check / reCAPTCHA failure) — and the real owner must never see
  // a locked UI because of it. A non-owner can't match these signals
  // (their uid never equals the businessId, and they aren't named on the
  // root doc), so this never over-grants.
  const effectiveMember = useMemo<MemberDoc | null>(() => {
    if (member && member.role === 'owner') return member;
    const uid = _auth?.currentUser?.uid;
    const email = _auth?.currentUser?.email || '';
    const ownerById =
      (!!uid && uid === businessId) ||
      (!!uid && !!bizOwner.ownerUid && bizOwner.ownerUid === uid) ||
      (!!email && !!bizOwner.ownerEmail && bizOwner.ownerEmail.toLowerCase() === email.toLowerCase());
    if (ownerById && uid) {
      return { uid, email, role: 'owner', status: 'active', assignedBusinessId: businessId } as MemberDoc;
    }
    return member;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, businessId, bizOwner.ownerUid, bizOwner.ownerEmail]);

  const permissions = useMemo(() => {
    const exempt = isBillingExempt(settings);
    // For exempt accounts, spread plan='pro' so plan caps in
    // permissions.ts can't strip canManageTeam from a lifetime-exempt
    // owner — even when settings.plan is briefly undefined during the
    // initial settings load.
    const permsInput: Settings = exempt
      ? { ...settings, plan: 'pro' }
      : settings;
    const p = getPermissions(effectiveMember, permsInput);

    // Diagnostic log on every recompute — surfaces the full state for
    // DevTools-based debugging of "why does my owner not see X" cases.
    // Gated to dev: this memo recomputes on every permission-dependent
    // render, so an unconditional log spammed the on-device console.
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.log('[permissions]', {
        uid: _auth?.currentUser?.uid ?? null,
        businessId: businessId ?? null,
        businessOwnerUid: bizOwner.ownerUid ?? null,
        membershipRole: effectiveMember?.role ?? null,
        rawMemberRole: member?.role ?? null,
        ownerByIdentity: effectiveMember?.role === 'owner' && member?.role !== 'owner',
        isOwner: effectiveMember?.role === 'owner',
        plan: settings.plan ?? 'undefined',
        planEffective: permsInput.plan,
        billingExempt: exempt,
        canViewFinancials: p.canViewFinancials,
        loading,
      });
    }

    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMember, settings.plan, settings.allowTechnicianPriceOverride, settings.billingExempt, settings.subscriptionOverride, loading]);

  const role: Role | null = effectiveMember?.role || null;

  const value: MembershipState = useMemo(
    () => ({ member: effectiveMember, role, permissions, loading }),
    [effectiveMember, role, permissions, loading]
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
