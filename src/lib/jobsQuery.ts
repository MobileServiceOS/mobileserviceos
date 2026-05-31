import {
  type CollectionReference,
  type DocumentData,
  type Query,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────
//  jobsQuery — bounded listener query for the businesses/{bid}/jobs
//  collection.
//
//  Hotfix (2026-05-31, audit P1): the jobs listener attached at App
//  startup previously subscribed to the entire jobs collection. A
//  business with 1,500 historical jobs at ~2 KB/doc was streaming
//  ~3 MB on every cold start (no IndexedDB cache hit). The History
//  page render limit (50) was purely cosmetic — the wire cost had
//  already happened before the first render.
//
//  This module centralizes the bound: most-recent JOBS_LISTENER_PAGE_SIZE
//  jobs by `date` descending. Covers the Dashboard's "this week" /
//  "last week" / recent feed plus the History first page comfortably,
//  while collapsing cold-start traffic by ~80% for high-volume
//  businesses.
//
//  Sized at 200 not 100 because: (a) some Insights aggregates (top
//  services, top cities, profit by month) need a few months of
//  history to look stable, (b) detail-modal lookups for older jobs
//  via History "Load more" can chase a cursor query if a user
//  scrolls past — but that's a follow-up; the page-size of 200 is
//  the safe Phase-1 ceiling.
// ─────────────────────────────────────────────────────────────────────

/** Most-recent N jobs to subscribe to. Tune here; do NOT hardcode at
 *  call sites. */
export const JOBS_LISTENER_PAGE_SIZE = 200 as const;

/** Job field used for the descending order. The serializer writes
 *  `date` as a sortable ISO string, so string-comparison sorting
 *  yields true chronological order. */
export const JOBS_LISTENER_ORDER_FIELD = 'date' as const;

/** Build the bounded snapshot query for the jobs listener. Exposed as
 *  a thin function so the test suite can pin the constants and so
 *  alternative listeners (e.g. a future "today only" listener) can
 *  reuse the orderBy + collection ref pieces independently. */
export function buildJobsListenerQuery(
  jobsCol: CollectionReference<DocumentData>
): Query<DocumentData> {
  return query(
    jobsCol,
    orderBy(JOBS_LISTENER_ORDER_FIELD, 'desc'),
    limit(JOBS_LISTENER_PAGE_SIZE)
  );
}
