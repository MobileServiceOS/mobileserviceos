// functions/src/zettle/applyMatch.ts
// ═══════════════════════════════════════════════════════════════════
//  persistAndMatch — shared by the webhook + historical import.
//
//  Given a raw Zettle purchase for a business:
//    1. Normalize it.
//    2. Idempotently upsert the sensitive record into the owner/admin-
//       only `zettlePayments/{purchaseUUID}` collection.
//    3. Score it against eligible (unpaid, unlinked) jobs.
//    4. Resolve the verification location (Zettle GPS → matched job GPS
//       → geocoded job address) and render a static map (best-effort).
//    5. HIGH → transactionally mark the job paid + link it (tech-safe
//       fields only on the Job). LOW/NONE → leave the job untouched and
//       drop a `zettleReviewQueue` item for the owner.
//
//  Admin SDK only (bypasses rules). Never throws on "no match".
// ═══════════════════════════════════════════════════════════════════

import type * as admin from 'firebase-admin';
import { scoreZettleMatch, type MatchJobCandidate } from '../lib/zettleMatch';
import { normalizePurchase, type RawZettlePurchase } from '../lib/zettleClient';
import { geocodeAddress } from '../lib/geo';
import { generateStaticMapDataUri } from '../lib/staticMap';

type DB = admin.firestore.Firestore;

