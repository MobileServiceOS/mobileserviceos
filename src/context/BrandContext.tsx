import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { _db } from '@/lib/firebase';
import { DEFAULT_BRAND } from '@/lib/defaults';
import { applyBrandColors } from '@/lib/utils';
import type { Brand } from '@/types';

interface BrandContextValue {
  brand: Brand;
  businessId: string | null;
  loading: boolean;
  onboardingComplete: boolean;
  updateBrand: (updates: Partial<Brand>) => Promise<void>;
}

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  businessId: null,
  loading: true,
  onboardingComplete: false,
  updateBrand: async () => {},
});

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

// ─────────────────────────────────────────────────────────────
//  Onboarding-complete cache (H8 — offline reliability)
// ─────────────────────────────────────────────────────────────
//
// Why this exists: when a returning user opens the app and Firestore is
// slow or unreachable, the snapshot never fires and `onboardingComplete`
// stays at its default `false`. After the 6-second timeout we set
// `loading: false` and the app renders the Onboarding screen — even
// though this user finished onboarding weeks ago. That's a critical
// reliability bug for PWA usage on flaky cell connections.
//
// The fix is small: cache `onboardingComplete: true` to localStorage
// when Firestore confirms it, keyed by the user's UID. On the next
// mount, before Firestore responds, optimistically trust the cache.
// When Firestore eventually responds, the snapshot overrides whatever
// the cache said — so the cache is just an early-boot hint, not source
// of truth.
//
// Keyed by UID so a shared device with multiple users (e.g. a shop
// kiosk) keeps each user's state separate. localStorage may be
// unavailable in some embedded webviews / private modes, so every
// access is wrapped in try/catch with safe defaults.

const ONBOARDING_CACHE_PREFIX = 'msos:ob:';

function cacheKey(uid: string): string {
  return `${ONBOARDING_CACHE_PREFIX}${uid}`;
}

function readOnboardingCache(uid: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(cacheKey(uid)) === '1';
  } catch {
    return false;
  }
}

function writeOnboardingCache(uid: string, complete: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (complete) {
      localStorage.setItem(cacheKey(uid), '1');
    } else {
      // Clear the cache on explicit false (e.g. user resets account).
      // Don't leave a stale '1' that would incorrectly skip onboarding
      // on next mount.
      localStorage.removeItem(cacheKey(uid));
    }
  } catch {
    // Swallow — caching is best-effort, not load-bearing.
  }
}

export function BrandProvider({ children, user }: { children: ReactNode; user: User }) {
  // Optimistic rehydrate: if the cache says this user completed onboarding,
  // start with onboardingComplete=true so the dashboard renders immediately
  // even before Firestore responds. If Firestore later disagrees (e.g. user
  // reset their account on another device), the snapshot will override.
  const initialOnboardingComplete = user?.uid ? readOnboardingCache(user.uid) : false;
  const [brand, setBrand] = useState<Brand>(() => ({
    ...DEFAULT_BRAND,
    onboardingComplete: initialOnboardingComplete,
  }));
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !_db) {
      setLoading(false);
      return;
    }
    const db = _db;
    let unsub: () => void = () => {};
    let cancelled = false;
    const userDocRef = doc(db, `users/${user.uid}`);

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      console.warn('[brand] Firestore did not respond within 6s, proceeding with defaults.');
      setBusinessId(user.uid);
      setLoading(false);
    }, 6000);

    (async () => {
      try {
        const snap = await getDoc(userDocRef);
        if (cancelled) return;
        let bId: string;
        if (snap.exists() && snap.data().businessId) {
          bId = snap.data().businessId;
          // Backfill members doc for users who signed up before this structure was added.
          try {
            await setDoc(
              doc(db, `businesses/${bId}/members/${user.uid}`),
              { uid: user.uid, email: user.email || '', role: 'owner', addedAt: new Date().toISOString() },
              { merge: true }
            );
          } catch (e) {
            console.warn('[brand] members backfill failed (non-fatal):', e);
          }
        } else {
          // First signup: create the full required structure in dependency order.
          bId = user.uid;
          console.info('[brand] bootstrapping new business for', user.uid);

          await setDoc(userDocRef, {
            businessId: bId,
            role: 'owner',
            email: user.email || '',
            createdAt: new Date().toISOString(),
          }, { merge: true });

          await setDoc(doc(db, `businesses/${bId}`), {
            ownerUid: user.uid,
            ownerEmail: user.email || '',
            createdAt: new Date().toISOString(),
          }, { merge: true });

          await setDoc(doc(db, `businesses/${bId}/members/${user.uid}`), {
            uid: user.uid,
            email: user.email || '',
            role: 'owner',
            addedAt: new Date().toISOString(),
          }, { merge: true });

          await setDoc(doc(db, `businesses/${bId}/settings/main`), {
            ...DEFAULT_BRAND,
            email: user.email || '',
          }, { merge: true });

          console.info('[brand] bootstrap complete for business', bId);
        }
        if (cancelled) return;
        setBusinessId(bId);

        unsub = onSnapshot(
          doc(db, `businesses/${bId}/settings/main`),
          (bSnap: { exists(): boolean; data(): unknown } | null) => {
            if (bSnap && bSnap.exists()) {
              const data = bSnap.data() as Partial<Brand>;
              const merged: Brand = { ...DEFAULT_BRAND, ...data };
              setBrand(merged);
              applyBrandColors(merged.primaryColor, merged.accentColor);
              document.title = (merged.businessName || 'Mobile Service OS') + ' — Mobile Tire & Roadside';
              const m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
              if (m) m.setAttribute('content', merged.businessName || 'Mobile Service OS');
              // Persist the onboarding-complete bit so a future cold start
              // with Firestore unreachable still skips onboarding for users
              // who finished it. Idempotent — safe to write every snapshot.
              writeOnboardingCache(user.uid, !!merged.onboardingComplete);
            }
            window.clearTimeout(timeoutId);
            setLoading(false);
          },
          (e) => {
            console.error('[brand] settings listener error:', e);
            window.clearTimeout(timeoutId);
            setLoading(false);
          }
        );
      } catch (e) {
        console.error('[brand] bootstrap failed:', e);
        if (!cancelled) {
          setBusinessId(user.uid);
          window.clearTimeout(timeoutId);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      unsub();
    };
  }, [user]);

  const updateBrand = useCallback(
    async (updates: Partial<Brand>) => {
      if (!businessId || !_db) throw new Error('Not signed in or Firestore unavailable');
      try {
        await setDoc(doc(_db, `businesses/${businessId}/settings/main`), updates, { merge: true });
      } catch (e) {
        console.error('[brand] updateBrand failed:', e);
        throw e;
      }
      setBrand((prev) => {
        const next = { ...prev, ...updates };
        applyBrandColors(next.primaryColor, next.accentColor);
        document.title = (next.businessName || 'Mobile Service OS') + ' — Mobile Tire & Roadside';
        // Mirror the same cache write the snapshot does. When the user
        // taps "Finish setup" the local state update happens before the
        // snapshot fires back — without this, a fast reload after onboarding
        // could see stale cache value.
        if (user?.uid) writeOnboardingCache(user.uid, !!next.onboardingComplete);
        return next;
      });
    },
    [businessId]
  );

  return (
    <BrandContext.Provider value={{
      brand,
      businessId,
      loading,
      onboardingComplete: !!brand.onboardingComplete,
      updateBrand,
    }}>
      {children}
    </BrandContext.Provider>
  );
}
