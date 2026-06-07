// src/lib/bandilero/services/callMetrics.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Call volume metrics reader (DETERMINISTIC, no LLM).
//
//  Reads the daily callMetrics docs produced by the onCallWriteRollup
//  trigger (fed by twilioCallStatus). Surfaces answer rate, avg talk
//  time, and inbound volume over a window. These are LIVE only when
//  Twilio call analytics are flowing — NOT_CONNECTED otherwise (never a
//  fake 0%/0min when no calls have been recorded).
// ═══════════════════════════════════════════════════════════════════

import { type Metric, live, notConnected } from '../confidence';
import type { Connectivity } from '../types';
import { addDays } from '../time';

/** Shape of businesses/{bid}/callMetrics/{YYYY-MM-DD} (written by the rollup). */
export interface CallMetricsDay {
  date: string;
  total: number;
  inbound: number;
  answered: number;
  missed: number;
  answerRatePct: number;
  avgAnsweredDurationSec: number;
  byStatus?: Record<string, number>;
}

export interface CallVolumeMetrics {
  inboundVolume: Metric<number>;
  answerRate: Metric<number>;
  avgTalkTimeMin: Metric<number>;
  missed: Metric<number>;
}

/**
 * Aggregate call metrics over the trailing window from the daily rollup
 * docs. Twilio off → all NOT_CONNECTED. Connected with calls → LIVE;
 * answer-rate/talk-time stay NOT_CONNECTED until there's actual inbound
 * volume to compute them from (no fabricated rate).
 */
export function callVolumeMetrics(
  days: ReadonlyArray<CallMetricsDay>,
  conn: Pick<Connectivity, 'twilio'>,
  today: string,
  windowDays: number,
): CallVolumeMetrics {
  if (!conn.twilio) {
    const nc = () => notConnected<number>('Twilio not connected', 'callMetrics');
    return { inboundVolume: nc(), answerRate: nc(), avgTalkTimeMin: nc(), missed: nc() };
  }
  const cutoff = addDays(today, -(Math.max(1, windowDays) - 1));
  const inWindow = (days || []).filter((d) => !!d.date && d.date >= cutoff && d.date <= today);

  let inbound = 0, answered = 0, missed = 0, answeredDurTotal = 0;
  for (const d of inWindow) {
    inbound += Number(d.inbound) || 0;
    answered += Number(d.answered) || 0;
    missed += Number(d.missed) || 0;
    answeredDurTotal += (Number(d.avgAnsweredDurationSec) || 0) * (Number(d.answered) || 0);
  }

  const inboundVolume = live(inbound, 'callMetrics', today); // 0 is a real fact when connected
  const missedM = live(missed, 'callMetrics', today);
  if (inbound === 0) {
    return {
      inboundVolume,
      missed: missedM,
      answerRate: notConnected('No inbound calls recorded in window', 'callMetrics'),
      avgTalkTimeMin: notConnected('No inbound calls recorded in window', 'callMetrics'),
    };
  }
  return {
    inboundVolume,
    missed: missedM,
    answerRate: live(Math.round((answered / inbound) * 100), 'callMetrics', today),
    avgTalkTimeMin: live(answered > 0 ? Math.round((answeredDurTotal / answered) / 60) : 0, 'callMetrics', today),
  };
}
