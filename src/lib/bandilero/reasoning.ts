// src/lib/bandilero/reasoning.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Reasoning layer (the ONLY place that touches the LLM).
//
//  Deterministic services never call the model. This module is the lone
//  bridge to callAI() (the Cloudflare Worker proxy). Per the chosen
//  "deterministic-first, AI optional" posture, every function here
//  returns a NOT_CONNECTED Metric when AI is off (isAIConfigured()
//  false) or the call fails — so the UI degrades honestly and the
//  briefing's NUMBERS (deterministic) are unaffected.
//
//  Grounding convention (matches aiInsights/pricingInsights): we send a
//  numeric digest built ONLY from the briefing's real metric values.
//  The proxy task is instructed to narrate those numbers and invent
//  none. The narrative is presented as AI-written prose, not as data.
// ═══════════════════════════════════════════════════════════════════

import { isAIConfigured, callAI } from '@/lib/aiClient';
import { type Metric, live, notConnected, hasValue } from './confidence';
import type { Briefing } from './types';

/** A flat, numbers-only digest derived from a built briefing. */
export interface BriefingDigest {
  businessName: string | null;
  date: string;
  metrics: Array<{ section: string; label: string; value: number; state: 'LIVE' | 'ESTIMATED'; assumption?: string }>;
  actions: Array<{ title: string; impact: number; state: 'LIVE' | 'ESTIMATED'; assumption?: string }>;
}

/**
 * Extract a grounded digest from a briefing — ONLY metrics that carry a
 * real value (LIVE/ESTIMATED). NOT_CONNECTED metrics are omitted so the
 * model is never handed a placeholder to narrate.
 */
export function buildBriefingDigest(briefing: Briefing): BriefingDigest {
  const metrics: BriefingDigest['metrics'] = [];
  for (const s of briefing.sections) {
    if (s.restricted) continue;
    for (const m of s.metrics) {
      if (hasValue(m) && (m.state === 'LIVE' || m.state === 'ESTIMATED')) {
        metrics.push({
          section: s.title,
          label: m.label,
          value: m.value,
          state: m.state,
          assumption: m.assumption,
        });
      }
    }
  }
  const actions: BriefingDigest['actions'] = [];
  for (const a of briefing.topActions) {
    if (hasValue(a.impact) && (a.impact.state === 'LIVE' || a.impact.state === 'ESTIMATED')) {
      actions.push({
        title: a.title,
        impact: a.impact.value,
        state: a.impact.state,
        assumption: a.impact.assumption,
      });
    }
  }
  return { businessName: briefing.greeting.businessName, date: briefing.generatedFor, metrics, actions };
}

/**
 * Draft the daily-briefing narrative. Returns a Metric<string>:
 *   • NOT_CONNECTED when AI is off or the call fails (graceful).
 *   • LIVE prose when the proxy returns text.
 * Never throws.
 */
export async function draftBriefingNarrative(briefing: Briefing): Promise<Metric<string>> {
  if (!isAIConfigured()) return notConnected<string>('AI not connected', 'ai');
  const digest = buildBriefingDigest(briefing);
  const res = await callAI('bandilero_briefing', digest);
  if (!res.ok || !res.text) {
    return notConnected<string>(res.error || 'AI call failed', 'ai');
  }
  return live(res.text, 'ai', briefing.generatedFor);
}

/**
 * Draft a reply to a customer review. AI-optional scaffold — returns
 * NOT_CONNECTED until the proxy `review_reply` task + AI are live
 * (Phase 3). Never throws.
 */
export async function draftReviewReply(input: { rating?: number; text: string; businessName?: string }): Promise<Metric<string>> {
  if (!isAIConfigured()) return notConnected<string>('AI not connected', 'ai');
  const res = await callAI('review_reply', input);
  if (!res.ok || !res.text) return notConnected<string>(res.error || 'AI call failed', 'ai');
  return live(res.text, 'ai');
}
