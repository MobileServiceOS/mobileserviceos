// src/lib/customerEntity.ts
// ═══════════════════════════════════════════════════════════════════
//  Customer + Vehicle entities.
//
//  Customer doc path: businesses/{bid}/customers/{customerId}
//  Vehicle  doc path: businesses/{bid}/customers/{customerId}/vehicles/{vehicleId}
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Data Model" (Customer table, Vehicle table)
//
//  This file lands TYPES only in SP1 Task 2. The transactional
//  upsertCustomerFromJob helper is added in Task 4.
//
//  All rollup fields are OPTIONAL — legacy docs and the first-create
//  case both lack them, and read sites MUST nullish-coalesce.
// ═══════════════════════════════════════════════════════════════════

/** Top-level Customer doc. */
export interface Customer {
  /** Doc ID: `p_<11-digit phoneKey>` or `n_<slug>`. */
  id: string;
  /** Display name. Migrated from Job.customerName on first upsert. */
  name: string;
  /** Lowercased name for global-search prefix queries (v2). */
  nameLower?: string;

  /** Reserved for future fleet workflow features. Default 'individual'. */
  kind?: 'individual' | 'fleet';
  /** Business / fleet name. Informational when kind==='individual'. */
  companyName?: string;
  companyLower?: string;

  /** E.164 form (e.g. '+13058977030'). Only written when phone is valid. */
  phoneE164?: string;
  /** Digits-only form (e.g. '13058977030'). Indexed. Primary lookup field. */
  phoneKey?: string;

  email?: string;
  addressLine?: string;
  city?: string;
  cityLower?: string;
  state?: string;
  zipCode?: string;

  /** EXISTING free-text operator note (preserved from CustomerMeta). */
  note?: string;
  /** EXISTING tag list (preserved from CustomerMeta). */
  tags?: string[];

  // ─── v3.2 Quick Notes (refinement #2) — schema-only in SP1 ──────
  gateCode?: string;
  apartmentNumber?: string;
  wheelLockKeyLocation?: string;
  tpmsNotes?: string;
  preferredPaymentMethod?: string;
  parkingInstructions?: string;
  preferredContactMethod?: 'phone' | 'sms' | 'email';
  generalNotes?: string;

  // ─── Lifecycle timestamps ───────────────────────────────────────
  firstJobAt?: string;   // ISO from client; Timestamp from server
  lastJobAt?: string;
  lastJobId?: string;

  // ─── Rollups ────────────────────────────────────────────────────
  jobCount?: number;
  lifetimeRevenue?: number;
  averageTicket?: number;
  vipTier?: 'Standard' | 'Gold' | 'Platinum';
  customerStatus?: 'Active' | 'Inactive' | 'Fleet' | 'VIP' | 'Archived';
  /** Written by SP3 referral surface — schema-only here. */
  referralCount?: number;
  /** Written by SP3 photo gallery — schema-only here. */
  photoCount?: number;

  // ─── Audit ──────────────────────────────────────────────────────
  createdByUid?: string;
  createdAt?: string;     // ISO from client
  updatedAt?: string;
  lastEditedByUid?: string;
  lastEditedAt?: string;
  /** Set by SP3 Call/Text buttons. Allowlisted in identity-upsert rule
   *  (firestore.rules Task 7) so SP3 writes don't require schema churn. */
  lastContactedAt?: string;

  // ─── Idempotency ────────────────────────────────────────────────
  /** Bounded list of jobIds already absorbed by upsertCustomerFromJob.
   *  FIFO eviction at ~500 entries (see customerEntity.ts Task 4). */
  processedJobIds?: string[];

  // ─── Soft-delete (SP3 surface) ──────────────────────────────────
  deletedAt?: string;
}

/** Vehicle subdoc under a Customer. */
export interface Vehicle {
  id: string;
  /** Denormalized tenant id — gates the collection-group read rule and
   *  scopes the searchCustomers collection-group queries. */
  businessId?: string;
  // Universal core
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  color?: string;
  vin?: string;
  licensePlate?: string;
  /** Lowercased "make model" for global-search prefix queries. */
  makeModelLower?: string;

  // Legacy compatibility
  vehicleMakeModel?: string;
  vehicleType?: string;
  vehicleSize?: string;

