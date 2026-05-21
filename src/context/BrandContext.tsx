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
import { resolveActiveBusinessId } from '@/lib/ownedBusinesses';
import { applyBrandColors, normalizeHex } from '@/lib/utils';
import { acceptInviteIfPresent } from '@/lib/invites';
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
          // Multi-business: resolve which of the user's owned
          // businesses is active. resolveActiveBusinessId() returns
          // the last-active choice when it is still owned, else the
          // primary business. For a single-business user (no
          // ownedBusinesses field) it returns exactly
          // snap.data().businessId — identical to prior behavior, so
          // every existing operator is unaffected.
          bId = resolveActiveBusinessId(snap.data().businessId, snap.data());
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
        } else if (snap.exists() && Array.isArray(snap.data().ownedBusinesses) && snap.data().ownedBusinesses.length > 0) {
          // ─── DEFENSIVE GUARD — never re-onboard an existing user ──
          //
          //  The user doc exists and HAS owned businesses, but lost
          //  its `businessId` field somehow (e.g. a partial
          //  multi-business write that touched the doc without
          //  setting businessId). Without this guard, the next
          //  branch would treat the account as a fresh founder and
          //  re-run Onboarding, which would overwrite settings/main
          //  with DEFAULT_BRAND placeholders — destroying real
          //  business data.
          //
          //  Instead: pick the first owned business as active, repair
          //  the user doc by writing businessId, and skip onboarding
          //  entirely. This is the safe recovery path.
          //
          //  Background: this guard was added after a real incident
          //  where the Wheel Rush founder's settings/main was
          //  overwritten because BrandContext re-ran the bootstrap
          //  branch after a failed createBusiness attempt.
          const owned = snap.data().ownedBusinesses as string[];
          const recovered = owned.find((id) => id === user.uid) || owned[0];
          console.warn(
            '[brand] user doc has ownedBusinesses but no businessId — recovering as',
            recovered,
            '(skipping re-onboarding)',
          );
          await setDoc(userDocRef, { businessId: recovered }, { merge: true });
          bId = recovered;
        } else {
          // ─── Pending invite check ─────────────────────────────────
          // BEFORE creating a brand new business, look for a pending
          // invite at invites/{userEmail}. If found, attach this user
          // to the inviter's business as a member with the invited
          // role — they do NOT get their own business.
          //
          // The invites module handles the user doc, members doc, and
          // invite cleanup atomically. Returns the businessId on
          // success or null if no invite exists.
          let acceptedBid: string | null = null;
          if (user.email) {
            try {
              acceptedBid = await acceptInviteIfPresent(user.uid, user.email);
            } catch (e) {
              // Non-fatal: log and fall through to first-signup flow.
              // The invitee can be invited again later if this fails.
              console.warn('[brand] invite accept failed (falling through to new business):', e);
            }
          }

          if (acceptedBid) {
            // Invite accepted — invitee is now a member of the
            // inviter's business. No bootstrap of a new business.
            bId = acceptedBid;
            console.info('[brand] joined existing business via invite', bId);
          } else {
            // ─── SAFETY CHECK before bootstrap ───────────────────────
            //
            //  Even when the user doc says "fresh signup," double-
            //  check that there isn't already a business document at
            //  businesses/{user.uid}. If there is — that means this
            //  user previously signed up, has real data there, and
            //  the user doc somehow got wiped or rolled back. We
            //  MUST NOT overwrite that business's settings/main with
            //  DEFAULT_BRAND. Repair the user doc and reuse the
            //  existing business instead.
            //
            //  This is a belt-and-suspenders guard on top of the
            //  ownedBusinesses check above. Without it, a user whose
            //  user doc never existed (some legacy account) AND
            //  whose business doc DOES exist could still get
            //  onboarded over.
            try {
              const existingBizSnap = await getDoc(doc(db, `businesses/${user.uid}`));
              if (existingBizSnap.exists()) {
                console.warn(
                  '[brand] business doc already exists for this uid — recovering instead of bootstrapping',
                );
                await setDoc(userDocRef, {
                  businessId: user.uid,
                  role: 'owner',
                  email: user.email || '',
                }, { merge: true });
                bId = user.uid;
                if (cancelled) return;
                setBusinessId(bId);
                // Continue to the snapshot listener below — no
                // settings/main write happens.
                clearTimeout(timeoutId);
                // We need to fall through to the existing onSnapshot
                // setup, so we cannot return here. Instead, we
                // re-route to the listener block by setting a flag.
                // Simpler: just continue execution; the rest of the
                // function below (setBusinessId, snapshot listener)
                // already handles bId-from-existing-business cleanly.
              } else {
                // Genuine fresh signup. Bootstrap the full structure.
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
            } catch (preflightErr) {
              // If the safety check itself fails, REFUSE TO BOOTSTRAP.
              // It is better to surface an error to the user than to
              // risk overwriting real data.
              console.error(
                '[brand] could not verify business doc before bootstrap — refusing to onboard:',
                preflightErr,
              );
              throw new Error(
                'Could not verify account state. Please reload the app.',
              );
            }
          }
        }
        if (cancelled) return;
        setBusinessId(bId);

        unsub = onSnapshot(
          doc(db, `businesses/${bId}/settings/main`),
          (bSnap: { exists(): boolean; data(): unknown } | null) => {
            if (bSnap && bSnap.exists()) {
              const data = bSnap.data() as Partial<Brand>;
              const raw: Brand = { ...DEFAULT_BRAND, ...data };
              // Auto-recover stuck accounts whose stored hex is
              // corrupted (e.g. bare "c8a44a" without leading `#`).
              // Normalizing at the read boundary means every consumer
              // — Header, invoice PDF, settings form, applyBrandColors
              // — sees canonical `#rrggbb` regardless of what's on
              // disk. Existing corruption gets healed on next save
              // via BrandSection's save-boundary normalization.
              const merged: Brand = {
                ...raw,
                primaryColor: normalizeHex(raw.primaryColor, '#f4b400'),
                accentColor: normalizeHex(raw.accentColor, '#f7ca4d'),
              };
              setBrand(merged);
              applyBrandColors(merged.primaryColor, merged.accentColor);
              document.title = (merged.businessName || 'Mobile Service OS') + ' — Mobile Tire & Roadside';
              const m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
              if (m) m.setAttribute('content', merged.businessName || 'Mobile Service OS');
            }
            // Successful read — clear the ghost-recovery guard so a
            // SUBSEQUENT ghost (e.g. user switches via the switcher
            // into another partially-created business) can self-heal
            // again within the same session.
            try { sessionStorage.removeItem('msos_brand_recovery_attempted'); } catch { /* */ }
            window.clearTimeout(timeoutId);
            setLoading(false);
          },
          (e) => {
            const err = e as { code?: string; message?: string };
            console.error('[brand] settings listener error:', {
              code: err.code,
              message: err.message,
              bId,
            });

            // ─── Auto-recovery: ghost active business ────────────────
            // A user's `activeBusinessId` can end up pointing at a
            // business whose creation never finished — typically an
            // old createBusiness attempt that wrote step 1 (the
            // users/{uid} arrayUnion + the activateBusiness pointer)
            // but failed/queued for steps 2-4. The server then sees a
            // businessId with no settings/main and no members/{uid},
            // so every read fails the isMemberOfBusiness rule check.
            // The app would be permanently locked out.
            //
            // Recovery: when the settings listener returns
            // permission-denied AND the resolved business isn't the
            // user's primary (uid == businessId), rewrite
            // activeBusinessId back to uid and reload. BrandContext
            // re-resolves to the primary on the next mount.
            //
            // Guard with sessionStorage so a recovery that itself
            // fails can't trigger a reload loop. The success branch
            // above clears the guard, so legitimate switches in the
            // same session aren't blocked.
            const RECOVERY_KEY = 'msos_brand_recovery_attempted';
            let alreadyTried = false;
            try {
              alreadyTried = sessionStorage.getItem(RECOVERY_KEY) === '1';
            } catch { /* sessionStorage unavailable */ }

            if (
              err.code === 'permission-denied' &&
              bId !== user.uid &&
              !alreadyTried
            ) {
              try { sessionStorage.setItem(RECOVERY_KEY, '1'); } catch { /* */ }
              console.warn(
                '[brand] active business inaccessible — recovering to primary',
                { ghost: bId, primary: user.uid },
              );
              void setDoc(
                userDocRef,
                { activeBusinessId: user.uid },
                { merge: true },
              )
                .catch((rerr) => {
                  console.error('[brand] recovery write failed:', rerr);
                })
                .finally(() => {
                  // Hard reload so BrandContext re-resolves cleanly
                  // from scratch — identical recovery shape to
                  // BusinessSwitcherContext.activateBusiness.
                  window.location.reload();
                });
              return;
            }

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
        const merged = { ...prev, ...updates };
        // Same normalization as the snapshot path — callers that
        // bypass BrandSection.save() (or pre-normalization changes)
        // still produce canonical colors here.
        const next: Brand = {
          ...merged,
          primaryColor: normalizeHex(merged.primaryColor, '#f4b400'),
          accentColor: normalizeHex(merged.accentColor, '#f7ca4d'),
        };
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
