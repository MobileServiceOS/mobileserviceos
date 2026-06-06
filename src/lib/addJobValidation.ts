// src/lib/addJobValidation.ts
// ═══════════════════════════════════════════════════════════════════
//  Add Job — required-field gating.
//
//  Batch C (2026-06-05): the Save Job button used to accept any draft
//  in any state, so a tap-through on the default EMPTY_JOB landed a
//  $0 / "Flat Tire Repair" / "Sedan" / no-customer job in Firestore.
//  This helper centralizes the required-field rules so the AddJob
//  page can disable Save and surface a "Missing: …" hint, and so
//  tests can pin the rules without spinning up a React render.
//
//  Required to save a Job draft:
//    1. customerPhone present AND matches the permissive E.164 shape
//       /^\+?[1-9]\d{6,14}$/ (leading-plus tolerated; 7–15 trailing
//       digits, first digit non-zero). Same regex shape used by the
//       Twilio voice-status path in functions/src/twilioVoiceStatus.ts
//       — kept inline here to avoid the AddJob page importing from
//       the Cloud Functions tree.
//    2. service is a non-empty string after trim. The default EMPTY_JOB
//       seeds 'Flat Tire Repair' so this passes unless the operator
//       actively clears it — but the rule guards future EMPTY_JOB
//       changes and any path that constructs a draft from scratch.
//    3. revenue parses to a Number > 0. Coerces strings (the field is
//       string|number in the Job type) and rejects 'NaN', '', '0',
//       and negative values.
//
//  Notes:
//    - "+ Another" is intentionally NOT gated by this — operators can
//      swap drafts even if the current one is incomplete. The button
//      that consumes `canSave` is the primary Save Job (and Update Job
//      on edits).
//    - Cancel is unaffected.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';

export type AddJobMissingField = 'phone' | 'service' | 'revenue';

export interface AddJobValidation {
  canSave: boolean;
  missing: AddJobMissingField[];
}

/**
 * Permissive E.164 check. Mirrors the regex used in
 * functions/src/twilioVoiceStatus.ts::_isValidE164 — leading + is
 * optional, first digit must be 1–9 (rules out '0' and '+0' inputs),
 * and 7–15 trailing digits are allowed (ITU-T E.164 max is 15).
 *
 * Strips whitespace, dashes, dots, and parens before matching so the
 * `formatPhone` display form like '(305) 897-7030' or
 * '+1 (305) 897-7030' validates the same as the raw '+13058977030'.
 */
export function isValidAddJobPhone(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const stripped = raw.replace(/[\s().\-]/g, '');
  return /^\+?[1-9]\d{6,14}$/.test(stripped);
}

/**
 * Pure validator. Reads the three required fields off a Job draft and
 * returns the `canSave` boolean plus the ordered list of missing
 * fields for the inline "Missing: …" hint above the save footer.
 *
 * `missing` order is stable: phone → service → revenue. Drives the
 * comma-joined hint string and is what tests assert against.
 */
export function validateAddJob(job: Pick<Job, 'customerPhone' | 'service' | 'revenue'>): AddJobValidation {
  const missing: AddJobMissingField[] = [];

  if (!isValidAddJobPhone(job.customerPhone)) {
    missing.push('phone');
  }

  const service = typeof job.service === 'string' ? job.service.trim() : '';
  if (!service) {
    missing.push('service');
  }

  // Revenue is `string | number` on Job. Coerce, then reject NaN and
  // anything <= 0. Explicit `Number('')` returns 0 — caught here. The
  // string '0' is also caught (Number('0') === 0). Negative numbers
  // are similarly rejected.
  const rev = Number(job.revenue);
  if (!Number.isFinite(rev) || rev <= 0) {
    missing.push('revenue');
  }

  return { canSave: missing.length === 0, missing };
}
