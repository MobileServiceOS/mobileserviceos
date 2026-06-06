// src/lib/searchCustomers.ts
// ═══════════════════════════════════════════════════════════════════
//  Global multi-field customer search.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Global Customer Search (Phase 5)"
//
//  Algorithm (T1 server-side path):
//    1. Short-circuit if q.length < 2 AND qDigits.length < 2.
//    2. Build high-sentinel: `qHigh = q + ''`. Digit branch uses ':'.
//    3. Fan out 9 parallel Firestore queries via Promise.all.
//    4. Merge by customerId; dedupe; rank by field-priority.
//    5. Optional RBAC post-filter against scopedCustomerIds.
//    6. 60s in-memory cache keyed on normalized query.
//
//  Performance contract: p95 < 300ms on ~2k customers, ~3k vehicles.
//  Indexes: see firestore.indexes.json deltas in SP3 Task 15.
// ═══════════════════════════════════════════════════════════════════

import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import type { Customer, Vehicle } from '@/lib/customerEntity';

export interface SearchResult {
  customer: Customer;
  matchedVehicles: Vehicle[];
  matchedField:
    | 'phone' | 'phoneSuffix4' | 'plate' | 'zip'
    | 'name' | 'company' | 'city' | 'vehicle' | 'tire';
}

export interface SearchOptions {
  scopedCustomerIds?: Set<string>;
  limitPerField?: number;
}

const FIELD_PRIORITY: SearchResult['matchedField'][] = [
  'phone', 'phoneSuffix4', 'plate', 'zip',
  'name', 'company', 'city', 'vehicle', 'tire',
];

const CACHE = new Map<string, { at: number; results: SearchResult[] }>();
const CACHE_TTL_MS = 60_000;

const HIGH_SENTINEL = '';
const DIGIT_SENTINEL = ':';

