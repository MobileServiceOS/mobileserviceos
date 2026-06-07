// src/lib/bandilero/confidence.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Data Confidence State (the first-class primitive)
//
//  Every number Bandilero surfaces is a Metric, never a bare value.
//  A Metric carries WHERE the number came from and HOW MUCH to trust it:
//
//    LIVE          — a real Firestore query / connected API value.
//    ESTIMATED     — a modeled value. MUST carry the assumption inline.
//    NOT_CONNECTED — no data source yet. value is null. NEVER a fake 0.
//
//  Hard rules (enforced by the constructors + assertValidMetric):
//    • No metric exists without a state.
//    • ESTIMATED must carry a non-empty `assumption`.
//    • NOT_CONNECTED must have value === null (so the UI can't render a
//      number that reads as real data).
//    • A fake zero/blank substituted for missing data is forbidden —
//      use notConnected() instead.
//
//  Tech redaction (access control) is a SEPARATE concern handled at the
//  briefing layer (BriefingSection.restricted), not a confidence state —
//  see types.ts. Redaction withholds a value the operator lacks
//  PERMISSION to see; NOT_CONNECTED describes a value that DOESN'T EXIST.
// ═══════════════════════════════════════════════════════════════════

export type ConfidenceState = 'LIVE' | 'ESTIMATED' | 'NOT_CONNECTED';

export interface Metric<T = number> {
  /** Trust/source state. Drives distinct UI rendering. */
  state: ConfidenceState;
  /** The value. ALWAYS null when NOT_CONNECTED. */
  value: T | null;
  /** REQUIRED for ESTIMATED — the modeling assumption, shown inline
   *  (e.g. "est. unrecovered missed calls × avg ticket $142"). */
  assumption?: string;
  /** Provenance, e.g. 'jobs', 'leads', 'reviewRequests', 'inventory'. */
  source?: string;
  /** Human note for NOT_CONNECTED (e.g. "Twilio not connected"). */
  reason?: string;
  /** ISO date/timestamp the underlying data is as-of. */
  asOf?: string;
}

/** A metric with a display label + format hint, used in briefing sections. */
export type MetricFormat = 'money' | 'count' | 'pct' | 'text';
export interface LabeledMetric<T = number> extends Metric<T> {
  label: string;
  format: MetricFormat;
}

/** Construct a LIVE metric (value came from real data). */
export function live<T>(value: T, source?: string, asOf?: string): Metric<T> {
  return { state: 'LIVE', value, source, asOf };
}

/**
 * Construct an ESTIMATED metric. The assumption is MANDATORY and must
 * be non-empty — a modeled number with no stated assumption is a lie.
 */
export function estimated<T>(value: T, assumption: string, source?: string, asOf?: string): Metric<T> {
  if (!assumption || !assumption.trim()) {
    throw new Error('estimated() requires a non-empty assumption — a modeled value must state its assumption.');
  }
  return { state: 'ESTIMATED', value, assumption, source, asOf };
}

/** Construct a NOT_CONNECTED metric. value is forced to null. */
export function notConnected<T = number>(reason?: string, source?: string): Metric<T> {
  return { state: 'NOT_CONNECTED', value: null, reason, source };
}

/** True when a metric has a value safe to render as a real number. */
export function hasValue<T>(m: Metric<T>): m is Metric<T> & { value: T } {
  return m.state !== 'NOT_CONNECTED' && m.value != null;
}

/**
 * Invariant guard. Throws if a metric violates the confidence contract.
 * Used by tests and by the briefing assembler's final sweep so a
 * malformed metric can never reach the UI.
 */
export function assertValidMetric(m: Metric<unknown>, label = 'metric'): void {
  if (!m || typeof m !== 'object') {
    throw new Error(`${label}: not a metric object`);
  }
  if (m.state !== 'LIVE' && m.state !== 'ESTIMATED' && m.state !== 'NOT_CONNECTED') {
    throw new Error(`${label}: missing/invalid confidence state (${String(m.state)})`);
  }
  if (m.state === 'NOT_CONNECTED' && m.value !== null) {
    throw new Error(`${label}: NOT_CONNECTED must have value === null (got ${String(m.value)})`);
  }
  if (m.state === 'ESTIMATED' && (!m.assumption || !m.assumption.trim())) {
    throw new Error(`${label}: ESTIMATED must carry a non-empty assumption`);
  }
  if (m.state === 'LIVE' && m.value == null) {
    throw new Error(`${label}: LIVE must have a non-null value (use notConnected() for missing data)`);
  }
}

/** Make a labeled metric from a metric + label/format. */
export function labeled<T>(m: Metric<T>, label: string, format: MetricFormat): LabeledMetric<T> {
  return { ...m, label, format };
}
