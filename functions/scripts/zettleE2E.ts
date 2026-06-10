// functions/scripts/zettleE2E.ts
// ═══════════════════════════════════════════════════════════════════
//  Zettle Phase 1 END-TO-END test (real Firestore emulator).
//
//  Run from repo root:
//    PATH=/opt/homebrew/opt/openjdk/bin:$PATH \
//    ./node_modules/.bin/firebase emulators:exec --only firestore \
//      --project demo-msos "cd functions && npx tsx scripts/zettleE2E.ts"
//
//  Lives under functions/ (CommonJS) so firebase-admin resolves. No
//  network: we pass Zettle GPS coordinates (geocoding skipped) and leave
//  MAP_STATIC_API_KEY unset (static map is a no-op null).
//
//  Asserts the four Phase-1 behaviours:
//    1. HIGH confidence → job auto-marked paid + linked + payment doc.
//    2. Ambiguous (two same-amount jobs) → review queue, no job touched.
//    3. Idempotent re-import → no double-apply.
//    4. No amount match → 'none' → review queue, no job touched.
// ═══════════════════════════════════════════════════════════════════

import * as admin from 'firebase-admin';
import { persistAndMatch } from '../src/zettle/applyMatch';
import { resolveMatch, dismissReview } from '../src/zettle/resolveMatch';
import type { RawZettlePurchase } from '../src/lib/zettleClient';

admin.initializeApp({ projectId: 'demo-msos' });
const db = admin.firestore();
const BIZ = 'bizE2E';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const today = new Date().toISOString().slice(0, 10);

async function seedJob(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.doc(`businesses/${BIZ}/jobs/${id}`).set({
    date: today,
    createdAt: new Date().toISOString(),
    revenue: 150,
    paymentStatus: 'Pending Payment',
    customerName: 'Test Customer',
    customerPhone: '+13055551234',
    addressLine: '123 Main St', city: 'Miami', state: 'FL', zipCode: '33101',
    ...over,
  });
}

function rawPurchase(uuid: string, amountMinor: number): RawZettlePurchase {
  return {
    purchaseUUID1: uuid,
    purchaseNumber: 1001,
    amount: amountMinor,
    vatAmount: 0,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    userDisplayName: 'Test Cashier',
    gpsCoordinates: { latitude: 25.7617, longitude: -80.1918, accuracyMeters: 8 },
    payments: [{
      uuid: 'p1', type: 'IZETTLE_CARD', amount: amountMinor,
      attributes: { cardType: 'VISA', maskedPan: '**** 1234', applicationName: 'Zettle Reader' },
    }],
  };
}

