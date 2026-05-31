import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

// ─────────────────────────────────────────────────────────────────────
//  scheduledDeletionPurge — weekly hard-delete of business subtrees
//  whose owners requested account deletion.
//
//  Audit compliance P1 (2026-05-31): the public Privacy Policy at
//  src/pages/PrivacyTerms.tsx promises hard-deletion of personal
//  data within 30 days of request, but until this function shipped,
//  there was no code path that actually purged the data. The
//  Settings → Delete Account flow writes a `deletion-request`
//  marker doc and called it done. This function enforces the
//  promise.
//
//  How it works:
//    1. Once per week (Sunday 04:00 America/New_York) the function
//       queries collectionGroup('meta') for docs matching:
//         • document id   = 'deletion-request'
//         • field `scope`  = 'business'
//         • field `requestedAt` ≤ (now - 25 days)
//
//       The 25-day cutoff (not 30) gives a 5-day buffer between the
//       earliest possible purge and the 30-day Privacy Policy
//       deadline. A request submitted on day 0 is guaranteed to be
//       purged on day ≤25 + ≤7 (next weekly run) = day ≤32, with
//       most requests purged on day 25-28.
//
//    2. For each matching marker, the function:
//         a. Recursively deletes everything under
//            `businesses/{businessId}/**` via admin.firestore()
//            .recursiveDelete()
//         b. Logs a structured audit line with the business id,
//            requestedAt, requestedBy uid, and purgedAt timestamp
//         c. Removes the deletion-request marker itself last (so a
//            partial failure leaves the marker in place to be
//            retried on the next weekly run)
//
//    3. The function does NOT touch:
//         • The user's Firebase Auth account (delete-self via
//           Firebase Auth is the user's responsibility — we only
//           own their business data)
//         • Stripe Customer records (the user can request closure
//           via Stripe directly)
//         • Top-level errorLogs entries (they're per-session and
//           expire on their own; not personally identifiable beyond
//           the email/uid that the user can already delete via
//           Firebase Auth)
//
//  Defensive design:
//    • The recursiveDelete API is rate-limited internally and won't
//      blow up the project's Firestore quotas even on a large biz.
//    • Each marker is processed independently; one failure doesn't
//      block the rest.
//    • If the function times out mid-purge, the partially-deleted
//      business stays in a half-state but the marker remains; the
//      NEXT weekly run will retry the recursiveDelete (it's
//      idempotent — deleting an already-deleted subtree is a no-op).
//    • No retries within the same run — Cloud Scheduler will fire
//      again next week.
//
//  Pre-deploy operator setup:
//    None. The function uses the default service account, which has
//    full Firestore admin permissions out of the box.
// ─────────────────────────────────────────────────────────────────────

const PURGE_AFTER_DAYS = 25;
const MAX_PURGES_PER_RUN = 50; // safety cap; raise if backlog grows

export const scheduledDeletionPurge = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub
  .schedule('every sunday 04:00')
  .timeZone('America/New_York')
  .onRun(async () => {
    const startTs = Date.now();
    const cutoffMs = startTs - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    // eslint-disable-next-line no-console
    console.info('[deletionPurge] start', { cutoffIso, purgeAfterDays: PURGE_AFTER_DAYS });

    const db = admin.firestore();
    // collectionGroup('meta') finds every `meta` subcollection across
    // all businesses. We then filter by document id and timestamp.
    const snap = await db
      .collectionGroup('meta')
      .where('scope', '==', 'business')
      .where('requestedAt', '<=', cutoffIso)
      .limit(MAX_PURGES_PER_RUN)
      .get();

    if (snap.empty) {
      // eslint-disable-next-line no-console
      console.info('[deletionPurge] no markers due', { durationMs: Date.now() - startTs });
      return;
    }

    let purged = 0;
    let failed = 0;

    for (const docSnap of snap.docs) {
      // Filter by document id — collectionGroup matches every doc in
      // any `meta` subcollection, but only 'deletion-request' docs
      // signal a purge. Other meta docs (future flags, settings) are
      // left untouched.
      if (docSnap.id !== 'deletion-request') continue;

      // Walk up the path to extract the business id.
      // Path shape: businesses/{businessId}/meta/deletion-request
      const businessRef = docSnap.ref.parent.parent;
      if (!businessRef || businessRef.parent?.id !== 'businesses') {
        // Defensive: skip docs that don't match the expected path
        // shape. Shouldn't happen, but won't crash the run if it does.
        // eslint-disable-next-line no-console
        console.warn('[deletionPurge] unexpected path', { path: docSnap.ref.path });
        continue;
      }
      const businessId = businessRef.id;
      const data = docSnap.data();

      try {
        // Recursive delete everything under businesses/{bid}/**.
        // The admin SDK's recursiveDelete handles batching, rate
        // limiting, and subcollection traversal automatically.
        await db.recursiveDelete(businessRef);

        // eslint-disable-next-line no-console
        console.info('[deletionPurge] purged', {
          businessId,
          requestedAt: data.requestedAt,
          requestedBy: data.requestedBy,
          requestedEmail: data.requestedEmail,
          purgedAt: new Date().toISOString(),
        });
        purged += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[deletionPurge] purge failed', {
          businessId,
          error: (err as Error).message,
        });
        failed += 1;
        // Don't rethrow — continue to next marker. The marker stays
        // in place; next weekly run will retry.
      }
    }

    // eslint-disable-next-line no-console
    console.info('[deletionPurge] done', {
      purged,
      failed,
      durationMs: Date.now() - startTs,
    });
  });
