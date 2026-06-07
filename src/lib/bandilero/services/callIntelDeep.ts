// src/lib/bandilero/services/callIntelDeep.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Call Intelligence (deep) service (DETERMINISTIC, no LLM).
//
//  Builds on callIntel.ts with funnel, conversion rate, and response
//  time — all from real Lead + CommunicationEvent docs. Gated on Twilio
//  connectivity: when calls aren't flowing, every metric is
//  NOT_CONNECTED (never a fake 0 / 0%).
// ═══════════════════════════════════════════════════════════════════

import type { Lead, CommunicationEvent } from '@/types';
import { type Metric, live, notConnected } from '../confidence';
import type { Connectivity } from '../types';
import { tsMillis, windowCutoffMillis } from '../time';

const MISSED_SOURCE = 'missed_call';
const RECOVERED = new Set(['Booked', 'Closed']);

function missedInWindow(leads: ReadonlyArray<Lead>, today: string, windowDays: number): Lead[] {
  const cutoff = windowCutoffMillis(today, windowDays);
  return (leads || []).filter(
    (l) => l.source === MISSED_SOURCE && (tsMillis(l.receivedAt) ?? 0) >= cutoff,
  );
}

export interface FunnelCounts {
  new: number; contacted: number; quoted: number; booked: number; closed: number; lost: number;
}

/** Missed-call lead counts by status within the window. */
export function funnelCounts(leads: ReadonlyArray<Lead>, today: string, windowDays: number): FunnelCounts {
  const f: FunnelCounts = { new: 0, contacted: 0, quoted: 0, booked: 0, closed: 0, lost: 0 };
  for (const l of missedInWindow(leads, today, windowDays)) {
    switch (l.status) {
      case 'New': f.new += 1; break;
      case 'Contacted': f.contacted += 1; break;
      case 'Quoted': f.quoted += 1; break;
      case 'Booked': f.booked += 1; break;
      case 'Closed': f.closed += 1; break;
      case 'Lost': f.lost += 1; break;
    }
  }
  return f;
}

export interface CallIntelDeep {
  /** Recovered (Booked/Closed) ÷ total missed, as a percent. */
  conversionPct: Metric<number>;
  /** Funnel counts, exposed as individual LIVE metrics. */
  funnel: Record<keyof FunnelCounts, Metric<number>>;
  /** Average minutes from a missed call to the first outbound contact. */
  avgResponseMinutes: Metric<number>;
}

/**
 * Average response time (minutes) from a missed-call lead's receivedAt
 * to the FIRST outbound CommunicationEvent tied to that lead. Only leads
 * that actually received an outbound contact contribute. Returns
 * NOT_CONNECTED when there are no measurable responses (can't average
 * nothing) — never a fabricated 0.
 */
export function avgResponseMinutes(
  leads: ReadonlyArray<Lead>,
  events: ReadonlyArray<CommunicationEvent>,
  today: string,
  windowDays: number,
): Metric<number> {
  const missed = missedInWindow(leads, today, windowDays);
  // First outbound event per leadId.
  const firstOutbound = new Map<string, number>();
  for (const e of events || []) {
    if (e.direction !== 'outbound' || !e.leadId) continue;
    const ms = tsMillis(e.sentAt);
    if (ms == null) continue;
    const prev = firstOutbound.get(e.leadId);
    if (prev == null || ms < prev) firstOutbound.set(e.leadId, ms);
  }
  const deltas: number[] = [];
  for (const l of missed) {
    const recv = tsMillis(l.receivedAt);
    const resp = firstOutbound.get(l.id);
    if (recv == null || resp == null || resp < recv) continue;
    deltas.push((resp - recv) / 60000);
  }
  if (deltas.length === 0) {
    return notConnected('No outbound responses recorded yet', 'communicationEvents');
  }
  const avg = Math.round(deltas.reduce((t, d) => t + d, 0) / deltas.length);
  return live(avg, 'communicationEvents', today);
}

/** Full deep call-intel bundle, connectivity-aware. */
export function callIntelDeep(
  leads: ReadonlyArray<Lead>,
  events: ReadonlyArray<CommunicationEvent>,
  conn: Pick<Connectivity, 'twilio'>,
  today: string,
  windowDays: number,
): CallIntelDeep {
  if (!conn.twilio) {
    const nc = () => notConnected<number>('Twilio not connected', 'leads');
    return {
      conversionPct: nc(),
      funnel: { new: nc(), contacted: nc(), quoted: nc(), booked: nc(), closed: nc(), lost: nc() },
      avgResponseMinutes: nc(),
    };
  }
  const f = funnelCounts(leads, today, windowDays);
  const total = f.new + f.contacted + f.quoted + f.booked + f.closed + f.lost;
  const recovered = f.booked + f.closed;
  const conversionPct = live(total > 0 ? Math.round((recovered / total) * 100) : 0, 'leads', today);
  return {
    conversionPct,
    funnel: {
      new: live(f.new, 'leads', today),
      contacted: live(f.contacted, 'leads', today),
      quoted: live(f.quoted, 'leads', today),
      booked: live(f.booked, 'leads', today),
      closed: live(f.closed, 'leads', today),
      lost: live(f.lost, 'leads', today),
    },
    avgResponseMinutes: avgResponseMinutes(leads, events, today, windowDays),
  };
}
