// ═══════════════════════════════════════════════════════════════════
//  src/lib/review.ts — backward-compatible facade
// ═══════════════════════════════════════════════════════════════════
//
//  The original `review.ts` had a fixed template and only supported
//  SMS. Templates and sharing channels now live in
//  `src/lib/reviewTemplates.ts` (which supports service-aware variant
//  rotation, multiple channels, and deterministic seed-based picking).
//
//  This file keeps the OLD function signatures (`buildReviewMsg`,
//  `openReviewSMS`) so existing call sites (App.tsx → handleSendReview)
//  keep compiling without changes. Both functions delegate to the new
//  reviewTemplates API under the hood.
//
//  New code should import from `@/lib/reviewTemplates` directly:
//    - buildReviewMessage(opts)     — assemble message
//    - shareReviewMessage(opts, ch) — open SMS/iMessage/WhatsApp
//    - pickReviewVariant(opts)      — preview / test helper
// ═══════════════════════════════════════════════════════════════════

import {
  buildReviewMessage,
  shareReviewMessage,
  type ShareChannel,
} from '@/lib/reviewTemplates';

/**
 * Build a review-request SMS body.
 *
 * KEPT for backwards-compat with existing call sites; internally
 * delegates to `buildReviewMessage` with no seed (random variant
 * rotation). Pass a `jobId` to `buildReviewMessage` directly for
 * deterministic output.
 */
export function buildReviewMsg(
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string,
): string {
  return buildReviewMessage({
    reviewUrl: url,
    customerName,
    service,
    locationLabel: location,
    state,
    businessName: brandName,
  });
}

/**
 * Open the device's SMS app pre-filled with a review request.
 *
 * KEPT for backwards-compat. Internally uses `shareReviewMessage`
 * which supports more channels (sms, imessage, whatsapp, clipboard);
 * this wrapper hardcodes 'sms' for the legacy call sites.
 */
export function openReviewSMS(
  phone: string,
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string,
): void {
  shareReviewMessage(
    {
      phone,
      reviewUrl: url,
      customerName,
      service,
      locationLabel: location,
      state,
      businessName: brandName,
    },
    'sms',
  );
}

/**
 * Newer convenience: open a review request on a specific channel.
 * Drop-in alternative when a caller wants WhatsApp or iMessage.
 */
export function openReviewOnChannel(
  channel: ShareChannel,
  phone: string,
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string,
): string {
  return shareReviewMessage(
    {
      phone,
      reviewUrl: url,
      customerName,
      service,
      locationLabel: location,
      state,
      businessName: brandName,
    },
    channel,
  );
}

// Re-export the new API so callers migrating off the legacy
// functions can `import { buildReviewMessage } from '@/lib/review'`
// during transition.
export {
  buildReviewMessage,
  shareReviewMessage,
  pickReviewVariant,
  openReviewSMSFromJob,
  type ShareChannel,
  type ReviewMessageOptions,
  type ServiceKey,
} from '@/lib/reviewTemplates';

// ─────────────────────────────────────────────────────────────────────
//  Review automation — post-payment prompt gate
// ─────────────────────────────────────────────────────────────────────

import type { Job, Brand } from '@/types';

/**
 * Decide whether marking a job paid should surface the one-tap
 * "Send review" action-toast. Pure — all inputs in, boolean out.
 *
 * All three conditions must hold:
 *   1. autoReviewPrompt is not explicitly off (undefined → on).
 *   2. brand.reviewUrl is set — otherwise the send path dead-ends
 *      ("Set review URL in Settings") and prompting is pointless.
 *   3. the job hasn't already had a review requested — no
 *      double-prompting the same job.
 */
export function shouldPromptReview(job: Job, brand: Brand): boolean {
  if (brand.autoReviewPrompt === false) return false;
  if (!(brand.reviewUrl || '').trim()) return false;
  if (job.reviewRequested) return false;
  return true;
}
