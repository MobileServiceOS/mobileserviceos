// In-memory cache for supplier session verifications. Keyed by uid,
// invalidated when the underlying session's savedAt changes (i.e. the
// owner reconnected). Skips the real fetch to the supplier portal
// when a recent verify for the same session is still fresh.
//
// P1 audit finding (2026-05-31): without this cache, the frontend's
// auto-verify-on-mount + auto-verify-after-save flow hits the supplier
// portal twice in rapid succession every time the page is opened. The
// cache collapses repeated calls within VERIFY_CACHE_TTL_MS to a single
// real upstream request, reducing total bot-flag exposure with U.S.
// AutoForce.
//
// IMPORTANT: this cache is global per-process. It is correct ONLY when
// the calling function has maxInstances:1 set (which Phase 2a does for
// both searchWheelRushSupplierPricing and verifyWheelRushSupplierSession).
// If maxInstances is raised later, this cache becomes per-instance and
// must be migrated to Firestore.

type Status = 'valid' | 'expired' | 'missing';

interface CacheEntry {
  savedAt: string | null;   // savedAt of the stored session at cache time
  status: Status;
  checkedAt: number;        // ms epoch
}

const VERIFY_CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export interface CacheLookup {
  hit: boolean;
  status?: Status;
}

// Look up a cached verify result. Returns hit=true only if the cached
// entry references the SAME savedAt as the current session (so a fresh
// reconnect invalidates the cache) AND is within the TTL.
export function lookupVerifyCache(
  uid: string,
  currentSavedAt: string | null,
  now: number = Date.now()
): CacheLookup {
  const entry = cache.get(uid);
  if (!entry) return { hit: false };
  if (entry.savedAt !== currentSavedAt) return { hit: false };
  if (now - entry.checkedAt >= VERIFY_CACHE_TTL_MS) return { hit: false };
  return { hit: true, status: entry.status };
}

export function storeVerifyCache(
  uid: string,
  savedAt: string | null,
  status: Status,
  now: number = Date.now()
): void {
  cache.set(uid, { savedAt, status, checkedAt: now });
}

// Test-only escape hatch
export function _resetVerifyCache(): void {
  cache.clear();
}