  // Tire-vertical top-level fields (v3 — were under .tire in v2)
  tireSize?: string;
  alternateTireSize?: string;
  tireBrand?: string;
  tireCondition?: string;
  tpmsNotes?: string;
  wheelLockNotes?: string;
  serviceNotes?: string;

  // Rollups
  lastServicedAt?: string;
  lastServiceDate?: string;
  lastJobId?: string;
  serviceCount?: number;

  createdAt?: string;
  updatedAt?: string;
  processedJobIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════
//  upsertCustomerFromJob — SP1 transactional upsert
//
//  Spec: §"Concurrency contract — upsertCustomerFromJob"
//
//  - Runs as a Firestore transaction (read-then-write).
//  - FieldValue.increment(1) on jobCount, gated by processedJobIds
//    idempotency.
//  - firstJobAt set-if-absent, never overwritten.
//  - lastJobAt = max(existing, job.date).
//  - processedJobIds FIFO eviction at MAX_PROCESSED_JOB_IDS entries.
//  - Vehicle subdoc mirrors the same idempotency contract.
//
//  NEVER use fbSetFast from this module — fbSetFast JSON-stringifies
//  object values and would corrupt FieldValue sentinels. We use
//  runTransaction + tx.set/tx.update directly with the raw SDK.
// ═══════════════════════════════════════════════════════════════════

import {
  doc,
  runTransaction,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import { normalizePhone } from '@/lib/phone';
import { deriveVipTier, deriveCustomerStatus } from '@/lib/customerInsights';

/** Cap on processedJobIds array size before FIFO eviction. */
const MAX_PROCESSED_JOB_IDS = 500;

function _slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Customer doc ID: 'p_<11-digit>' for phone-primary, else 'n_<slug>'.
 *  Returns '' when the job has neither a valid phone nor any name. */
export function customerIdForJob(job: { customerPhone?: string; customerName?: string }): string {
  const p = normalizePhone(String(job.customerPhone ?? ''));
  if (p.valid) return 'p_' + p.digits;
  const slug = _slug(String(job.customerName ?? ''));
  return slug ? 'n_' + slug : '';
}

/** Vehicle doc ID prefers universal year-make-model-trim; falls back
 *  to legacy makeModel; final fallback for stub jobs. */
export function vehicleIdForJob(job: {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vehicleMakeModel?: string;
  vehicleType?: string;
  tireSize?: string;
}): string {
  if (job.make && job.model) {
    const parts = [String(job.year ?? ''), job.make, job.model, job.trim ?? 'base'].filter(Boolean);
    return _slug(parts.join('-'));
  }
  if (job.vehicleMakeModel) return _slug(String(job.vehicleMakeModel));
  if (job.vehicleType) return _slug(job.vehicleType + '-' + (job.tireSize ?? 'na'));
  return 'unknown-' + String(job.id ?? '').slice(0, 6);
}

export interface UpsertResult {
  customerId: string;
  vehicleId: string;
}

/** Pure-function core: takes the current customer doc + the job and
 *  produces the patch to apply. Extracted so the in-memory test shim
 *  can call it directly without booting Firestore. */
function _buildCustomerPatch(
  existing: Record<string, unknown> | undefined,
  job: {
    id: string;
    date?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    companyName?: string;
    city?: string;
    state?: string;
    addressLine?: string;
    zipCode?: string;
    revenue?: number | string;
  },
  nowIso: string,
  actorUid: string,
): { patch: Record<string, unknown>; skipRollup: boolean } {
  const phone = normalizePhone(String(job.customerPhone ?? ''));
  const processed = (existing?.processedJobIds as string[] | undefined) ?? [];
  const skipRollup = processed.includes(job.id);

  const rev = Number(job.revenue ?? 0) || 0;
  const newJobCount = skipRollup ? Number(existing?.jobCount ?? 0) : Number(existing?.jobCount ?? 0) + 1;
  const newRevenue = skipRollup ? Number(existing?.lifetimeRevenue ?? 0) : Number(existing?.lifetimeRevenue ?? 0) + rev;
  const newLastJobAt = skipRollup
    ? (existing?.lastJobAt as string | undefined)
    : (() => {
        const a = (existing?.lastJobAt as string | undefined) ?? '';
        const b = job.date ?? '';
        return a > b ? a : b;
      })();
  const newAvg = newJobCount > 0 ? newRevenue / newJobCount : 0;

  // FIFO-evicted processedJobIds. We compute the trimmed list here
  // instead of arrayUnion so the test shim and the prod path agree
  // bit-for-bit on size bound.
  const nextProcessed = skipRollup
    ? processed
    : [...processed, job.id].slice(-MAX_PROCESSED_JOB_IDS);

  const patch: Record<string, unknown> = {
    // Identity (always merge-write per spec §"Concurrency contract" rule 9)
    name: String(job.customerName ?? '').trim() || (existing?.name as string | undefined) || 'Unknown',
    nameLower: (String(job.customerName ?? '').trim() || (existing?.name as string | undefined) || 'Unknown').toLowerCase(),
    kind: (existing?.kind as string | undefined) ?? 'individual',
    // Phone/email/address — set ONLY when valid/present; never write '' over an existing value
    ...(phone.valid ? { phoneE164: phone.e164, phoneKey: phone.digits } : {}),
    ...(job.customerEmail ? { email: String(job.customerEmail) } : {}),
    ...(job.companyName ? { companyName: String(job.companyName), companyLower: String(job.companyName).toLowerCase() } : {}),
    ...(job.city ? { city: String(job.city), cityLower: String(job.city).toLowerCase() } : {}),
    ...(job.state ? { state: String(job.state) } : {}),
    ...(job.addressLine ? { addressLine: String(job.addressLine) } : {}),
    ...(job.zipCode ? { zipCode: String(job.zipCode) } : {}),
    // Lifecycle
    firstJobAt: (existing?.firstJobAt as string | undefined) ?? (job.date ?? nowIso),
    lastJobAt: newLastJobAt,
    lastJobId: skipRollup ? (existing?.lastJobId as string | undefined) : job.id,
    jobCount: newJobCount,
    lifetimeRevenue: newRevenue,
    averageTicket: newAvg,
    vipTier: deriveVipTier(newRevenue),
    customerStatus: deriveCustomerStatus({ lastJobAt: newLastJobAt }),
    // Audit
    createdByUid: (existing?.createdByUid as string | undefined) ?? actorUid,
    createdAt: (existing?.createdAt as string | undefined) ?? nowIso,
    updatedAt: nowIso,
    lastEditedByUid: actorUid,
    lastEditedAt: nowIso,
    processedJobIds: nextProcessed,
  };
  return { patch, skipRollup };
}

function _buildVehiclePatch(
  businessId: string,
  existing: Record<string, unknown> | undefined,
  job: {
    id: string;
    date?: string;
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    color?: string;
    vehicleMakeModel?: string;
    vehicleType?: string;
    vehicleSize?: string;
    tireSize?: string;
    tireBrand?: string;
    tireCondition?: string;
  },
  nowIso: string,
): { patch: Record<string, unknown>; skipRollup: boolean } {
  const processed = (existing?.processedJobIds as string[] | undefined) ?? [];
  const skipRollup = processed.includes(job.id);
  const newServiceCount = skipRollup ? Number(existing?.serviceCount ?? 0) : Number(existing?.serviceCount ?? 0) + 1;
  const newLastServicedAt = skipRollup
    ? (existing?.lastServicedAt as string | undefined)
    : (() => {
        const a = (existing?.lastServicedAt as string | undefined) ?? '';
        const b = job.date ?? '';
        return a > b ? a : b;
      })();
  const nextProcessed = skipRollup
    ? processed
    : [...processed, job.id].slice(-MAX_PROCESSED_JOB_IDS);

  const makeModelLower = (job.make && job.model)
    ? `${job.make} ${job.model}`.toLowerCase()
    : (job.vehicleMakeModel ?? '').toLowerCase() || undefined;

  const patch: Record<string, unknown> = {
    // Denormalized tenant id. Required by the firestore.rules
    // collection-group read rule for `vehicles` and by the
    // searchCustomers collection-group queries (both filter on
    // businessId) so cross-tenant reads are impossible. See the
    // 2026-06-05 security audit (cross-tenant vehicle leak).
    businessId,
    ...(job.year !== undefined ? { year: job.year } : {}),
    ...(job.make ? { make: job.make } : {}),
    ...(job.model ? { model: job.model } : {}),
    ...(job.trim ? { trim: job.trim } : {}),
    ...(job.color ? { color: job.color } : {}),
    ...(makeModelLower ? { makeModelLower } : {}),
    ...(job.vehicleMakeModel ? { vehicleMakeModel: job.vehicleMakeModel } : {}),
    ...(job.vehicleType ? { vehicleType: job.vehicleType } : {}),
    ...(job.vehicleSize ? { vehicleSize: job.vehicleSize } : {}),
    // v3 top-level tire fields
    ...(job.tireSize ? { tireSize: job.tireSize } : {}),
    ...(job.tireBrand ? { tireBrand: job.tireBrand } : {}),
    ...(job.tireCondition ? { tireCondition: job.tireCondition } : {}),
    lastServicedAt: newLastServicedAt,
    lastJobId: skipRollup ? (existing?.lastJobId as string | undefined) : job.id,
    serviceCount: newServiceCount,
    createdAt: (existing?.createdAt as string | undefined) ?? nowIso,
    updatedAt: nowIso,
    processedJobIds: nextProcessed,
  };
  return { patch, skipRollup };
}

/** Transactionally upsert the Customer + Vehicle from a saved Job. */
export async function upsertCustomerFromJob(
  businessId: string,
  job: {
    id: string;
    date?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    companyName?: string;
    city?: string;
    state?: string;
    addressLine?: string;
    zipCode?: string;
    revenue?: number | string;
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    color?: string;
    vehicleMakeModel?: string;
    vehicleType?: string;
    vehicleSize?: string;
    tireSize?: string;
    tireBrand?: string;
    tireCondition?: string;
    createdByUid?: string;
  },
): Promise<UpsertResult> {
  const customerId = customerIdForJob(job);
  if (!customerId) {
    throw new Error('upsertCustomerFromJob: cannot derive customerId (no phone, no name)');
  }
  const vehicleId = vehicleIdForJob(job);
  const nowIso = new Date().toISOString();
  const actorUid = job.createdByUid ?? '';

  const customerRef = doc(requireDb(), `businesses/${businessId}/customers/${customerId}`);
  const vehicleRef = doc(requireDb(), `businesses/${businessId}/customers/${customerId}/vehicles/${vehicleId}`);

  await runTransaction(requireDb(), async (tx) => {
    const [cSnap, vSnap] = await Promise.all([tx.get(customerRef), tx.get(vehicleRef)]);
    const cExisting = cSnap.exists() ? (cSnap.data() as Record<string, unknown>) : undefined;
    const vExisting = vSnap.exists() ? (vSnap.data() as Record<string, unknown>) : undefined;

    const { patch: cPatch } = _buildCustomerPatch(cExisting, job, nowIso, actorUid);
    const { patch: vPatch } = _buildVehiclePatch(businessId, vExisting, job, nowIso);

    tx.set(customerRef, cPatch, { merge: true });
    tx.set(vehicleRef, vPatch, { merge: true });
  });

  return { customerId, vehicleId };
}

/** Test-only hooks — used by tests/customerEntity.test.ts.
 *  NOT exported from the package's public surface. */
export const __testHooks = {
  /** Pure-shim version of the transactional upsert. Writes into the
   *  caller-provided in-memory Map keyed by full doc paths. Returns
   *  the same { customerId, vehicleId } the real helper does. */
  runUpsertWithShim(
    store: Map<string, Record<string, unknown>>,
    businessId: string,
    job: Parameters<typeof upsertCustomerFromJob>[1],
  ): UpsertResult {
    const customerId = customerIdForJob(job);
    if (!customerId) throw new Error('runUpsertWithShim: cannot derive customerId');
    const vehicleId = vehicleIdForJob(job);
    const nowIso = new Date().toISOString();
    const actorUid = job.createdByUid ?? '';
    const cPath = `businesses/${businessId}/customers/${customerId}`;
    const vPath = `businesses/${businessId}/customers/${customerId}/vehicles/${vehicleId}`;
    const cExisting = store.get(cPath);
    const vExisting = store.get(vPath);
    const { patch: cPatch } = _buildCustomerPatch(cExisting, job, nowIso, actorUid);
    const { patch: vPatch } = _buildVehiclePatch(businessId, vExisting, job, nowIso);
    store.set(cPath, { ...(cExisting ?? {}), ...cPatch });
    store.set(vPath, { ...(vExisting ?? {}), ...vPatch });
    return { customerId, vehicleId };
  },
};
