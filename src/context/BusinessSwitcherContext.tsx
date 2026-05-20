// ═══════════════════════════════════════════════════════════════════
//  src/context/BusinessSwitcherContext.tsx — Multi-business (STAGE 2b)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  Holds the multi-business runtime state for the signed-in user:
//    - the list of businessIds they own
//    - which one is currently active
//    - a switch() action to change the active business
//    - a createBusiness() action to add a new one (Pro-gated)
//
//  RELATIONSHIP TO BrandContext
//  ────────────────────────────
//  BrandContext resolves the active businessId on load via
//  resolveActiveBusinessId() and drives the whole app render from it.
//  This context is the *control surface* for that: switching writes
//  the new choice to users/{uid}.activeBusinessId, then reloads so
//  BrandContext re-resolves cleanly from scratch — the same code
//  path as a fresh login, so no stale data can leak between
//  businesses.
//
//  BACK-COMPAT
//  ───────────
//  A single-business user (no ownedBusinesses field) gets a list of
//  exactly [uid]. canSwitch is false, the switcher UI does not
//  render, and nothing about their experience changes.
//
//  GATING
//  ──────
//  createBusiness() is allowed only when canCreateAnotherBusiness()
//  returns true — Core plan is capped at 1 business, Pro is
//  unlimited. The cap is computed from resolvePlan(), consistent
//  with billing and Founder Access.
// ═══════════════════════════════════════════════════════════════════

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { _db } from '@/lib/firebase';
import type { Settings } from '@/types';
import {
  getOwnedBusinesses,
  resolveActiveBusinessId,
  canCreateAnotherBusiness,
  hasMultipleBusinesses,
  type UserBusinessDoc,
} from '@/lib/ownedBusinesses';
import { withTimeout } from '@/lib/promiseTimeout';

interface BusinessSwitcherValue {
  /** Every businessId the user owns (always non-empty; index 0 = primary). */
  ownedBusinesses: string[];
  /** The currently active businessId. */
  activeBusinessId: string;
  /** True when the user owns more than one business (switcher shows). */
  canSwitch: boolean;
  /** True when the user's plan allows creating another business. */
  canCreate: boolean;
  /** Still loading the user's business list. */
  loading: boolean;
  /**
   * Switch the active business. Persists the choice to
   * users/{uid}.activeBusinessId then reloads so BrandContext
   * re-resolves from scratch. No-op if the id is not owned or is
   * already active.
   */
  switchBusiness: (businessId: string) => Promise<void>;
  /**
   * Activate a business directly, skipping the owned-list guard.
   * For use immediately after createBusiness(), where the business
   * is known-valid but the in-memory owned list has not refreshed.
   */
  activateBusiness: (businessId: string) => Promise<void>;
}

const BusinessSwitcherContext = createContext<BusinessSwitcherValue>({
  ownedBusinesses: [],
  activeBusinessId: '',
  canSwitch: false,
  canCreate: false,
  loading: true,
  switchBusiness: async () => {},
  activateBusiness: async () => {},
});

export function useBusinessSwitcher(): BusinessSwitcherValue {
  return useContext(BusinessSwitcherContext);
}

interface ProviderProps {
  user: User;
  /** Active business settings — used for the Pro-gating check. */
  settings: Settings | null;
  children: ReactNode;
}

export function BusinessSwitcherProvider({ user, settings, children }: ProviderProps) {
  const [userDoc, setUserDoc] = useState<UserBusinessDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the user's business doc once on mount / user change.
  useEffect(() => {
    let cancelled = false;
    const db = _db;
    if (!db) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, `users/${user.uid}`));
        if (cancelled) return;
        setUserDoc(snap.exists() ? (snap.data() as UserBusinessDoc) : null);
      } catch (e) {
        console.warn('[business-switcher] failed to load user doc:', e);
        if (!cancelled) setUserDoc(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user.uid]);

  const ownedBusinesses = useMemo(
    () => getOwnedBusinesses(user.uid, userDoc),
    [user.uid, userDoc],
  );

  const activeBusinessId = useMemo(
    () => resolveActiveBusinessId(user.uid, userDoc),
    [user.uid, userDoc],
  );

  const canSwitch = useMemo(
    () => hasMultipleBusinesses(user.uid, userDoc),
    [user.uid, userDoc],
  );

  const canCreate = useMemo(
    () => canCreateAnotherBusiness(settings, ownedBusinesses.length),
    [settings, ownedBusinesses.length],
  );

  /**
   * Persist `businessId` as the active business and reload.
   *
   * Unlike switchBusiness(), this does NOT check the in-memory
   * ownedBusinesses list. It is used immediately after
   * createBusiness(), where the businessId was just created and
   * written to Firestore but the in-memory list (loaded once on
   * mount) has not refreshed yet. Routing a freshly-created
   * business through the stale-list guard would wrongly reject it
   * and leave the caller hanging. The business is provably valid
   * here, so the guard is correctly skipped.
   */
  const activateBusiness = useCallback(async (businessId: string) => {
    const db = _db;
    if (!db) return;
    console.info('[business-switcher] activate: writing activeBusinessId', { businessId });
    try {
      await withTimeout(
        setDoc(
          doc(db, `users/${user.uid}`),
          { activeBusinessId: businessId },
          { merge: true },
        ),
        10_000,
        'activateBusiness:setDoc',
      );
      console.info('[business-switcher] activate: write OK, reloading');
      // Full reload so BrandContext + every downstream context
      // re-resolve cleanly from scratch — identical to a fresh login.
      window.location.reload();
    } catch (e) {
      const err = e as { name?: string; message?: string };
      console.error('[business-switcher] activate failed:', { name: err.name, message: err.message, raw: e });
      if (err.name === 'TimeoutError') {
        throw new Error('Switching businesses timed out. Please check your connection and try again.');
      }
      throw e;
    }
  }, [user.uid]);

  const switchBusiness = useCallback(async (businessId: string) => {
    const db = _db;
    if (!db) return;
    // Guard: only switch to a business the user owns, and skip if
    // it is already active.
    if (!ownedBusinesses.includes(businessId)) {
      console.warn('[business-switcher] refused: not an owned business', businessId);
      return;
    }
    if (businessId === activeBusinessId) return;
    await activateBusiness(businessId);
  }, [ownedBusinesses, activeBusinessId, activateBusiness]);

  const value = useMemo<BusinessSwitcherValue>(() => ({
    ownedBusinesses,
    activeBusinessId,
    canSwitch,
    canCreate,
    loading,
    switchBusiness,
    activateBusiness,
  }), [ownedBusinesses, activeBusinessId, canSwitch, canCreate, loading, switchBusiness, activateBusiness]);

  return (
    <BusinessSwitcherContext.Provider value={value}>
      {children}
    </BusinessSwitcherContext.Provider>
  );
}
