// functions/src/onJobWriteCustomerRollup.ts
// ═══════════════════════════════════════════════════════════════════
//  onJobWriteCustomerRollup — Firestore trigger (SP3 task 14).
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Rollup persistence", §"Trigger spec",
//        §"Critical privacy contract" (line 2162) — lifetimeRevenue MUST
//         NEVER be persisted on the Customer doc.
//
//  Fires on every write to businesses/{bid}/jobs/{jobId}. Loads all
//  jobs for the customerId (admin SDK bypasses scoping), computes
//  in-memory rollups, writes ONLY { jobCount, averageTicket, vipTier,
//  customerStatus, lastJobAt, lastJobId } back. The remaining insights
//  metrics are computed live on CustomerProfile from the same 100-job
//  window.
//
//  Runs synchronously (awaited) — Cloud Functions v2 freezes the
//  instance after return, so deferred work is unreliable. Refreshes
//  both the new and prior customer on delete / reassignment.
//  Short-circuits when job.metadata.backfillRun is present (backfill
//  writes rollups itself).
// ═══════════════════════════════════════════════════════════════════

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { deriveVipTier, deriveCustomerStatus } from './lib/customerInsights';
void admin;

type JobLite = {
  id: string;
  revenue?: number | string;
  date?: string;
  customerId?: string;
  metadata?: { backfillRun?: string | number };
};

interface RollupPatch {
  jobCount: number;
  averageTicket: number;
  vipTier: 'Standard' | 'Gold' | 'Platinum';
  customerStatus: 'Active' | 'Inactive';
  lastJobAt: string;
  lastJobId: string;
}

function _shouldSkip(job: JobLite | undefined): boolean {
  if (!job) return true;
  return !!job.metadata?.backfillRun;
}

function _computeRollup(jobs: JobLite[]): RollupPatch {
  let revenue = 0;
  let lastJobAt = '0000-01-01';
  let lastJobId = '';
  for (const j of jobs) {
    const r = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
    if (Number.isFinite(r)) revenue += r;
    if (j.date && j.date > lastJobAt) { lastJobAt = j.date; lastJobId = j.id; }
  }
  const jobCount = jobs.length;
  const averageTicket = jobCount > 0 ? Math.round((revenue / jobCount) * 100) / 100 : 0;
  // PRIVACY: revenue is local-only. Derive vipTier from it, then DROP it.
  return {
    jobCount,
    averageTicket,
    vipTier: deriveVipTier(revenue),
    customerStatus: deriveCustomerStatus({ lastJobAt: lastJobAt === '0000-01-01' ? undefined : lastJobAt }),
    lastJobAt: lastJobAt === '0000-01-01' ? '' : lastJobAt,
    lastJobId,
  };
}

async function _runRollup(businessId: string, customerId: string): Promise<void> {
  const db = admin.firestore();
  const snap = await db.collection(`businesses/${businessId}/jobs`)
    .where('customerId', '==', customerId)
    .get();
  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() } as JobLite));
  const patch = _computeRollup(jobs);
  await db.doc(`businesses/${businessId}/customers/${customerId}`)
    .set({ ...patch, updatedAt: Timestamp.now() }, { merge: true });
}

export const onJobWriteCustomerRollup = onDocumentWritten(
  'businesses/{businessId}/jobs/{jobId}',
  async (event) => {
    const after = event.data?.after?.data() as JobLite | undefined;
    const before = event.data?.before?.data() as JobLite | undefined;

    // Skip only backfill-originated writes — backfill writes rollups
    // itself. A delete has no `after`, so it is never a backfill write
    // and must still refresh the (now smaller) rollup.
    if (after && _shouldSkip(after)) return;

    const businessId = event.params.businessId;

    // Refresh every customer whose job set changed: the current owner
    // (create/update) and, on delete or a customer reassignment, the
    // prior owner too.
    const customerIds = new Set<string>();
    if (after?.customerId) customerIds.add(after.customerId);
    if (before?.customerId) customerIds.add(before.customerId);
    if (customerIds.size === 0) return;

    // Run synchronously and AWAIT. Cloud Functions v2 freezes the
    // instance CPU after the handler returns, so the previous post-return
    // setTimeout coalescer frequently never fired and rollups
    // (jobCount / averageTicket / vipTier / lastJobAt) silently went
    // stale — including never shrinking on delete (2026-06-05 audit).
    await Promise.all(
      Array.from(customerIds).map((customerId) =>
        _runRollup(businessId, customerId).catch((err) => {
          console.error('[onJobWriteCustomerRollup] failed', { businessId, customerId, err });
        }),
      ),
    );
  },
);

export const __testHooks = {
  computeRollup: _computeRollup,
  shouldSkip: _shouldSkip,
};