async function main(): Promise<void> {
  // ── 1. HIGH confidence → auto mark paid ──────────────────────────
  console.log('\n── 1. high-confidence single match → auto-paid ──');
  await seedJob('jobHigh', { revenue: 150 });
  const r1 = await persistAndMatch(db, BIZ, rawPurchase('PUR-HIGH', 15000), 'webhook', { autoMatch: true });
  check('confidence high', r1.confidence === 'high', JSON.stringify(r1));
  check('linked to jobHigh', r1.jobId === 'jobHigh', r1.jobId ?? 'null');
  {
    const job = (await db.doc(`businesses/${BIZ}/jobs/jobHigh`).get()).data() ?? {};
    check('job paymentStatus = Paid', job.paymentStatus === 'Paid', String(job.paymentStatus));
    check('job paymentMethod = card', job.paymentMethod === 'card');
    check('job paymentSource = zettle', job.paymentSource === 'zettle');
    check('job paymentImportId = PUR-HIGH', job.paymentImportId === 'PUR-HIGH');
    check('job status = Completed', job.status === 'Completed');
    const pay = (await db.doc(`zettleSecure/${BIZ}/payments/PUR-HIGH`).get()).data() ?? {};
    check('payment doc linked to job', pay.jobId === 'jobHigh');
    check('payment cardBrand captured', pay.cardBrand === 'VISA');
    check('paymentLocation source = zettle', pay.paymentLocation?.source === 'zettle', JSON.stringify(pay.paymentLocation));
    check('no map (no provider key) → null', pay.mapImageData === null);
  }

  // ── 2. ambiguous → review queue, no job touched ──────────────────
  console.log('\n── 2. two same-amount jobs → review queue, no auto-pay ──');
  await seedJob('jobAmbA', { revenue: 200 });
  await seedJob('jobAmbB', { revenue: 200 });
  const r2 = await persistAndMatch(db, BIZ, rawPurchase('PUR-AMB', 20000), 'webhook', { autoMatch: true });
  check('confidence low', r2.confidence === 'low', JSON.stringify(r2));
  check('no job linked', r2.jobId === null);
  {
    const a = (await db.doc(`businesses/${BIZ}/jobs/jobAmbA`).get()).data() ?? {};
    const b = (await db.doc(`businesses/${BIZ}/jobs/jobAmbB`).get()).data() ?? {};
    check('jobAmbA still unpaid', a.paymentStatus !== 'Paid');
    check('jobAmbB still unpaid', b.paymentStatus !== 'Paid');
    const rev = (await db.doc(`zettleSecure/${BIZ}/reviewQueue/PUR-AMB`).get()).data() ?? {};
    check('review item exists', rev.status === 'pending', JSON.stringify(rev));
    check('review has 2 candidates', Array.isArray(rev.candidateJobIds) && rev.candidateJobIds.length === 2,
      JSON.stringify(rev.candidateJobIds));
  }

  // ── 3. idempotent re-import → no double-apply ─────────────────────
  console.log('\n── 3. re-import same purchase → idempotent ──');
  const r3 = await persistAndMatch(db, BIZ, rawPurchase('PUR-HIGH', 15000), 'historical', { autoMatch: true });
  check('still linked to jobHigh', r3.jobId === 'jobHigh', JSON.stringify(r3));
  check('confidence still high', r3.confidence === 'high');

  // ── 4. no amount match → none ─────────────────────────────────────
  console.log('\n── 4. no matching amount → none, no job touched ──');
  const r4 = await persistAndMatch(db, BIZ, rawPurchase('PUR-NONE', 99999), 'webhook', { autoMatch: true });
  check('confidence none', r4.confidence === 'none', JSON.stringify(r4));
  check('no job linked', r4.jobId === null);
  {
    const rev = (await db.doc(`zettleSecure/${BIZ}/reviewQueue/PUR-NONE`).get()).data() ?? {};
    check('review item exists (none)', rev.status === 'pending');
    check('review has 0 candidates', Array.isArray(rev.candidateJobIds) && rev.candidateJobIds.length === 0);
  }

  // ── 5. owner resolves an ambiguous match → chosen job paid ───────
  console.log('\n── 5. owner resolves ambiguous review → job paid ──');
  const res = await resolveMatch(db, BIZ, 'PUR-AMB', 'jobAmbA');
  check('resolve ok → jobAmbA', res.ok && res.jobId === 'jobAmbA', JSON.stringify(res));
  {
    const job = (await db.doc(`businesses/${BIZ}/jobs/jobAmbA`).get()).data() ?? {};
    check('jobAmbA now Paid', job.paymentStatus === 'Paid');
    check('jobAmbA linked to PUR-AMB', job.paymentImportId === 'PUR-AMB');
    check('jobAmbA paymentSource zettle', job.paymentSource === 'zettle');
    const pay = (await db.doc(`zettleSecure/${BIZ}/payments/PUR-AMB`).get()).data() ?? {};
    check('payment now linked to jobAmbA', pay.jobId === 'jobAmbA');
    const rev = (await db.doc(`zettleSecure/${BIZ}/reviewQueue/PUR-AMB`).get()).data() ?? {};
    check('review item resolved', rev.status === 'resolved');
    const other = (await db.doc(`businesses/${BIZ}/jobs/jobAmbB`).get()).data() ?? {};
    check('the other candidate stays unpaid', other.paymentStatus !== 'Paid');
  }

  // ── 6. resolve refuses to double-pay an already-paid job ─────────
  console.log('\n── 6. resolve refuses to double-pay a job ──');
  const bad = await resolveMatch(db, BIZ, 'PUR-NONE', 'jobAmbA');
  check('refuses (job already paid by another payment)', bad.ok === false, JSON.stringify(bad));

  // ── 7. dismiss a review item (no MSOS job for this payment) ──────
  console.log('\n── 7. dismiss review item ──');
  await dismissReview(db, BIZ, 'PUR-NONE');
  {
    const rev = (await db.doc(`zettleSecure/${BIZ}/reviewQueue/PUR-NONE`).get()).data() ?? {};
    check('review item dismissed', rev.status === 'dismissed', JSON.stringify(rev));
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} zettle E2E: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('E2E crashed:', err); process.exit(1); });
