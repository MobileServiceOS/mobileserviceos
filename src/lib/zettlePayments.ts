// src/lib/zettlePayments.ts
// ═══════════════════════════════════════════════════════════════════
//  Client helper to read a Zettle payment record for invoice rendering.
//
//  Tech-safety is RULE-ENFORCED, not UI-enforced: the zettlePayments
//  collection allows reads only for owner/admin (firestore.rules). A
//  technician's getDoc here throws permission-denied, which we catch and
//  return null — so a tech-generated invoice simply has no map/location
//  block. Owner/admin reads succeed and the verified address + map flow
//  into the invoice. Raw coordinates are never surfaced (we only read
//  the human address + the rendered map image).
// ═══════════════════════════════════════════════════════════════════

import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import type { Job } from '@/types';

export interface InvoiceVerification {
  address?: string | null;
  serviceDateTime?: string | null;
  paymentTime?: string | null;
  mapDataUri?: string | null;
}

interface ZettlePaymentReadShape {
  mapImageData?: string | null;
  paymentLocation?: { address?: string | null } | null;
  timestamp?: string;
}

/**
 * Build the invoice Service-Location-Verification block from the gated
 * zettlePayments doc. Returns null when the record is missing or the
 * caller (technician) can't read it. Honors the customer-invoice
 * settings toggles — coordinates are never read or returned.
 */
export async function getZettlePaymentForInvoice(
  businessId: string,
  paymentId: string,
  opts: { includeMap: boolean; includeAddress: boolean; job: Job },
): Promise<InvoiceVerification | null> {
  try {
    const snap = await getDoc(doc(requireDb(), `zettleSecure/${businessId}/payments/${paymentId}`));
    if (!snap.exists()) return null;
    const d = snap.data() as ZettlePaymentReadShape;

    const jobAddr = [opts.job.addressLine, opts.job.city, opts.job.state]
      .filter((p) => p && String(p).trim()).join(', ');
    const address = opts.includeAddress ? (d.paymentLocation?.address || jobAddr || null) : null;
    const mapDataUri = opts.includeMap ? (d.mapImageData ?? null) : null;
    if (!address && !mapDataUri) return null;

    return {
      address,
      mapDataUri,
      serviceDateTime: opts.job.date || null,
      paymentTime: d.timestamp ? new Date(d.timestamp).toLocaleString() : null,
    };
  } catch {
    // permission-denied (technician) or any read failure → no block.
    return null;
  }
}

// ── Owner review queue (owner/admin reads; rule-gated) ───────────────

export interface ZettleReviewRow {
  id: string;
  amount: number;
  timestamp: string;
  candidateJobIds: string[];
  reasons: string[];
}

/** Pending review items for the business. Returns [] for technicians
 *  (their read of zettleSecure is denied) or on any failure. */
export async function listZettleReviewQueue(businessId: string): Promise<ZettleReviewRow[]> {
  try {
    const snap = await getDocs(collection(requireDb(), `zettleSecure/${businessId}/reviewQueue`));
    return snap.docs
      .map((d) => d.data() as ZettleReviewRow & { status?: string })
      .filter((r) => r.status === 'pending')
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  } catch {
    return [];
  }
}

// ── Payments dashboard (owner/admin reads; rule-gated) ───────────────

/** Lean payment row for dashboard aggregation. Deliberately omits the
 *  sensitive map/location fields — the dashboard only needs money, time,
 *  match state, and payment method. */
export interface ZettlePaymentRow {
  id: string;
  amount: number;
  timestamp: string;
  jobId: string | null;
  matchConfidence: 'high' | 'low' | 'none' | string;
  cardBrand: string | null;
  paymentType: string | null;
  feeAmount: number | null;
  netAmount: number | null;
}

/** All imported Zettle payments for the business, newest first. Returns
 *  [] for technicians (their read of zettleSecure is denied) or on any
 *  failure — the dashboard is owner/admin-only, gated upstream too. */
export async function listZettlePayments(businessId: string): Promise<ZettlePaymentRow[]> {
  try {
    const snap = await getDocs(collection(requireDb(), `zettleSecure/${businessId}/payments`));
    return snap.docs
      .map((d) => {
        const v = d.data() as Record<string, unknown>;
        return {
          id: String(v.id ?? d.id),
          amount: Number(v.amount ?? 0),
          timestamp: String(v.timestamp ?? ''),
          jobId: (v.jobId as string | null) ?? null,
          matchConfidence: String(v.matchConfidence ?? 'none'),
          cardBrand: (v.cardBrand as string | null) ?? null,
          paymentType: (v.paymentType as string | null) ?? null,
          feeAmount: v.feeAmount == null ? null : Number(v.feeAmount),
          netAmount: v.netAmount == null ? null : Number(v.netAmount),
        };
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  } catch {
    return [];
  }
}

export interface JobBrief { id: string; customerName: string; revenue: number | string; date: string }

/** Minimal job info for rendering review candidates (owner reads jobs). */
export async function getJobBriefs(businessId: string, ids: string[]): Promise<JobBrief[]> {
  const out: JobBrief[] = [];
  for (const id of ids.slice(0, 10)) {
    try {
      const s = await getDoc(doc(requireDb(), `businesses/${businessId}/jobs/${id}`));
      if (s.exists()) {
        const d = s.data() as { customerName?: string; revenue?: number | string; date?: string };
        out.push({ id, customerName: d.customerName ?? '', revenue: d.revenue ?? 0, date: d.date ?? '' });
      }
    } catch { /* skip unreadable candidate */ }
  }
  return out;
}
