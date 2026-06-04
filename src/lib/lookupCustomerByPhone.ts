// src/lib/lookupCustomerByPhone.ts
// ═══════════════════════════════════════════════════════════════════
//  Phone → Customer + vehicles + lastJob lookup.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"AddJob Workflow Change → Returning Customer card spec"
//        §"`lookupCustomerByPhone` is at the customer layer"
//        §"Hybrid read path also tries the legacy form (transitional)"
//
//  Used by:
//    - CustomerLookupCard (SP2 AddJob step 2)
//    - IncomingCallModal hydration fallback (SP6)
//
//  Performance target: <300ms p95 against a directory with up to
//  ~50k customers. Achieved by:
//    1. Direct doc-ID get for the canonical 11-digit id.
//    2. Direct doc-ID get for the legacy 10-digit id (transitional).
//    3. Scoped where('phoneKey','==',digits) limit(1) only if both
//       doc-id paths miss — covers SP3-backfilled docs whose id
//       was assigned by the backfill (not canonical) but whose
//       phoneKey is correct.
//  Logs a warn when total elapsed exceeds 500ms so a slow tenant
//  surfaces in production console output without needing a separate
//  telemetry pipeline.
// ═══════════════════════════════════════════════════════════════════

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { normalizePhone } from '@/lib/phone';
import type { Customer, Vehicle } from '@/lib/customerEntity';

/** Compact summary of the most recent job for a customer.
 *  We pick a subset rather than returning the full Job to keep the
 *  card's render contract narrow — CustomerLookupCard only reads
 *  these fields. */
export interface LookupLastJob {
  id: string;
  date?: string;
  service?: string;
  revenue?: number | string;
  vehicleMakeModel?: string;
  vehicleType?: string;
  tireSize?: string;
  city?: string;
  paymentStatus?: string;
}

export interface LookupResult {
  customer: Customer;
  vehicles: Vehicle[];
  lastJob: LookupLastJob | null;
  lookupLatencyMs: number;
}

/** Soft-perf budget — warn when exceeded. NOT a hard timeout —
 *  the network can return after this point and the result is still
 *  used. SP3 telemetry will record an `outcome: 'slow'` in this case. */
const SLOW_LOOKUP_WARN_MS = 500;

/** Public entry point. */
export async function lookupCustomerByPhone(
  businessId: string,
  rawPhone: string,
): Promise<LookupResult | null> {
  return _lookup(_realOps, businessId, rawPhone);
}

// ─── Pure-function core ──────────────────────────────────────────
// The shape of every Firestore call the helper needs is bundled into
// a LookupOps interface so the in-memory test shim can substitute it.

export interface LookupOps {
  getDocByPath(path: string): Promise<Record<string, unknown> | undefined>;
  queryByPhoneKey(businessId: string, phoneKey: string): Promise<Array<Record<string, unknown>>>;
  listVehicles(businessId: string, customerId: string): Promise<Array<Record<string, unknown>>>;
  queryLastJob(businessId: string, customerId: string): Promise<Record<string, unknown> | undefined>;
}