export interface SearchOps {
  queryByNamePrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown>>>;
  queryByCompanyPrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown>>>;
  queryByPhoneExact(bid: string, phoneKey: string): Promise<Array<Record<string, unknown>>>;
  queryByPhoneSuffix4(bid: string, suffix: string): Promise<Array<Record<string, unknown>>>;
  queryByCityPrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown>>>;
  queryByZipExact(bid: string, zip: string): Promise<Array<Record<string, unknown>>>;
  queryByMakeModelPrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
  queryByLicensePlate(bid: string, plate: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
  queryByTireSize(bid: string, size: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
  queryByTireSizeLegacy(bid: string, size: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
}

export async function searchCustomers(
  businessId: string,
  rawQuery: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  return _search(_realOps, businessId, rawQuery, opts);
}

async function _search(
  ops: SearchOps,
  businessId: string,
  rawQuery: string,
  opts: SearchOptions,
): Promise<SearchResult[]> {
  const q = rawQuery.trim().toLowerCase();
  const qDigits = rawQuery.replace(/\D/g, '');
  if (q.length < 2 && qDigits.length < 2) return [];

  const cacheKey = `${businessId}:${q}|${qDigits}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    // RBAC filter is applied AFTER cache hit — the cache stores
    // pre-filter results so the same cache entry can serve both
    // owner-scope (no filter) and tech-scope (filtered) callers.
    if (opts.scopedCustomerIds) {
      const scope = opts.scopedCustomerIds;
      return cached.results.filter(r => scope.has(r.customer.id));
    }
    return cached.results;
  }

  const qHigh = q + HIGH_SENTINEL;

  // Each branch is wrapped in .catch(()=>[]) so a missing-index or
  // rule-denial on one branch (e.g. vehicles collection-group when
  // the top-level rule is absent) degrades gracefully rather than
  // failing the entire search.
  const safe = <T>(p: Promise<T[]>): Promise<T[]> => p.catch((err) => {
    console.warn('[searchCustomers] branch failed', err);
    return [];
  });
  const [
    nameHits, companyHits, phoneHits, suffix4Hits,
    cityHits, zipHits, vehHits, plateHits, tireHits, tireLegacyHits,
  ] = await Promise.all([
    q.length >= 2 ? safe(ops.queryByNamePrefix(businessId, q, qHigh))        : Promise.resolve([]),
    q.length >= 2 ? safe(ops.queryByCompanyPrefix(businessId, q, qHigh))     : Promise.resolve([]),
    qDigits.length >= 7 ? safe(ops.queryByPhoneExact(businessId, qDigits.length === 10 ? '1' + qDigits : qDigits)) : Promise.resolve([]),
    qDigits.length === 4 ? safe(ops.queryByPhoneSuffix4(businessId, qDigits)) : Promise.resolve([]),
    q.length >= 2 ? safe(ops.queryByCityPrefix(businessId, q, qHigh))        : Promise.resolve([]),
    qDigits.length === 5 ? safe(ops.queryByZipExact(businessId, qDigits))    : Promise.resolve([]),
    q.length >= 2 ? safe(ops.queryByMakeModelPrefix(businessId, q, qHigh))   : Promise.resolve([]),
    rawQuery.length >= 2 ? safe(ops.queryByLicensePlate(businessId, rawQuery.toUpperCase())) : Promise.resolve([]),
    rawQuery.length >= 2 ? safe(ops.queryByTireSize(businessId, rawQuery))   : Promise.resolve([]),
    rawQuery.length >= 2 ? safe(ops.queryByTireSizeLegacy(businessId, rawQuery)) : Promise.resolve([]),
  ]);

  const byId = new Map<string, SearchResult>();
  const tag = (rows: Array<Record<string, unknown>>, field: SearchResult['matchedField']) => {
    for (const row of rows) {
      const c = row as unknown as Customer;
      const existing = byId.get(c.id);
      if (!existing || FIELD_PRIORITY.indexOf(field) < FIELD_PRIORITY.indexOf(existing.matchedField)) {
        byId.set(c.id, { customer: c, matchedVehicles: [], matchedField: field });
      }
    }
  };
  tag(phoneHits,   'phone');
  tag(suffix4Hits, 'phoneSuffix4');
  tag(plateHits as unknown as Array<Record<string, unknown>>, 'plate');
  tag(zipHits,     'zip');
  tag(nameHits,    'name');
  tag(companyHits, 'company');
  tag(cityHits,    'city');

  const attachVeh = (rows: Array<Record<string, unknown> & { customerId: string }>, field: SearchResult['matchedField']) => {
    for (const v of rows) {
      const existing = byId.get(v.customerId);
      if (existing) {
        existing.matchedVehicles.push(v as unknown as Vehicle);
      } else {
        byId.set(v.customerId, {
          customer: { id: v.customerId, name: '' } as Customer,
          matchedVehicles: [v as unknown as Vehicle],
          matchedField: field,
        });
      }
    }
  };
  attachVeh(vehHits,        'vehicle');
  attachVeh(plateHits,      'plate');
  attachVeh(tireHits,       'tire');
  attachVeh(tireLegacyHits, 'tire');

  let results = Array.from(byId.values()).sort((a, b) => {
    const pa = FIELD_PRIORITY.indexOf(a.matchedField);
    const pb = FIELD_PRIORITY.indexOf(b.matchedField);
    if (pa !== pb) return pa - pb;
    return (a.customer.name || '').localeCompare(b.customer.name || '');
  });

  // Cache PRE-filter results so different callers can apply different RBAC scopes.
  CACHE.set(cacheKey, { at: Date.now(), results });

  if (opts.scopedCustomerIds) {
    const scope = opts.scopedCustomerIds;
    results = results.filter(r => scope.has(r.customer.id));
  }
  return results;
}

/** Invalidate cache. Call from onSnapshot listeners on writes. */
export function invalidateSearchCache(): void { CACHE.clear(); }

const _realOps: SearchOps = {
  queryByNamePrefix: async (bid, lo, hi) => {
    const snap = await getDocs(query(
      collection(requireDb(), 'businesses', bid, 'customers'),
      where('nameLower', '>=', lo), where('nameLower', '<', hi),
      orderBy('nameLower'), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  queryByCompanyPrefix: async (bid, lo, hi) => {
    const snap = await getDocs(query(
      collection(requireDb(), 'businesses', bid, 'customers'),
      where('companyLower', '>=', lo), where('companyLower', '<', hi),
      orderBy('companyLower'), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  queryByPhoneExact: async (bid, phoneKey) => {
    const snap = await getDocs(query(
      collection(requireDb(), 'businesses', bid, 'customers'),
      where('phoneKey', '==', phoneKey), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  queryByPhoneSuffix4: async (bid, suffix) => {
    const lo = suffix;
    const hi = suffix + DIGIT_SENTINEL;
    const snap = await getDocs(query(
      collection(requireDb(), 'businesses', bid, 'customers'),
      where('phoneKey', '>=', lo), where('phoneKey', '<', hi),
      orderBy('phoneKey'), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  queryByCityPrefix: async (bid, lo, hi) => {
    const snap = await getDocs(query(
      collection(requireDb(), 'businesses', bid, 'customers'),
      where('cityLower', '>=', lo), where('cityLower', '<', hi),
      orderBy('cityLower'), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  queryByZipExact: async (bid, zip) => {
    const snap = await getDocs(query(
      collection(requireDb(), 'businesses', bid, 'customers'),
      where('zipCode', '==', zip), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  // Collection-group vehicle queries MUST constrain businessId — the
  // `vehicles` subcollection spans all tenants, and the firestore.rules
  // read rule now requires resource.data.businessId membership. Without
  // the filter these would read (and leak) other tenants' vehicles.
  // See 2026-06-05 security audit (cross-tenant vehicle leak).
  queryByMakeModelPrefix: async (bid, lo, hi) => {
    const snap = await getDocs(query(
      collectionGroup(requireDb(), 'vehicles'),
      where('businessId', '==', bid),
      where('makeModelLower', '>=', lo), where('makeModelLower', '<', hi),
      orderBy('makeModelLower'), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
  },
  queryByLicensePlate: async (bid, plate) => {
    const snap = await getDocs(query(
      collectionGroup(requireDb(), 'vehicles'),
      where('businessId', '==', bid),
      where('licensePlate', '==', plate), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
  },
  queryByTireSize: async (bid, size) => {
    const snap = await getDocs(query(
      collectionGroup(requireDb(), 'vehicles'),
      where('businessId', '==', bid),
      where('tire.size', '==', size), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
  },
  queryByTireSizeLegacy: async (bid, size) => {
    const snap = await getDocs(query(
      collectionGroup(requireDb(), 'vehicles'),
      where('businessId', '==', bid),
      where('tireSize', '==', size), limit(20),
    ));
    return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
  },
};

export const __testHooks = {
  runWithShim: (ops: SearchOps, bid: string, raw: string, opts: SearchOptions = {}) =>
    _search(ops, bid, raw, opts),
  _highSentinel: HIGH_SENTINEL,
};
