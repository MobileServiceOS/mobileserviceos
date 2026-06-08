// src/lib/bandilero/services/reputation.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Reputation: SEO / GBP + review automation (SCAFFOLD).
//
//  There is NO Google Business Profile or Search Console integration in
//  MSOS today (STEP-1 audit). Per the data-honesty rules, every metric
//  here is NOT_CONNECTED — never a fabricated rating or impression
//  count. The shapes are defined so the panel can light up the moment
//  the integration lands; until then it shows an explicit "not
//  connected" state plus the concrete steps to connect.
//
//  Review auto-reply is DRAFT-FOR-APPROVAL only (operator decision):
//  Bandilero drafts replies for a human to post; it never auto-publishes.
// ═══════════════════════════════════════════════════════════════════

import { type Metric, notConnected, estimated } from '../confidence';
import type { Connectivity } from '../types';

/** Owner-entered reputation (interim until live Google sync). */
export interface ManualReputation {
  rating?: number;
  reviewCount?: number;
  updatedAt?: string;   // ISO date
}

export interface ReputationMetrics {
  /** Average inbound review rating. NOT_CONNECTED — no GBP/Facebook API. */
  reviewScore: Metric<number>;
  /** Inbound review count. NOT_CONNECTED. */
  reviewCount: Metric<number>;
  /** Search Console impressions. NOT_CONNECTED — no GSC. */
  searchImpressions: Metric<number>;
  /** GBP profile views. NOT_CONNECTED. */
  gbpViews: Metric<number>;
}

export type AutoReplyMode = 'draft_for_approval';

export interface ReputationStatus {
  metrics: ReputationMetrics;
  /** Concrete steps for an operator to connect each source. */
  connectStepsGbp: string[];
  connectStepsGsc: string[];
  /** Default review-reply behavior. Draft-only — never auto-posts. */
  autoReplyMode: AutoReplyMode;
}

const GBP_STEPS = [
  'Authorize Google Business Profile in Settings → Integrations (OAuth).',
  'Select the business location to sync.',
  'Reviews + profile views begin flowing; review-reply drafting unlocks.',
];

const GSC_STEPS = [
  'Verify the business website in Google Search Console.',
  'Authorize Search Console (read-only) in Settings → Integrations.',
  'Search impressions + top queries begin flowing.',
];

/**
 * Reputation status. Today every metric is NOT_CONNECTED (no GBP/GSC).
 * The connectivity flags are threaded through so this lights up
 * automatically if/when those integrations are added — without faking
 * anything in the meantime.
 */
export function reputationStatus(
  conn: Pick<Connectivity, 'gbp' | 'seo'>,
  manual?: ManualReputation,
): ReputationStatus {
  const ncGbp = (reason: string) => notConnected<number>(reason, 'gbp');
  const ncSeo = (reason: string) => notConnected<number>(reason, 'seo');

  // Owner-entered values surface as ESTIMATED (NOT live/measured) with an
  // honest "entered by you" assumption — never presented as API data.
  const when = manual?.updatedAt ? ` (${manual.updatedAt})` : '';
  const enteredNote = `Entered by you${when} — connect Google Business Profile for live sync`;
  const hasRating = typeof manual?.rating === 'number' && manual.rating > 0;
  const hasCount = typeof manual?.reviewCount === 'number' && manual.reviewCount > 0;

  return {
    metrics: {
      reviewScore: hasRating
        ? estimated<number>(manual!.rating as number, enteredNote, 'You (manual)', manual?.updatedAt)
        : (conn.gbp ? ncGbp('GBP connected but review sync not yet implemented') : ncGbp('Google Business Profile not connected')),
      reviewCount: hasCount
        ? estimated<number>(manual!.reviewCount as number, enteredNote, 'You (manual)', manual?.updatedAt)
        : (conn.gbp ? ncGbp('GBP connected but review sync not yet implemented') : ncGbp('Google Business Profile not connected')),
      searchImpressions: conn.seo ? ncSeo('Search Console connected but sync not yet implemented') : ncSeo('Search Console not connected'),
      gbpViews: conn.gbp ? ncGbp('GBP connected but views sync not yet implemented') : ncGbp('Google Business Profile not connected'),
    },
    connectStepsGbp: GBP_STEPS,
    connectStepsGsc: GSC_STEPS,
    autoReplyMode: 'draft_for_approval',
  };
}
