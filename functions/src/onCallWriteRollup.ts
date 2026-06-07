// functions/src/onCallWriteRollup.ts
// ═══════════════════════════════════════════════════════════════════
//  onCallWriteRollup — maintains daily call metrics (Bandilero #3).
//
//  Fires on any write to businesses/{bid}/calls/{callSid} and recomputes
//  that day's businesses/{bid}/callMetrics/{YYYY-MM-DD}: inbound count,
//  answer rate, missed, avg talk time, status breakdown — so Bandilero
//  reads a small precomputed doc instead of scanning the calls feed.
//
//  Runs synchronously (awaited) — Cloud Functions v2 freezes the
//  instance after return, so deferred work is unreliable (see the
//  onJobWriteCustomerRollup audit fix). Dormant until calls exist.
// ═══════════════════════════════════════════════════════════════════

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
void admin;

type CallLite = {
  direction?: string;
  status?: string;
  answered?: boolean;
  durationSec?: number;
  businessDate?: string;
};

export interface CallMetricsDay {
  date: string;
  total: number;
  inbound: number;
  /** Inbound calls that were answered. */
  answered: number;
  missed: number;
  /** answered ÷ inbound, percent (0 when no inbound). */
  answerRatePct: number;
  /** Mean talk time across answered INBOUND calls (seconds). */
  avgAnsweredDurationSec: number;
  byStatus: Record<string, number>;
}

/** Pure rollup — deterministic over the day's call docs. Answer rate +
 *  talk time are scoped to INBOUND calls (did we pick up?). */
export function _computeCallMetrics(calls: ReadonlyArray<CallLite>, date: string): CallMetricsDay {
  let inbound = 0, answered = 0, answeredDurTotal = 0;
  const byStatus: Record<string, number> = {};
  for (const c of calls) {
    const status = String(c.status || 'failed');
    byStatus[status] = (byStatus[status] || 0) + 1;
    const isInbound = (c.direction || 'inbound') === 'inbound';
    if (!isInbound) continue;
    inbound += 1;
    if (c.answered) {
      answered += 1;
      answeredDurTotal += Math.max(0, Number(c.durationSec) || 0);
    }
  }
  const missed = Math.max(0, inbound - answered);
  return {
    date,
    total: calls.length,
    inbound,
    answered,
    missed,
    answerRatePct: inbound > 0 ? Math.round((answered / inbound) * 100) : 0,
    avgAnsweredDurationSec: answered > 0 ? Math.round(answeredDurTotal / answered) : 0,
    byStatus,
  };
}

export const onCallWriteRollup = onDocumentWritten(
  'businesses/{businessId}/calls/{callSid}',
  async (event) => {
    const after = event.data?.after?.data() as CallLite | undefined;
    const before = event.data?.before?.data() as CallLite | undefined;
    const businessId = event.params.businessId;
    const date = after?.businessDate || before?.businessDate;
    if (!date) return;

    const db = admin.firestore();
    const snap = await db.collection(`businesses/${businessId}/calls`)
      .where('businessDate', '==', date)
      .get();
    const calls = snap.docs.map((d) => d.data() as CallLite);
    const metrics = _computeCallMetrics(calls, date);

    await db.doc(`businesses/${businessId}/callMetrics/${date}`)
      .set({ ...metrics, updatedAt: Timestamp.now() }, { merge: true });
  },
);

export const __testHooks = { computeCallMetrics: _computeCallMetrics };
