// ═══════════════════════════════════════════════════════════════════
//  src/lib/promiseTimeout.ts — Hang-proof async wrapper
// ═══════════════════════════════════════════════════════════════════
//
//  Wraps any promise with a timeout. If the inner promise has not
//  settled within `ms` milliseconds, the wrapper rejects with a
//  TimeoutError.
//
//  Built specifically to defend against Firestore writes that "hang"
//  under persistentLocalCache when the server round-trip required by
//  getAfter()-based rules takes too long or the network is flaky.
//  Without this, a hanging Firestore call leaves a UI button stuck
//  forever — no error, no resolution.
//
//  Usage:
//    await withTimeout(batch.commit(), 8000, 'createBusiness batch');
// ═══════════════════════════════════════════════════════════════════

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race `p` against a timeout. Resolves with p's value if it settles
 * first, rejects with TimeoutError if `ms` elapses first.
 *
 * The timer is cleared in both branches so it never leaks.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
