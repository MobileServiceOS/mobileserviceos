// functions/src/backfillCustomers.ts
// ═══════════════════════════════════════════════════════════════════
//  backfillCustomers — owner-only HTTPS callable (SP3 task 13).
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Backfill Existing Jobs (Phase 3)"
//
//  Algorithm:
//    1. Assert owner role on req.auth.uid for businessId.
//    2. Read all businesses/{bid}/jobs ordered by date ASC.
//    3. Group jobs by phoneKey (or n_<slug> fallback when phone invalid).
//    4. Resolve conflicts (most-recent-job-wins for identity fields;
//       tags/note preserved as-is).
//    5. Aggregate rollups (jobCount, lifetimeRevenue, averageTicket,
//       vipTier, customerStatus, firstJobAt, lastJobAt).
//    6. Stamp customerId + metadata.backfillRun on each Job.
//    7. Write audit doc to businesses/{bid}/maintenance/backfillCustomers.
//
//  Idempotent — safe to re-run.
//  Dry-run mode short-circuits writes; returns counts only.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { deriveVipTier, deriveCustomerStatus } from './lib/customerInsights';
import { normalizePhone } from './lib/phone';
// Suppress unused-import warnings for the namespace ref used in test
// harness type inference + emulator runtime side-effects.
void admin;
void FieldValue;

export interface BackfillResult {
  customerCount: number;
  vehicleCount: number;
  jobsUpdated: number;
  mergesPerformed: number;
  legacyKeysRenamed: number;
  durationMs: number;
  auditDocPath: string;
  dryRun: boolean;
}

type RawJob = Record<string, unknown> & {
  id: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  date?: string;
  revenue?: number | string;
  city?: string;
  state?: string;
  addressLine?: string;
  zipCode?: string;
  vehicleMakeModel?: string;
  vehicleType?: string;
  tireSize?: string;
  customerId?: string;
  vehicleId?: string;
  phoneKey?: string;
};

type ConflictField = 'name' | 'email' | 'addressLine' | 'city' | 'state' | 'zipCode' | 'companyName';

function _resolveConflict(args: {
  field: ConflictField | 'tags' | 'note';
  candidates: Array<{ value: unknown; date: string }>;
  preExisting?: unknown;
}): unknown {
  if (args.field === 'tags' || args.field === 'note') {
    if (args.preExisting !== undefined) return args.preExisting;
    return args.candidates[args.candidates.length - 1]?.value;
  }
  const sorted = [...args.candidates].sort((a, b) => {
    const ax = Date.parse(a.date || '0');
    const bx = Date.parse(b.date || '0');
    return bx - ax;
  });
  for (const c of sorted) {
    if (c.value !== undefined && c.value !== null && String(c.value) !== '') return c.value;
  }
  return undefined;
}