async function _lookup(
  ops: LookupOps,
  businessId: string,
  rawPhone: string,
): Promise<LookupResult | null> {
  const t0 = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  const phone = normalizePhone(String(rawPhone ?? ''));
  if (!phone.valid) {
    return null;
  }
  const digits11 = phone.digits;             // '13058977030'
  const digits10 = digits11.slice(1);        // '3058977030' — legacy id form

  // Per-step error catch so a denied legacy path or missing index
  // doesn't take down the whole lookup. If step 1 succeeds we never
  // touch step 2/3, so the warm path is unaffected.
  const safe = async <T>(p: Promise<T>): Promise<T | undefined> => {
    try { return await p; } catch (err) {
      console.warn('[lookupCustomerByPhone] step failed', err);
      return undefined;
    }
  };

  // (1) canonical doc-id hit
  let custDoc = await safe(ops.getDocByPath(`businesses/${businessId}/customers/p_${digits11}`));
  // (2) legacy doc-id fallback
  if (!custDoc) {
    custDoc = await safe(ops.getDocByPath(`businesses/${businessId}/customers/p_${digits10}`));
  }
  // (3) phoneKey-where fallback
  if (!custDoc) {
    const rows = await safe(ops.queryByPhoneKey(businessId, digits11)) ?? [];
    if (rows.length > 0) custDoc = rows[0];
  }
  if (!custDoc) {
    const elapsed = _elapsed(t0);
    if (elapsed > SLOW_LOOKUP_WARN_MS) {
      // eslint-disable-next-line no-console
      console.warn('[lookupCustomerByPhone] slow no-match', { businessId, elapsed });
    }
    return null;
  }

  const customer = custDoc as unknown as Customer;
  // The customer.id field may be absent from the doc data — getDoc
  // returns only the field map, not the doc-id. Reconstruct from the
  // phone path so downstream consumers always have a stable id.
  if (!customer.id) customer.id = `p_${digits11}`;
  const vRows = await safe(ops.listVehicles(businessId, customer.id)) ?? [];
  const vehicles = vRows as unknown as Vehicle[];

  const jRow = await safe(ops.queryLastJob(businessId, customer.id));
  const lastJob: LookupLastJob | null = jRow
    ? {
        id: String(jRow.id ?? ''),
        date: jRow.date ? String(jRow.date) : undefined,
        service: jRow.service ? String(jRow.service) : undefined,
        revenue: (jRow.revenue as number | string | undefined),
        vehicleMakeModel: jRow.vehicleMakeModel ? String(jRow.vehicleMakeModel) : undefined,
        vehicleType: jRow.vehicleType ? String(jRow.vehicleType) : undefined,
        tireSize: jRow.tireSize ? String(jRow.tireSize) : undefined,
        city: jRow.city ? String(jRow.city) : undefined,
        paymentStatus: jRow.paymentStatus ? String(jRow.paymentStatus) : undefined,
      }
    : null;

  const elapsed = _elapsed(t0);
  if (elapsed > SLOW_LOOKUP_WARN_MS) {
    // eslint-disable-next-line no-console
    console.warn('[lookupCustomerByPhone] slow hit', { businessId, customerId: customer.id, elapsed });
  }

  return { customer, vehicles, lastJob, lookupLatencyMs: elapsed };
}

function _elapsed(t0: number): number {
  const now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  return Math.max(0, now - t0);
}

// ─── Real Firestore implementation of LookupOps ───────────────────

const _realOps: LookupOps = {
  async getDocByPath(path: string): Promise<Record<string, unknown> | undefined> {
    const segs = path.split('/').filter(Boolean);
    const [first, ...rest] = segs;
    const ref = doc(_db as Firestore, first, ...rest);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  },
  async queryByPhoneKey(businessId, phoneKey) {
    const col = collection(_db as Firestore, `businesses/${businessId}/customers`);
    const q = query(col, where('phoneKey', '==', phoneKey), orderBy('lastJobAt', 'desc'), limit(1));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Record<string, unknown>);
  },
  async listVehicles(businessId, customerId) {
    const col = collection(_db as Firestore, `businesses/${businessId}/customers/${customerId}/vehicles`);
    const q = query(col, orderBy('lastServicedAt', 'desc'), limit(3));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Record<string, unknown>);
  },
  async queryLastJob(businessId, customerId) {
    const col = collection(_db as Firestore, `businesses/${businessId}/jobs`);
    const q = query(col, where('customerId', '==', customerId), orderBy('date', 'desc'), limit(1));
    const snap = await getDocs(q);
    const d = snap.docs[0];
    return d ? (d.data() as Record<string, unknown>) : undefined;
  },
};

/** Test-only hooks — used by tests/lookupCustomerByPhone.test.ts.
 *  NOT exported from the package's public surface. */
export const __testHooks = {
  runWithShim: _lookup,
};
