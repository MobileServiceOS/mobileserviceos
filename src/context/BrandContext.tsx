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

export function BrandProvider({ children, user }: { children: ReactNode; user: User }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
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