/** Walker — used by both the live callable and the test harness. */
async function _runWalker(args: {
  businessId: string;
  jobs: RawJob[];
  dryRun: boolean;
  onWrite: (path: string, patch: Record<string, unknown>) => Promise<void>;
}): Promise<BackfillResult> {
  const t0 = Date.now();
  const { businessId, jobs, dryRun, onWrite } = args;

  // Group jobs by phoneKey (or fallback name slug).
  const groups = new Map<string, RawJob[]>();
  for (const j of jobs) {
    const phone = normalizePhone(String(j.customerPhone ?? ''));
    const key = phone.valid
      ? `p_${phone.digits}`
      : `n_${String(j.customerName ?? 'unknown').toLowerCase().replace(/\s+/g, '_')}`;
    const list = groups.get(key) ?? [];
    list.push(j);
    groups.set(key, list);
  }

  let customerCount = 0;
  let vehicleCount  = 0;
  let jobsUpdated   = 0;
  let mergesPerformed = 0;

  for (const [customerId, group] of groups) {
    customerCount += 1;

    const name = _resolveConflict({
      field: 'name',
      candidates: group.map(j => ({ value: j.customerName, date: j.date ?? '' })),
    }) as string | undefined;
    const email = _resolveConflict({
      field: 'email',
      candidates: group.map(j => ({ value: j.customerEmail, date: j.date ?? '' })),
    }) as string | undefined;
    const city = _resolveConflict({
      field: 'city',
      candidates: group.map(j => ({ value: j.city, date: j.date ?? '' })),
    }) as string | undefined;
    const state = _resolveConflict({
      field: 'state',
      candidates: group.map(j => ({ value: j.state, date: j.date ?? '' })),
    }) as string | undefined;
    const zipCode = _resolveConflict({
      field: 'zipCode',
      candidates: group.map(j => ({ value: j.zipCode, date: j.date ?? '' })),
    }) as string | undefined;
    if (group.length > 1) mergesPerformed += group.length - 1;

    let lifetimeRevenue = 0;
    let firstJobAt = '9999-12-31';
    let lastJobAt = '0000-01-01';
    let lastJobId = '';
    for (const j of group) {
      const rev = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
      if (Number.isFinite(rev)) lifetimeRevenue += rev;
      if (j.date && j.date < firstJobAt) firstJobAt = j.date;
      if (j.date && j.date > lastJobAt)  { lastJobAt  = j.date; lastJobId = j.id; }
    }
    const jobCount = group.length;
    const averageTicket = jobCount > 0 ? Math.round((lifetimeRevenue / jobCount) * 100) / 100 : undefined;
    const vipTier = deriveVipTier(lifetimeRevenue);
    const status  = deriveCustomerStatus({ lastJobAt: lastJobAt === '0000-01-01' ? undefined : lastJobAt });

    const phone = normalizePhone(String(group[0].customerPhone ?? ''));
    const customerPatch: Record<string, unknown> = {
      name: name ?? '(unknown)',
      nameLower: (name ?? '').toLowerCase(),
      kind: 'individual',
      firstJobAt: firstJobAt === '9999-12-31' ? undefined : firstJobAt,
      lastJobAt:  lastJobAt  === '0000-01-01' ? undefined : lastJobAt,
      lastJobId:  lastJobId || undefined,
      jobCount, lifetimeRevenue, averageTicket, vipTier, customerStatus: status,
      updatedAt: Timestamp.now(),
      lastEditedAt: Timestamp.now(),
      lastEditedByUid: 'system:backfill',
    };
    if (phone.valid) {
      customerPatch.phoneE164 = phone.e164;
      customerPatch.phoneKey  = phone.digits;
    }
    if (email)   customerPatch.email = email;
    if (city)    { customerPatch.city = city; customerPatch.cityLower = city.toLowerCase(); }
    if (state)   customerPatch.state = state;
    if (zipCode) customerPatch.zipCode = zipCode;

    if (!dryRun) {
      await onWrite(`businesses/${businessId}/customers/${customerId}`, customerPatch);
    }

    // Per-job stamp: customerId + metadata.backfillRun.
    for (const j of group) {
      if (!j.customerId) jobsUpdated += 1;
      if (!dryRun) {
        const jobPatch: Record<string, unknown> = {
          customerId,
          metadata: { backfillRun: t0 },
        };
        if (phone.valid) jobPatch.phoneKey = phone.digits;
        await onWrite(`businesses/${businessId}/jobs/${j.id}`, jobPatch);
      }
    }

    // Vehicle subdoc — only one per group for v1; richer per-vehicle
    // aggregation lands in SP3.1 if rural data audit surfaces a need.
    const firstVehicleSpec = group.find(j => j.vehicleMakeModel || j.tireSize);
    if (firstVehicleSpec) {
      vehicleCount += 1;
      const vid = `vehicle-${customerId}`;
      if (!dryRun) {
        const vehiclePatch: Record<string, unknown> = {
          vehicleMakeModel: firstVehicleSpec.vehicleMakeModel,
          vehicleType: firstVehicleSpec.vehicleType,
          tireSize: firstVehicleSpec.tireSize,
          lastServicedAt: lastJobAt === '0000-01-01' ? undefined : lastJobAt,
          lastServiceDate: lastJobAt === '0000-01-01' ? undefined : lastJobAt,
          lastJobId: lastJobId || undefined,
          serviceCount: jobCount,
          updatedAt: Timestamp.now(),
        };
        if (firstVehicleSpec.vehicleMakeModel) {
          vehiclePatch.makeModelLower = String(firstVehicleSpec.vehicleMakeModel).toLowerCase();
        }
        await onWrite(`businesses/${businessId}/customers/${customerId}/vehicles/${vid}`, vehiclePatch);
      }
    }
  }

  return {
    customerCount,
    vehicleCount,
    jobsUpdated,
    mergesPerformed,
    legacyKeysRenamed: 0,
    durationMs: Date.now() - t0,
    auditDocPath: `businesses/${businessId}/maintenance/backfillCustomers`,
    dryRun,
  };
}

export const backfillCustomers = onCall<
  { businessId: string; dryRun: boolean },
  Promise<BackfillResult>
>(async (req) => {
  const uid = req.auth?.uid;
  const { businessId, dryRun } = req.data ?? { businessId: '', dryRun: true };
  if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
  if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');

  const db = admin.firestore();
  const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  const role = memberSnap.data()?.role;
  if (role !== 'owner') throw new HttpsError('permission-denied', 'owner only');

  const jobsSnap = await db.collection(`businesses/${businessId}/jobs`).orderBy('date', 'asc').get();
  const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawJob));

  const result = await _runWalker({
    businessId, jobs, dryRun,
    onWrite: async (path, patch) => {
      // Strip undefined keys before writing — Firestore admin SDK rejects
      // them unless `ignoreUndefinedProperties: true` is set globally on
      // the SDK init. Setting it globally would affect every other function
      // in this codebase; safer to strip locally here. The undefined values
      // come from the conditional `firstJobAt === '9999-12-31' ? undefined`
      // and from `firstVehicleSpec.vehicleMakeModel` when only `tireSize`
      // was populated on the source job (or any other partial-field combo).
      // Discovered in production on 2026-06-05 when the operator's first
      // backfill attempt threw INTERNAL on a job with tireSize but no
      // vehicleMakeModel.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db.doc(path).set(cleaned, { merge: true });
    },
  });

  if (!dryRun) {
    await db.doc(`businesses/${businessId}/maintenance/backfillCustomers`).set({
      ...result,
      startedAt: Timestamp.now(),
      completedAt: Timestamp.now(),
      invokedByUid: uid,
    }, { merge: true });
  }

  return result;
});

// Test harness exports
export const __testHooks = {
  resolveConflict: _resolveConflict,
  runWalkerWithShim: (args: {
    businessId: string;
    jobs: RawJob[];
    dryRun: boolean;
    onWrite: (path: string) => void;
  }) => _runWalker({
    businessId: args.businessId,
    jobs: args.jobs,
    dryRun: args.dryRun,
    onWrite: async (path: string) => { args.onWrite(path); },
  }),
};