interface JobDoc {
  id: string;
  revenue?: number | string;
  paymentStatus?: string;
  paymentImportId?: string;
  customerPhone?: string;
  customerName?: string;
  paidAt?: string;
  createdAt?: string;
  date?: string;
  lat?: number;
  lng?: number;
  addressLine?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

interface ResolvedLocation {
  latitude: number;
  longitude: number;
  source: 'zettle' | 'job_gps' | 'geocoded';
  accuracyMeters?: number | null;
  address?: string | null;
  timestamp?: string;
}

function toCents(v: number | string | undefined): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v ?? 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function jobTimeMs(j: JobDoc): number {
  const t = j.paidAt || j.createdAt || (j.date ? `${j.date}T12:00:00Z` : '');
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

function jobAddress(j: JobDoc | undefined): string | null {
  if (!j) return null;
  const parts = [j.addressLine, j.city, j.state, j.zipCode].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(', ') : null;
}

/** Resolve verification coordinates: Zettle GPS → matched-job GPS →
 *  geocoded job address. Returns null when nothing is available. */
async function resolveLocation(
  zettle: { latitude?: number; longitude?: number; accuracyMeters?: number; timestamp: string },
  job: JobDoc | undefined,
): Promise<ResolvedLocation | null> {
  const address = jobAddress(job);
  if (zettle.latitude != null && zettle.longitude != null) {
    return { latitude: zettle.latitude, longitude: zettle.longitude, source: 'zettle', accuracyMeters: zettle.accuracyMeters ?? null, address, timestamp: zettle.timestamp };
  }
  if (job?.lat != null && job?.lng != null) {
    return { latitude: job.lat, longitude: job.lng, source: 'job_gps', address, timestamp: zettle.timestamp };
  }
  if (address) {
    const geo = await geocodeAddress(address);
    if (geo) return { latitude: geo.lat, longitude: geo.lng, source: 'geocoded', address, timestamp: zettle.timestamp };
  }
  return null;
}

export interface PersistResult {
  purchaseUUID: string;
  confidence: 'high' | 'low' | 'none';
  jobId: string | null;
}

export async function persistAndMatch(
  db: DB,
  businessId: string,
  raw: RawZettlePurchase,
  importedFrom: 'webhook' | 'historical',
  opts: { autoMatch: boolean } = { autoMatch: true },
): Promise<PersistResult> {
  const n = normalizePurchase(raw);
  if (!n.purchaseUUID) throw new Error('purchase missing UUID');

  const nowIso = new Date().toISOString();
  const payRef = db.doc(`zettleSecure/${businessId}/payments/${n.purchaseUUID}`);

  const existing = await payRef.get();
  if (existing.exists && existing.get('jobId')) {
    return { purchaseUUID: n.purchaseUUID, confidence: existing.get('matchConfidence') ?? 'high', jobId: existing.get('jobId') };
  }

  // Candidate jobs by service-date window (single-field query → no
  // composite index). Keep full docs for the matched-job lookup.
  const purchaseDateMs = Date.parse(n.timestamp) || Date.now();
  const startStr = new Date(purchaseDateMs - 3 * 86_400_000).toISOString().slice(0, 10);
  const snap = await db.collection(`businesses/${businessId}/jobs`)
    .where('date', '>=', startStr)
    .orderBy('date', 'desc')
    .limit(500)
    .get();

  const eligible: JobDoc[] = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<JobDoc, 'id'>) }))
    .filter((j) => j.paymentStatus !== 'Paid' && !j.paymentImportId);
  const jobsById = new Map(eligible.map((j) => [j.id, j]));

  const candidates: MatchJobCandidate[] = eligible.map((j) => ({
    id: j.id,
    amountCents: toCents(j.revenue),
    completedAtMs: jobTimeMs(j),
    customerPhone: j.customerPhone ?? null,
    customerName: j.customerName ?? null,
  }));

  const verdict = scoreZettleMatch(
    { amountCents: n.matchAmountCents, timestampMs: purchaseDateMs, customerPhone: null, customerName: n.processedByName },
    candidates,
  );

  // Verification location + map (best-effort; never blocks the import).
  const matchedJob = verdict.confidence === 'high' && verdict.jobId ? jobsById.get(verdict.jobId) : undefined;
  let location: ResolvedLocation | null = null;
  let mapImageData: string | null = null;
  try {
    location = await resolveLocation(
      { latitude: n.latitude, longitude: n.longitude, accuracyMeters: n.accuracyMeters, timestamp: n.timestamp },
      matchedJob,
    );
    if (location) mapImageData = await generateStaticMapDataUri(location.latitude, location.longitude);
  } catch (err) {
    console.error('[persistAndMatch] location/map failed', (err as Error).message);
  }

  const paymentDoc = {
    id: n.purchaseUUID,
    transactionId: n.purchaseUUID,
    receiptNumber: n.receiptNumber ?? null,
    amount: n.grossAmount,
    tax: n.tax,
    currency: n.currency ?? null,
    timestamp: n.timestamp,
    paymentType: n.paymentType ?? null,
    cardBrand: n.cardBrand,
    maskedPan: n.maskedPan,
    deviceName: n.deviceName,
    processedByName: n.processedByName,
    customerId: null,
    jobId: null as string | null,
    invoiceId: null,
    matchConfidence: verdict.confidence,
    matchReasons: verdict.reasons,
    paymentLocation: location,
    mapImageData,
    importedFrom,
    syncSource: 'zettle' as const,
    createdAt: existing.exists ? (existing.get('createdAt') ?? nowIso) : nowIso,
  };

  const shouldApply = opts.autoMatch && verdict.confidence === 'high' && verdict.jobId;

  if (shouldApply && verdict.jobId) {
    const jobRef = db.doc(`businesses/${businessId}/jobs/${verdict.jobId}`);
    await db.runTransaction(async (tx) => {
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) throw new Error('matched job vanished');
      if (jobSnap.get('paymentStatus') === 'Paid' && jobSnap.get('paymentImportId')) return;
      tx.update(jobRef, {
        status: 'Completed',
        paymentStatus: 'Paid',
        paymentMethod: 'card',
        paymentSource: 'zettle',
        paymentImportId: n.purchaseUUID,
        paidAt: jobSnap.get('paidAt') || n.timestamp,
      });
      tx.set(payRef, { ...paymentDoc, jobId: verdict.jobId }, { merge: true });
    });
    return { purchaseUUID: n.purchaseUUID, confidence: 'high', jobId: verdict.jobId };
  }

  await payRef.set(paymentDoc, { merge: true });
  if (verdict.confidence !== 'high') {
    await db.doc(`zettleSecure/${businessId}/reviewQueue/${n.purchaseUUID}`).set({
      id: n.purchaseUUID,
      amount: n.grossAmount,
      timestamp: n.timestamp,
      candidateJobIds: verdict.candidateJobIds,
      reasons: verdict.reasons,
      status: 'pending',
      createdAt: nowIso,
    }, { merge: true });
  }
  return { purchaseUUID: n.purchaseUUID, confidence: verdict.confidence, jobId: null };
}
