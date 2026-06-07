// src/lib/bandilero/services/reviews.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Review monitoring service (DETERMINISTIC, no LLM).
//
//  MSOS tracks OUTBOUND review REQUESTS (reviewRequests collection),
//  not inbound ratings — there is no GBP/rating data anywhere (STEP-1
//  audit). So:
//    • request counts → LIVE when review automation is connected,
//      NOT_CONNECTED otherwise (the queue only fills when Twilio +
//      a review link are wired).
//    • review SCORE / rating → always NOT_CONNECTED (no source exists).
// ═══════════════════════════════════════════════════════════════════

import type { ReviewRequest } from '@/types';
import { type Metric, live, notConnected } from '../confidence';
import type { Connectivity } from '../types';
import { tsMillis, windowCutoffMillis } from '../time';

export interface ReviewRequestMetrics {
  sent: Metric<number>;
  pending: Metric<number>;
  failed: Metric<number>;
}

/** Outbound review-request counts within the trailing window. */
export function reviewRequestMetrics(
  requests: ReadonlyArray<ReviewRequest>,
  conn: Pick<Connectivity, 'reviews'>,
  today: string,
  windowDays: number,
): ReviewRequestMetrics {
  if (!conn.reviews) {
    const nc = () => notConnected<number>('Review automation not connected', 'reviewRequests');
    return { sent: nc(), pending: nc(), failed: nc() };
  }
  const cutoff = windowCutoffMillis(today, windowDays);
  const inWindow = (requests || []).filter(
    (r) => (tsMillis(r.createdAt) ?? tsMillis(r.sentAt) ?? 0) >= cutoff,
  );
  let sent = 0;
  let pending = 0;
  let failed = 0;
  for (const r of inWindow) {
    if (r.status === 'sent') sent += 1;
    else if (r.status === 'pending' || r.status === 'sending') pending += 1;
    else if (r.status === 'failed') failed += 1;
  }
  return {
    sent: live(sent, 'reviewRequests', today),
    pending: live(pending, 'reviewRequests', today),
    failed: live(failed, 'reviewRequests', today),
  };
}

/**
 * Average inbound review score. There is NO review-rating source in
 * MSOS today (no GBP/Facebook API), so this is always NOT_CONNECTED —
 * never a fabricated star rating.
 */
export function reviewScore(): Metric<number> {
  return notConnected('No review-score source — GBP/Facebook API not connected', 'gbp');
}
