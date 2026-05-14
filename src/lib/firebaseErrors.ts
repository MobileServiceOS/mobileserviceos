import { _auth } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────
//  Firebase / Firestore error handling
//
//  Centralized translation between raw Firebase error codes and
//  user-facing strings, plus structured console logging that helps
//  debug permission denials.
//
//  Two surfaces:
//    1. humanizeFirestoreError(err) — short string for toasts
//    2. logFirestoreError(context, err) — verbose console log with
//       auth state, business context, and the failing collection
//
//  The frontend should use BOTH:
//    - log first (so DevTools always has the full picture)
//    - then optionally surface the human message (sparingly — see the
//      "quiet retry" pattern in App.tsx fbListen error handler)
// ─────────────────────────────────────────────────────────────────────

/**
 * Map a raw Firebase/Firestore error code to a short, calm,
 * non-scary user-facing string. Avoid words like "fatal", "denied",
 * "error" where possible — the goal is to inform without alarming.
 *
 * Returns a generic fallback for unknown error shapes.
 */
export function humanizeFirestoreError(err: unknown): string {
  const code = extractCode(err);

  switch (code) {
    case 'permission-denied':
      return "Some data isn't accessible from this account.";
    case 'unauthenticated':
      return 'Please sign in to continue.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Connection slow — retrying in a moment.';
    case 'not-found':
      return "That record couldn't be found.";
    case 'already-exists':
      return 'That already exists.';
    case 'failed-precondition':
      return "This change couldn't be applied right now.";
    case 'cancelled':
    case 'aborted':
      return 'Action interrupted — please try again.';
    case 'resource-exhausted':
      return 'Too many requests — please wait a moment.';
    case 'invalid-argument':
      return "That information doesn't look right.";
    case 'data-loss':
    case 'internal':
      return 'Something went wrong — please try again.';
    default:
      // Unknown shape — surface a calm generic.
      return "Couldn't sync some data.";
  }
}

/**
 * True when the error is specifically a permission denial. Useful for
 * call sites that want to silently swallow permission errors (e.g.
 * an admin-only query running as a non-admin user) without showing
 * any toast.
 */
export function isPermissionDenied(err: unknown): boolean {
  return extractCode(err) === 'permission-denied';
}

/**
 * Structured console log for a Firestore failure. Captures:
 *   - context label (which collection / operation failed)
 *   - error code + message
 *   - the current auth uid (or 'unauthed')
 *   - the businessId in context, if provided
 *
 * Log format is JSON-friendly so it's easy to filter in DevTools and
 * grep in production log aggregators (if you add one later).
 */
export function logFirestoreError(
  context: string,
  err: unknown,
  extras?: Record<string, unknown>,
): void {
  const code = extractCode(err);
  const message = extractMessage(err);
  const uid = _auth?.currentUser?.uid ?? 'unauthed';
  const email = _auth?.currentUser?.email ?? null;

  const payload: Record<string, unknown> = {
    context,
    code,
    message,
    uid,
    email,
    ...(extras ?? {}),
  };

  // permission-denied is the noisiest case — log at info, not error,
  // so it doesn't fire monitoring alarms. Other codes (data loss,
  // internal, etc) get error-level logging.
  if (code === 'permission-denied' || code === 'unauthenticated') {
    // eslint-disable-next-line no-console
    console.info(`[firestore] ${context}`, payload);
  } else {
    // eslint-disable-next-line no-console
    console.error(`[firestore] ${context}`, payload);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Internals
// ─────────────────────────────────────────────────────────────────────

function extractCode(err: unknown): string {
  if (!err) return 'unknown';
  if (typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === 'string') {
      // Firestore codes come in two flavors:
      //   - bare: 'permission-denied'
      //   - prefixed: 'firestore/permission-denied'
      // Normalize to bare.
      return e.code.replace(/^firestore\//, '');
    }
    if (typeof e.name === 'string') return e.name;
  }
  return 'unknown';
}

function extractMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as { message?: unknown };
    if (typeof e.message === 'string') return e.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
