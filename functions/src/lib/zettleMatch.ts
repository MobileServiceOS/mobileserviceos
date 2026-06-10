// functions/src/lib/zettleMatch.ts
// ═══════════════════════════════════════════════════════════════════
//  zettleMatch — pure payment→job matching engine.
//
//  Given an imported Zettle purchase and a set of eligible (unpaid,
//  not-yet-linked) jobs, decide which job the payment belongs to and
//  how confident we are. The webhook/import handlers call this; ONLY a
//  'high' verdict auto-applies (marks the job paid). 'low'/'none' route
//  to the owner review queue and never mutate a job.
//
//  Design rules (deliberately conservative — a wrong auto-match marks
//  the wrong customer's job paid and could send them the wrong invoice):
//    • Amount must match EXACTLY (integer cents). Money is the anchor.
//    • Among exact-amount jobs, prefer those whose completion time is
//      within the window of the purchase time.
//    • Exactly one exact-amount job in the window  → HIGH.
//    • Multiple, but phone/name uniquely disambiguates one → HIGH.
//    • Multiple and ambiguous → LOW (review, with all candidate ids).
//    • None → NONE.
//
//  PURE + dependency-free on purpose: no firebase, no path aliases, so
//  it is unit-testable from the repo's root tsx test runner
//  (tests/zettleMatch.test.ts) as well as compiled into the functions
//  bundle. Callers normalize Firestore docs / Zettle JSON into the
//  plain shapes below.
// ═══════════════════════════════════════════════════════════════════

export type ZettleMatchConfidence = 'high' | 'low' | 'none';

/** Normalized purchase facts the matcher needs. The caller converts a
 *  Zettle purchase into this (amount in integer cents, excluding any
 *  gratuity so it lines up with a job's revenue). */
export interface MatchPurchase {
  amountCents: number;
  timestampMs: number;
  customerPhone?: string | null;
  customerName?: string | null;
}

/** A job eligible to be matched (already filtered by the caller to
 *  unpaid / not-yet-linked jobs for this business). */
export interface MatchJobCandidate {
  id: string;
  amountCents: number;
  /** Completion/service time in epoch ms. Caller uses paidAt ?? the
   *  service date ?? createdAt — whatever best approximates "when the
   *  card was likely run". */
  completedAtMs: number;
  customerPhone?: string | null;
  customerName?: string | null;
}

export interface MatchOptions {
  /** Max minutes between purchase time and job completion for the time
   *  signal to count. Default 240 (4h) — a roadside job and its card
   *  payment usually land close together but allow slack for delayed
   *  closeout. */
  windowMinutes?: number;
}

export interface MatchResult {
  jobId: string | null;
  confidence: ZettleMatchConfidence;
  reasons: string[];
  /** All exact-amount candidates considered (for the review queue). */
  candidateJobIds: string[];
}

/** Last 10 digits, digits only — tolerant of +1 / formatting. */
function phoneKey(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function nameKey(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a);
  const kb = phoneKey(b);
  return ka.length === 10 && ka === kb;
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  return ka.length > 0 && ka === kb;
}

/**
 * Score a Zettle purchase against eligible jobs. Pure — no side effects.
 */
export function scoreZettleMatch(
  purchase: MatchPurchase,
  candidates: MatchJobCandidate[],
  opts: MatchOptions = {},
): MatchResult {
  const windowMs = Math.max(1, opts.windowMinutes ?? 240) * 60_000;

  // 1. Amount is the anchor — exact integer-cent match only.
  const exact = candidates.filter((c) => c.amountCents === purchase.amountCents);
  const candidateJobIds = exact.map((c) => c.id);

  if (exact.length === 0) {
    return {
      jobId: null,
      confidence: 'none',
      reasons: ['no job matches the payment amount'],
      candidateJobIds: [],
    };
  }

  // 2. Phone is the strongest disambiguator when present on both sides.
  const phoneHits = exact.filter((c) => phonesMatch(c.customerPhone, purchase.customerPhone));
  if (phoneHits.length === 1) {
    return {
      jobId: phoneHits[0].id,
      confidence: 'high',
      reasons: ['exact amount', 'customer phone matches'],
      candidateJobIds,
    };
  }

  // 3. Within the time window.
  const inWindow = exact.filter(
    (c) => Math.abs(c.completedAtMs - purchase.timestampMs) <= windowMs,
  );

  if (inWindow.length === 1) {
    const reasons = ['exact amount', `completed within ${opts.windowMinutes ?? 240} min of payment`];
    if (namesMatch(inWindow[0].customerName, purchase.customerName)) reasons.push('customer name matches');
    return { jobId: inWindow[0].id, confidence: 'high', reasons, candidateJobIds };
  }

  // 4. Multiple in-window: try name to break the tie.
  if (inWindow.length > 1) {
    const nameHits = inWindow.filter((c) => namesMatch(c.customerName, purchase.customerName));
    if (nameHits.length === 1) {
      return {
        jobId: nameHits[0].id,
        confidence: 'high',
        reasons: ['exact amount', 'in time window', 'customer name uniquely matches'],
        candidateJobIds,
      };
    }
    return {
      jobId: null,
      confidence: 'low',
      reasons: [`${inWindow.length} jobs share this amount near the payment time — needs review`],
      candidateJobIds,
    };
  }

  // 5. Exactly one exact-amount job overall (just outside the window) →
  //    still a strong single candidate, but flag the time gap.
  if (exact.length === 1) {
    return {
      jobId: exact[0].id,
      confidence: 'high',
      reasons: ['exact amount', 'only one unpaid job at this amount'],
      candidateJobIds,
    };
  }

  // 6. Several exact-amount jobs, none in the window, no phone/name tie-break.
  return {
    jobId: null,
    confidence: 'low',
    reasons: [`${exact.length} jobs share this amount but none near the payment time — needs review`],
    candidateJobIds,
  };
}
