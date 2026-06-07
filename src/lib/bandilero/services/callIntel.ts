// src/lib/bandilero/services/callIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Call Intelligence service (DETERMINISTIC, no LLM).
//
//  Missed calls are Lead docs with source === 'missed_call' (written by
//  the twilioVoiceStatus webhook). Recovery = the lead reached a Booked
//  or Closed status; Lost = status 'Lost'; everything else is still open.
//
//  CRITICAL (data honesty): this data only flows when Twilio is wired.
//  When connectivity.twilio is false we return NOT_CONNECTED — NEVER 0 —
//  so the UI can't read "0 missed calls" as a real fact when the truth
//  is "we aren't receiving call data yet".
//
//  Lost revenue is a MODELED estimate: unrecovered × average ticket,
//  surfaced as ESTIMATED with the assumption stated inline.
// ═══════════════════════════════════════════════════════════════════

import type { Lead } from '@/types';
import { money } from '@/lib/utils';
import { type Metric, live, estimated, notConnected } from '../confidence';
import type { Connectivity } from '../types';
import { tsMillis, windowCutoffMillis } from '../time';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const MISSED_SOURCE = 'missed_call';
const RECOVERED = new Set(['Booked', 'Closed']);

export interface MissedCallStats {
  total: number;
  recovered: number;
  lost: number;
  /** total − recovered — the count modeled as potential lost revenue. */
  unrecovered: number;
}

/** Pure counts of missed-call leads within the trailing window. */
export function missedCallStats(
  leads: ReadonlyArray<Lead>,
  today: string,
  windowDays: number,
): MissedCallStats {
  const cutoff = windowCutoffMillis(today, windowDays);
  const missed = (leads || []).filter(
    (l) => l.source === MISSED_SOURCE && (tsMillis(l.receivedAt) ?? 0) >= cutoff,
  );
  let recovered = 0;
  let lost = 0;
  for (const l of missed) {
    if (RECOVERED.has(l.status)) recovered += 1;
    else if (l.status === 'Lost') lost += 1;
  }
  const total = missed.length;
  return { total, recovered, lost, unrecovered: Math.max(0, total - recovered) };
}

export interface MissedCallMetrics {
  count: Metric<number>;
  recovered: Metric<number>;
  unrecovered: Metric<number>;
  lostRevenue: Metric<number>;
}

/**
 * Missed-call metrics with confidence states. When Twilio is not
 * connected, ALL legs are NOT_CONNECTED (no data source). When
 * connected, counts are LIVE and lostRevenue is an ESTIMATED model.
 */
export function missedCallMetrics(
  leads: ReadonlyArray<Lead>,
  conn: Pick<Connectivity, 'twilio'>,
  today: string,
  windowDays: number,
  avgTicket: number,
): MissedCallMetrics {
  if (!conn.twilio) {
    const nc = () => notConnected<number>('Twilio not connected', 'leads');
    return { count: nc(), recovered: nc(), unrecovered: nc(), lostRevenue: nc() };
  }
  const s = missedCallStats(leads, today, windowDays);
  const lost = round2(s.unrecovered * avgTicket);
  return {
    count: live(s.total, 'leads', today),
    recovered: live(s.recovered, 'leads', today),
    unrecovered: live(s.unrecovered, 'leads', today),
    lostRevenue: estimated(
      lost,
      `est. ${s.unrecovered} unrecovered missed call(s) × avg ticket ${money(avgTicket)}`,
      'leads',
      today,
    ),
  };
}
