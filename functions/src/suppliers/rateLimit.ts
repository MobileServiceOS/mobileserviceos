// In-memory token-bucket rate limiter, keyed by Firebase Auth uid.
//
// Tunable via the SUPPLIER_PRICING_RATE_LIMIT env var (default 5 req
// per 60s window). Tokens refill continuously over the window — a user
// who has spent all 5 tokens recovers ~1 every 12 seconds rather than
// waiting a full minute.
//
// IMPORTANT LIMITATION: this is per-instance state. Cloud Functions
// can scale to multiple instances under load; a user could spread
// requests across instances and exceed the nominal limit. For Phase 1
// (mock data, no real upstream to overload) this is fine. Phase 2 with
// real supplier APIs should swap this for a Firestore-backed counter
// or a Memorystore Redis bucket if rate is meaningful for cost or
// supplier-side ToS compliance.

interface Bucket {
  tokens: number;
  lastRefill: number; // ms epoch
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 5;

function configuredLimit(): number {
  const raw = process.env.SUPPLIER_PRICING_RATE_LIMIT;
  if (!raw) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

export function consumeRateLimitToken(uid: string, now: number = Date.now()): boolean {
  const limit = configuredLimit();
  const bucket = buckets.get(uid) ?? { tokens: limit, lastRefill: now };

  // Continuous refill: tokens regenerate proportionally to elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refill = (elapsed / WINDOW_MS) * limit;
    bucket.tokens = Math.min(limit, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens < 1) {
    buckets.set(uid, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(uid, bucket);
  return true;
}

// Test-only escape hatch. Not exported from index.ts — internal use only.
export function _resetRateLimitState(): void {
  buckets.clear();
}
