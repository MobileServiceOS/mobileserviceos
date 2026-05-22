// src/lib/errorMonitor.ts
// ═══════════════════════════════════════════════════════════════════
//  Lightweight in-house error monitoring.
//
//  WHY IN-HOUSE (not Sentry): the app runs on Firebase's free tier
//  (no Cloud Functions / Blaze) and we want zero new third-party
//  accounts. This module captures errors to a top-level Firestore
//  `errorLogs` collection — queryable from the Firebase console, no
//  external service. Swapping in Sentry later is a one-file change
//  (replace the sink in `flush`).
//
//  WHAT IT CATCHES
//  ───────────────
//   1. window 'error'            — uncaught synchronous exceptions
//   2. window 'unhandledrejection' — uncaught promise rejections
//   3. captureError(err, ctx)    — explicit, from catch blocks
//   4. captureMessage(lvl, …)    — explicit non-error signals, used
//      at the silent-failure points that bit us in production
//      (e.g. applyBrandColors rejecting a corrupt stored hex).
//
//  HARD GUARANTEES
//  ───────────────
//   • The monitor NEVER throws. Every sink write is try/caught; a
//     monitoring failure can't break the app it monitors.
//   • Deduped — identical messages within a short window are
//     collapsed, so a render loop can't write thousands of docs.
//   • Rate-capped per session (MAX_WRITES) — a pathological loop
//     costs at most MAX_WRITES Firestore writes, then goes silent.
// ═══════════════════════════════════════════════════════════════════

import { collection, addDoc } from 'firebase/firestore';
import { _db, _auth } from '@/lib/firebase';

export type ErrorLevel = 'error' | 'warning' | 'info';

interface CaptureContext {
  [key: string]: unknown;
}

// Bumped manually on release; stamped on every log so you can tell
// which build produced an error.
const APP_VERSION = '1.2.0';

// Per-session write cap. A render loop or a storm of the same
// failure can't run up an unbounded Firestore bill.
const MAX_WRITES = 25;

// Dedup window — identical (level+message) signatures inside this
// many ms collapse to a single write.
const DEDUP_WINDOW_MS = 30_000;

let writeCount = 0;
let installed = false;
const recentSignatures = new Map<string, number>();

/** True once initErrorMonitor has run — guards double-install. */
export function isErrorMonitorReady(): boolean {
  return installed;
}

/**
 * Install the global error + unhandledrejection listeners. Call once
 * at app startup (main.tsx), before React renders. Idempotent.
 */
export function initErrorMonitor(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    captureError(e.error ?? e.message, {
      kind: 'window.error',
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    captureError(e.reason, { kind: 'unhandledrejection' });
  });
}

/**
 * Capture an explicit error from a catch block.
 * Safe to call from anywhere — never throws.
 */
export function captureError(err: unknown, context?: CaptureContext): void {
  const message = extractMessage(err);
  const stack = extractStack(err);
  void flush('error', message, stack, context);
}

/**
 * Capture an explicit non-exception signal — a silent failure, a
 * fallback that fired, a "this shouldn't happen" branch.
 */
export function captureMessage(
  level: ErrorLevel,
  message: string,
  context?: CaptureContext,
): void {
  void flush(level, message, undefined, context);
}

// ─── Internals ─────────────────────────────────────────────────────

async function flush(
  level: ErrorLevel,
  message: string,
  stack: string | undefined,
  context: CaptureContext | undefined,
): Promise<void> {
  // Everything below is best-effort. A monitoring failure must never
  // surface to the user or break the calling code path.
  try {
    // Always mirror to the console — DevTools is the zero-latency
    // view even when the Firestore sink is rate-capped or offline.
    const tag = `[monitor:${level}]`;
    if (level === 'error') console.error(tag, message, context ?? '');
    else if (level === 'warning') console.warn(tag, message, context ?? '');
    else console.info(tag, message, context ?? '');

    if (writeCount >= MAX_WRITES) return;

    // Dedup identical signals inside the window.
    const sig = `${level}:${message}`;
    const now = Date.now();
    const last = recentSignatures.get(sig);
    if (last && now - last < DEDUP_WINDOW_MS) return;
    recentSignatures.set(sig, now);

    const db = _db;
    if (!db) return;

    writeCount += 1;
    await addDoc(collection(db, 'errorLogs'), {
      ts: new Date().toISOString(),
      level,
      message: message.slice(0, 1000),
      stack: (stack ?? '').slice(0, 4000),
      context: sanitizeContext(context),
      uid: _auth?.currentUser?.uid ?? null,
      email: _auth?.currentUser?.email ?? null,
      url: typeof location !== 'undefined' ? location.pathname : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      appVersion: APP_VERSION,
    });
  } catch {
    // Swallow — monitoring must never throw. The console.* above
    // already happened, so the signal isn't fully lost.
  }
}

/** Shallow-stringify context values so a Firestore write can't fail
 *  on an unserializable object (DOM node, circular ref, etc). */
function sanitizeContext(ctx: CaptureContext | undefined): Record<string, string> {
  if (!ctx) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    try {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    } catch {
      out[k] = String(v);
    }
  }
  return out;
}

function extractMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err === 'object') {
    const e = err as { message?: unknown };
    if (typeof e.message === 'string') return e.message;
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

function extractStack(err: unknown): string | undefined {
  if (err instanceof Error && typeof err.stack === 'string') return err.stack;
  return undefined;
}
