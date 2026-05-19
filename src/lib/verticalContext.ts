// ═══════════════════════════════════════════════════════════════════
//  src/lib/verticalContext.ts — Vertical resolution layer (STAGE 1)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  The thin abstraction layer between a business's stored settings
//  and its VerticalConfig. Given a Settings object, it answers two
//  questions:
//    1. Which vertical is this business? -> resolveVerticalKey()
//    2. What is that vertical's config?  -> resolveVertical()
//
//  STAGE 1 SCOPE — IMPORTANT
//  ─────────────────────────
//  This file is PURELY ADDITIVE and currently DORMANT. Nothing in the
//  live render path imports it yet. It exists so that Stage 2+ has a
//  single, tested entry point for "what vertical am I in" — instead
//  of scattering `settings.businessType` checks across the codebase.
//
//  Removing this file (and verticals.ts) returns the app to its exact
//  prior state. That is the Stage 1 rollback.
//
//  BACK-COMPAT GUARANTEE
//  ─────────────────────
//  The crucial rule lives here: a Settings doc with NO `businessType`
//  field resolves to the tire vertical. Every business that exists
//  today predates the multi-vertical work and has no `businessType`
//  — so every one of them is correctly interpreted as a tire
//  business with ZERO data migration. Old Firestore docs stay valid
//  and readable forever.
// ═══════════════════════════════════════════════════════════════════

import type { Settings } from '@/types';
import {
  type VerticalKey,
  type VerticalConfig,
  DEFAULT_VERTICAL_KEY,
  getVerticalConfig,
} from '@/lib/verticals';

/**
 * The set of known vertical keys, used to validate whatever string
 * is stored on a settings doc. Anything not in this set (including
 * undefined, or a stale/typo value) safely degrades to the default.
 */
const KNOWN_VERTICAL_KEYS: ReadonlySet<string> = new Set<VerticalKey>([
  'tire',
  'mechanic',
  'carwash',
]);

/**
 * Settings shape this layer reads. Declared structurally (rather than
 * importing a `businessType` field that does not exist on the Settings
 * type yet) so Stage 1 does NOT modify the Settings type. The
 * `businessType` field is added to the real Settings type in a later
 * stage; until then this optional access is forward-compatible.
 */
type VerticalAwareSettings = Settings & { businessType?: string };

/**
 * Resolve the VerticalKey for a business from its Settings.
 *
 * Rules, in order:
 *   1. No settings at all            -> default vertical (tire).
 *   2. settings.businessType missing -> default vertical (tire).
 *      (This is every business that exists today.)
 *   3. settings.businessType present but not a known key
 *      (typo / stale / future value) -> default vertical (tire).
 *   4. settings.businessType is a known key -> that key.
 *
 * The function never throws and always returns a valid VerticalKey.
 */
export function resolveVerticalKey(
  settings: Settings | null | undefined,
): VerticalKey {
  if (!settings) return DEFAULT_VERTICAL_KEY;
  const raw = (settings as VerticalAwareSettings).businessType;
  if (raw && KNOWN_VERTICAL_KEYS.has(raw)) {
    return raw as VerticalKey;
  }
  return DEFAULT_VERTICAL_KEY;
}

/**
 * Resolve the full VerticalConfig for a business from its Settings.
 *
 * This is the primary entry point Stage 2+ uses to drive the UI:
 * service catalogs, job fields, inventory fields, copy, and default
 * expense categories all come from the returned config.
 *
 * Guaranteed to return a valid config — an unknown or missing
 * business type falls back to the tire vertical.
 */
export function resolveVertical(
  settings: Settings | null | undefined,
): VerticalConfig {
  return getVerticalConfig(resolveVerticalKey(settings));
}

/**
 * Convenience predicate: is this business of the given vertical?
 * Reads naturally at call sites, e.g. `if (isVertical(settings, 'tire'))`.
 */
export function isVertical(
  settings: Settings | null | undefined,
  key: VerticalKey,
): boolean {
  return resolveVerticalKey(settings) === key;
}
