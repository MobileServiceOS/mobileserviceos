// src/lib/voiceCommands.ts
// ═══════════════════════════════════════════════════════════════════
//  Deterministic voice-command parser. NO AI / NO network — a plain
//  keyword/grammar matcher that maps a speech transcript to a typed
//  intent. Free, instant, and unit-testable. Web Speech does the STT
//  (desktop/Android Chrome); this turns the words into an action.
//
//  v1 intents are all read-only or navigation (safe to run instantly):
//  navigate, a spoken metric answer, or open the new-job form. Mutating
//  commands (inventory add/deduct, log payment) come later behind a
//  confirm step.
// ═══════════════════════════════════════════════════════════════════

import type { TabId } from '@/types';

export type VoiceMetric = 'revenueToday' | 'profitToday' | 'jobsToday';

export type VoiceIntent =
  | { type: 'navigate'; tab: TabId; label: string }
  | { type: 'metric'; metric: VoiceMetric }
  | { type: 'newJob' }
  | { type: 'unknown'; transcript: string };

function has(q: string, ...terms: string[]): boolean { return terms.some((t) => q.includes(t)); }

// Screen synonyms → tab. Order-independent; longest/most-specific first
// where a word could collide.
const NAV: Array<{ tab: TabId; label: string; words: string[] }> = [
  { tab: 'leads',     label: 'Leads',     words: ['lead'] },
  { tab: 'customers', label: 'Customers', words: ['customer', 'client'] },
  { tab: 'inventory', label: 'Inventory', words: ['inventory', 'inv', 'tire', 'stock'] },
  { tab: 'history',   label: 'Jobs',      words: ['job history', 'history', 'jobs list', 'all jobs'] },
  { tab: 'insights',  label: 'Insights',  words: ['insight', 'report', 'analytic'] },
  { tab: 'settings',  label: 'Settings',  words: ['setting', 'preference'] },
  { tab: 'payouts',   label: 'Payouts',   words: ['payout', 'distributable'] },
  { tab: 'expenses',  label: 'Expenses',  words: ['expense'] },
  { tab: 'dashboard', label: 'Home',      words: ['home', 'dashboard'] },
];

const NAV_TRIGGER = ['open', 'go to', 'show', 'take me to', 'switch to', 'navigate', 'pull up'];

/**
 * Parse a raw speech transcript into a typed voice intent.
 * Precedence: metric answers → new-job → navigation → unknown.
 * (Metrics are checked first so "jobs today" doesn't match the Jobs nav.)
 */
export function parseVoiceCommand(raw: string): VoiceIntent {
  const q = (raw || '').toLowerCase().trim();
  if (!q) return { type: 'unknown', transcript: raw };

  // ── Metric answers ──────────────────────────────────────────────
  const today = has(q, 'today', "today's", 'so far today');
  if (today && has(q, 'revenue', 'sales', 'made', 'make', 'money', 'take', 'gross')) return { type: 'metric', metric: 'revenueToday' };
  if (today && has(q, 'profit', 'net', 'earn')) return { type: 'metric', metric: 'profitToday' };
  if (has(q, 'jobs today', 'jobs completed', 'completed today', 'how many jobs', 'jobs done')
      || (today && has(q, 'job'))) return { type: 'metric', metric: 'jobsToday' };

  // ── New job ─────────────────────────────────────────────────────
  if (has(q, 'new job', 'log a job', 'log job', 'add a job', 'add job', 'start a job',
          'start job', 'create job', 'create a job', 'log new')) {
    return { type: 'newJob' };
  }

  // ── Navigation ──────────────────────────────────────────────────
  // Either an explicit trigger ("open inventory") or a bare screen word.
  const triggered = has(q, ...NAV_TRIGGER);
  for (const n of NAV) {
    if (n.words.some((w) => q.includes(w))) {
      // Require a trigger for the bare "home" word to avoid false hits;
      // every other screen word is specific enough to act on its own.
      if (n.tab === 'dashboard' && !triggered && q !== 'home') continue;
      return { type: 'navigate', tab: n.tab, label: n.label };
    }
  }

  return { type: 'unknown', transcript: raw };
}
