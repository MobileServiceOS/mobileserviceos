// functions/src/lib/operationalSettings.ts
// ═══════════════════════════════════════════════════════════════════
//  operationalSettings — server-side path constants + readers.
//
//  Background (SP4 cutover hotfix, 2026-06-05):
//    The Settings UI's `persistSettings` flow (src/App.tsx:764) writes
//    operational fields to `businesses/{bid}/operational_settings/main`.
//    SP4A/SP4B added several operational fields to the Settings TYPE
//    (reviewAutomationEnabled, reviewSmsTemplate, googleReviewLink,
//    reviewDelayMinutes, serviceArea, missedCallAutoTextEnabled,
//    missedCallTemplate, twilioPhoneNumber, twilioPhoneNumberSid) but
//    several server functions were originally written against
//    `settings/main` (the Brand doc, owned by BrandContext) and so
//    couldn't find any of those values in production.
//
//    This module centralizes the operational doc path so every server
//    reader uses the same source. Brand fields (businessName,
//    primaryColor, ownerUid, subscriptionStatus, etc.) still live at
//    `settings/main`; helpers below offer a Brand-merging reader for
//    callers that need both (e.g. SMS rendering needs businessName
//    from Brand + missedCallTemplate from operational).
//
//  Path constants
//    OPERATIONAL_SETTINGS_COLLECTION    'operational_settings'
//    OPERATIONAL_SETTINGS_DOC_ID        'main'
//    operationalSettingsDocPath(bid)    'businesses/{bid}/operational_settings/main'
//    brandSettingsDocPath(bid)          'businesses/{bid}/settings/main'
//
//  Readers
//    readOperationalSettings(db, bid)         operational doc only
//    readBrandAndOperationalSettings(db, bid) merged: brand fields + operational fields
//
//  Routing
//    The twilio webhook (functions/src/twilioVoiceStatus.ts) queries
//    `collectionGroup('operational_settings')` filtered on
//    `twilioPhoneNumber` — see firestore.indexes.json fieldOverride.
// ═══════════════════════════════════════════════════════════════════

import type { Firestore } from 'firebase-admin/firestore';

export const OPERATIONAL_SETTINGS_COLLECTION = 'operational_settings' as const;
export const OPERATIONAL_SETTINGS_DOC_ID     = 'main' as const;
export const BRAND_SETTINGS_COLLECTION       = 'settings' as const;
export const BRAND_SETTINGS_DOC_ID           = 'main' as const;

export function operationalSettingsDocPath(businessId: string): string {
  return `businesses/${businessId}/${OPERATIONAL_SETTINGS_COLLECTION}/${OPERATIONAL_SETTINGS_DOC_ID}`;
}

export function brandSettingsDocPath(businessId: string): string {
  return `businesses/${businessId}/${BRAND_SETTINGS_COLLECTION}/${BRAND_SETTINGS_DOC_ID}`;
}

export interface OperationalSettingsRead<T extends object = Record<string, unknown>> {
  exists: boolean;
  data: T;
}

/**
 * Read the operational settings doc for a business. Returns `exists:false`
 * with an empty object when the doc is absent (callers can decide whether
 * that is fatal or recoverable). Use this for SP4A/SP4B operational
 * fields like reviewAutomationEnabled, missedCallTemplate, twilioPhoneNumber.
 */
export async function readOperationalSettings<T extends object = Record<string, unknown>>(
  db: Firestore,
  businessId: string,
): Promise<OperationalSettingsRead<T>> {
  const snap = await db.doc(operationalSettingsDocPath(businessId)).get();
  if (!snap.exists) return { exists: false, data: {} as T };
  return { exists: true, data: (snap.data() ?? {}) as T };
}

/**
 * Read BOTH the Brand doc (settings/main) AND the operational doc
 * (operational_settings/main), merging into a single object with the
 * operational fields taking precedence when they overlap.
 *
 * Used by call sites that need a Brand field (businessName for SMS
 * rendering, serviceArea fallback) alongside operational fields
 * (reviewSmsTemplate, googleReviewLink, missedCallTemplate, etc.).
 *
 * `exists` is true only when BOTH docs exist. Callers can also inspect
 * `brandExists` / `operationalExists` for finer-grained handling.
 */
export interface MergedSettingsRead<T extends object = Record<string, unknown>> {
  exists: boolean;
  brandExists: boolean;
  operationalExists: boolean;
  data: T;
}

export async function readBrandAndOperationalSettings<T extends object = Record<string, unknown>>(
  db: Firestore,
  businessId: string,
): Promise<MergedSettingsRead<T>> {
  const [brandSnap, opsSnap] = await Promise.all([
    db.doc(brandSettingsDocPath(businessId)).get(),
    db.doc(operationalSettingsDocPath(businessId)).get(),
  ]);
  const brand = brandSnap.exists ? (brandSnap.data() ?? {}) : {};
  const ops   = opsSnap.exists   ? (opsSnap.data()   ?? {}) : {};
  // Operational fields take precedence — they are the canonical home
  // for SP4A/SP4B operational data. Brand fields (businessName,
  // serviceArea-as-Brand-default, etc.) fill in where operational is
  // absent.
  const merged = { ...brand, ...ops } as T;
  return {
    exists: brandSnap.exists && opsSnap.exists,
    brandExists: brandSnap.exists,
    operationalExists: opsSnap.exists,
    data: merged,
  };
}
