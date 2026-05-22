# AI Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand AI owner-briefing to the Insights page — 3-5 grounded bullet points generated from the metrics `computeInsights()` already produces.

**Architecture:** A pure `src/lib/aiInsights.ts` module trims the `Insights` object into a compact digest and parses Claude's reply through a numeric grounding guard. A new `insights` task in the AI-proxy Worker owns the prompt. The Insights page gets a button + summary card calling the existing `callAI` transport.

**Tech Stack:** TypeScript, React 18, Vite; Cloudflare Worker (`ai-proxy/`); hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-ai-insights-design.md`

---

## File Structure

- **Create `src/lib/aiInsights.ts`** — pure module. Owns `InsightsDigest`, `InsightsResult` types; `buildInsightsInput()` (trim the `Insights` object into a rounded digest); `parseInsightsResponse()` (parse + numeric grounding guard). No I/O, no React.
- **Create `tests/aiInsights.test.ts`** — logic tests, hand-rolled `check()` runner.
- **Modify `ai-proxy/worker.js`** — add the `insights` entry to the `TASKS` map.
- **Modify `src/pages/Insights.tsx`** — button, state, summary card.
- **Modify `src/styles/app.css`** — button + card styles.

Notes for the engineer:
- `callAI(task, input)` from `src/lib/aiClient.ts` returns `{ ok, text?, error? }` and never throws. `isAIConfigured()` from the same module returns whether the proxy URL is set.
- `computeInsights()` returns the `Insights` interface exported by `src/lib/insights.ts`: `revenueTrend: WeekPoint[]` (`{weekStart, revenue, profit}`, 8 entries), `topServices: ServiceStat[]` (`{service, revenue, profit, count}`), `topSources: SourceStat[]` (`{source, revenue, count}`), `topCities: CityStat[]` (`{city, profit, count}`), `repeat: {total, repeat, pct}`, `unpaidAging: AgingRow[]` (`{bucket, count, total}`, 4 entries).
- The Insights page already computes `const ins = useMemo(() => computeInsights(jobs, settings, TODAY()), [jobs, settings])`.
- Logic tests run via `npx tsx tests/<name>.test.ts`; `@/` resolves to `src/`. `npm test` runs all logic suites.
- This mirrors the shipped AI Price Check feature (`docs/superpowers/plans/2026-05-22-ai-pricing.md`) — same shape, same patterns.

---

## Task 1: `src/lib/aiInsights.ts` — pure module + tests

**Files:**
- Create: `src/lib/aiInsights.ts`
- Test: `tests/aiInsights.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/aiInsights.test.ts`:

```ts
// tests/aiInsights.test.ts
// Run: npx tsx tests/aiInsights.test.ts

import { buildInsightsInput, parseInsightsResponse } from '@/lib/aiInsights';
import type { InsightsDigest } from '@/lib/aiInsights';
import type { Insights } from '@/lib/insights';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ buildInsightsInput ──────────────────────────────');
{
  const insights: Insights = {
    revenueTrend: [
      { weekStart: '2026-03-30', revenue: 1000.4, profit: 300.6 },
      { weekStart: '2026-04-06', revenue: 1500, profit: 500 },
    ],
    topServices: Array.from({ length: 7 }, (_, i) => ({
      service: `S${i}`, revenue: 100 * (i + 1), profit: 10 * (i + 1), count: i + 1,
    })),
    topSources: Array.from({ length: 7 }, (_, i) => ({
      source: `Src${i}`, revenue: 50 * (i + 1), count: i + 1,
    })),
    topCities: Array.from({ length: 7 }, (_, i) => ({
      city: `City${i}`, profit: 20 * (i + 1), count: i + 1,
    })),
    repeat: { total: 50, repeat: 17, pct: 34 },
    unpaidAging: [
      { bucket: '0-7d', count: 1, total: 100 },
      { bucket: '8-30d', count: 2, total: 200.5 },
      { bucket: '31-60d', count: 0, total: 0 },
      { bucket: '60d+', count: 3, total: 900 },
    ],
  };
  const d = buildInsightsInput(insights);
  check('weeks mapped with week/revenue/profit, rounded',
    d.weeks.length === 2 && d.weeks[0].week === '2026-03-30'
    && d.weeks[0].revenue === 1000 && d.weeks[0].profit === 301);
  check('totalRevenue8w = rounded sum of trend revenue', d.totalRevenue8w === 2500);
  check('totalProfit8w = rounded sum of trend profit', d.totalProfit8w === 801);
  check('topServices capped at 5', d.topServices.length === 5);
  check('topSources capped at 5', d.topSources.length === 5);
  check('topCities capped at 5', d.topCities.length === 5);
  check('repeat fields carried',
    d.repeatCustomerPct === 34 && d.repeatCustomers === 17 && d.totalCustomers === 50);
  check('unpaid buckets carried + rounded',
    d.unpaid.length === 4 && d.unpaid[1].total === 201 && d.unpaid[1].count === 2);
  check('totalUnpaid = rounded sum of bucket totals', d.totalUnpaid === 1201);
}

console.log('\n┌─ parseInsightsResponse ───────────────────────────');
const digest: InsightsDigest = {
  weeks: [
    { week: '2026-03-30', revenue: 1000, profit: 300 },
    { week: '2026-04-06', revenue: 1500, profit: 450 },
  ],
  totalRevenue8w: 2500,
  totalProfit8w: 750,
  topServices: [{ service: 'Brake Job', revenue: 1200, profit: 400, count: 8 }],
  topSources: [{ source: 'Google', revenue: 900, count: 5 }],
  topCities: [{ city: 'Austin', profit: 350, count: 6 }],
  repeatCustomerPct: 34,
  repeatCustomers: 17,
  totalCustomers: 50,
  unpaid: [{ bucket: '60d+', count: 2, total: 1200 }],
  totalUnpaid: 1200,
};
// digest numbers: 1000 300 1500 450 2500 750 1200 400 8 900 5 350 6 34 17 50 2

check('clean JSON, both bullets grounded → ok with 2 bullets',
  (() => { const r = parseInsightsResponse(
    '{"bullets":["Total revenue was 2500.","Brake Job profit was 400."]}', digest);
    return r.ok && r.bullets.length === 2; })());
check('JSON inside markdown fences extracted',
  (() => { const r = parseInsightsResponse(
    '```json\n{"bullets":["Revenue was 2500."]}\n```', digest);
    return r.ok && r.bullets.length === 1; })());
check('non-JSON → unparseable',
  (() => { const r = parseInsightsResponse('just some text', digest);
    return !r.ok && r.error === 'unparseable'; })());
check('non-array bullets → malformed',
  (() => { const r = parseInsightsResponse('{"bullets":"nope"}', digest);
    return !r.ok && r.error === 'malformed'; })());
check('bullet citing a number absent from the digest is dropped → ungrounded',
  (() => { const r = parseInsightsResponse('{"bullets":["Revenue grew by 9999."]}', digest);
    return !r.ok && r.error === 'ungrounded'; })());
check('bullet with no number is dropped → ungrounded',
  (() => { const r = parseInsightsResponse('{"bullets":["The business is thriving."]}', digest);
    return !r.ok && r.error === 'ungrounded'; })());
check('mixed: grounded bullet kept, ungrounded bullet dropped',
  (() => { const r = parseInsightsResponse(
    '{"bullets":["Revenue was 2500.","Profit was 8888."]}', digest);
    return r.ok && r.bullets.length === 1 && r.bullets[0] === 'Revenue was 2500.'; })());
check('every numeric token must be grounded — one bad token drops the bullet',
  (() => { const r = parseInsightsResponse('{"bullets":["2500 revenue from 7 jobs."]}', digest);
    return !r.ok && r.error === 'ungrounded'; })());
check('exact-duplicate bullets de-duplicated',
  (() => { const r = parseInsightsResponse(
    '{"bullets":["Revenue was 2500.","Revenue was 2500."]}', digest);
    return r.ok && r.bullets.length === 1; })());
check('survivors capped at 6',
  (() => { const r = parseInsightsResponse(JSON.stringify({ bullets: [
    'Value 2500.', 'Value 750.', 'Value 1200.', 'Value 400.',
    'Value 900.', 'Value 350.', 'Value 1000.', 'Value 1500.',
  ] }), digest);
    return r.ok && r.bullets.length === 6; })());
check('comma-formatted number normalised and matched',
  (() => { const r = parseInsightsResponse('{"bullets":["Revenue was 2,500 dollars."]}', digest);
    return r.ok && r.bullets.length === 1; })());

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/aiInsights.test.ts`
Expected: FAIL — module `@/lib/aiInsights` does not exist yet.

- [ ] **Step 3: Write `src/lib/aiInsights.ts`**

```ts
// src/lib/aiInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  AI Insights — pure helpers (roadmap feature #14).
//
//  buildInsightsInput()    — trims the computeInsights() result into a
//                            compact, rounded, PII-free digest.
//  parseInsightsResponse() — parses Claude's reply and enforces the
//                            numeric grounding guard: a bullet
//                            survives only if every number it cites
//                            is a real digest figure.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-insights-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Insights } from '@/lib/insights';

export interface InsightsDigest {
  weeks: Array<{ week: string; revenue: number; profit: number }>;
  totalRevenue8w: number;
  totalProfit8w: number;
  topServices: Array<{ service: string; revenue: number; profit: number; count: number }>;
  topSources: Array<{ source: string; revenue: number; count: number }>;
  topCities: Array<{ city: string; profit: number; count: number }>;
  repeatCustomerPct: number;
  repeatCustomers: number;
  totalCustomers: number;
  unpaid: Array<{ bucket: string; count: number; total: number }>;
  totalUnpaid: number;
}

export type InsightsResult =
  | { ok: true; bullets: string[] }
  | { ok: false; error: string };

const TOP_N = 5;
const MAX_BULLETS = 6;
const r = Math.round;

export function buildInsightsInput(insights: Insights): InsightsDigest {
  return {
    weeks: insights.revenueTrend.map((w) => ({
      week: w.weekStart, revenue: r(w.revenue), profit: r(w.profit),
    })),
    totalRevenue8w: r(insights.revenueTrend.reduce((s, w) => s + w.revenue, 0)),
    totalProfit8w: r(insights.revenueTrend.reduce((s, w) => s + w.profit, 0)),
    topServices: insights.topServices.slice(0, TOP_N).map((s) => ({
      service: s.service, revenue: r(s.revenue), profit: r(s.profit), count: s.count,
    })),
    topSources: insights.topSources.slice(0, TOP_N).map((s) => ({
      source: s.source, revenue: r(s.revenue), count: s.count,
    })),
    topCities: insights.topCities.slice(0, TOP_N).map((c) => ({
      city: c.city, profit: r(c.profit), count: c.count,
    })),
    repeatCustomerPct: insights.repeat.pct,
    repeatCustomers: insights.repeat.repeat,
    totalCustomers: insights.repeat.total,
    unpaid: insights.unpaidAging.map((a) => ({
      bucket: a.bucket, count: a.count, total: r(a.total),
    })),
    totalUnpaid: r(insights.unpaidAging.reduce((s, a) => s + a.total, 0)),
  };
}

// Every numeric value in the digest — the only numbers a grounded
// bullet is allowed to cite.
function digestNumbers(d: InsightsDigest): Set<number> {
  const set = new Set<number>();
  const add = (n: number): void => { if (Number.isFinite(n)) set.add(n); };
  for (const w of d.weeks) { add(w.revenue); add(w.profit); }
  add(d.totalRevenue8w); add(d.totalProfit8w);
  for (const s of d.topServices) { add(s.revenue); add(s.profit); add(s.count); }
  for (const s of d.topSources) { add(s.revenue); add(s.count); }
  for (const c of d.topCities) { add(c.profit); add(c.count); }
  add(d.repeatCustomerPct); add(d.repeatCustomers); add(d.totalCustomers);
  for (const u of d.unpaid) { add(u.count); add(u.total); }
  add(d.totalUnpaid);
  return set;
}

export function parseInsightsResponse(text: string, digest: InsightsDigest): InsightsResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const raw = (obj as { bullets?: unknown }).bullets;
  if (!Array.isArray(raw)) return { ok: false, error: 'malformed' };

  const numbers = digestNumbers(digest);
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const bullet = item.trim();
    if (!bullet || seen.has(bullet)) continue;
    // Grounding guard — keep the bullet only if it makes a numeric
    // claim AND every number it cites is a real digest figure.
    const tokens = bullet.match(/\d[\d,]*(?:\.\d+)?/g);
    if (!tokens) continue;
    const grounded = tokens.every((t) => numbers.has(parseFloat(t.replace(/,/g, ''))));
    if (!grounded) continue;
    seen.add(bullet);
    bullets.push(bullet);
    if (bullets.length >= MAX_BULLETS) break;
  }
  if (!bullets.length) return { ok: false, error: 'ungrounded' };
  return { ok: true, bullets };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/aiInsights.test.ts`
Expected: PASS — `20 passed, 0 failed`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/lib/aiInsights.ts tests/aiInsights.test.ts
git commit -m "feat(ai): aiInsights pure module — digest + grounded response parsing"
```

---

## Task 2: `insights` task in the AI proxy

**Files:**
- Modify: `ai-proxy/worker.js` (the `TASKS` map — currently `ping` and `pricing`)

- [ ] **Step 1: Add the `insights` task**

In `ai-proxy/worker.js`, inside the `TASKS` object, add a third entry after `pricing` (keep `ping` and `pricing` untouched):

```js
  // AI Insights (roadmap #14). Turns a digest of computeInsights()
  // metrics into a short plain-English owner briefing. The client
  // (src/lib/aiInsights.ts) builds `input` and enforces a numeric
  // grounding guard on the reply; this handler owns the prompt.
  insights: (input) => {
    if (!input || typeof input !== 'object') {
      throw new Error('insights: input must be an object');
    }
    return {
      system:
        'You are writing a brief business summary for the owner of a ' +
        'mobile service business, from the metrics digest provided. ' +
        'Write 3 to 5 short bullet points — a fast owner briefing, not ' +
        'a chatbot reply. Cover the revenue trend, what is performing ' +
        'well, and the single most important risk (for example, the ' +
        'oldest unpaid invoices). Rules: (1) Use ONLY numbers that ' +
        'appear in the digest — never compute new figures such as ' +
        'percentages, sums, or growth deltas not already in the ' +
        'digest. (2) Write any incidental quantity as a word (the top ' +
        'three services, over eight weeks); refer to the unpaid-aging ' +
        'buckets by description (the oldest unpaid invoices), never by ' +
        'day numbers; use digits ONLY for actual digest figures. ' +
        '(3) Do NOT give prescriptive advice; describe and flag, do ' +
        'not instruct. (4) Omit any observation you cannot tie to a ' +
        'digest number. Respond with ONLY raw JSON, no markdown, as: ' +
        '{"bullets": ["<sentence>", "<sentence>"]}.',
      user: JSON.stringify(input),
      maxTokens: 400,
    };
  },
```

- [ ] **Step 2: Deploy the Worker**

The operator's Cloudflare account is already authorized (a prior `wrangler login`).

Run: `cd ai-proxy && npx wrangler deploy`
Expected: `Deployed mobileserviceos-ai-proxy` with a new `Current Version ID`.

- [ ] **Step 3: Smoke-test the deploy**

Run:
```bash
curl -s -X POST https://mobileserviceos-ai-proxy.veyareid.workers.dev \
  -H "Origin: https://app.mobileserviceos.app" \
  -H "Content-Type: application/json" \
  -d '{"task":"insights"}' -w " [%{http_code}]\n"
```
Expected: `{"error":"unauthorized"} [401]` — confirms the Worker deployed and still gates auth. (A full functional test of the `insights` task needs a Firebase token and happens via the UI in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add ai-proxy/worker.js
git commit -m "feat(ai): add insights task to the AI proxy"
```

---

## Task 3: Insights page — AI summary UI

**Files:**
- Modify: `src/pages/Insights.tsx`

- [ ] **Step 1: Update imports**

In `src/pages/Insights.tsx`:

Change the first line from `import { useMemo } from 'react';` to:
```ts
import { useMemo, useState } from 'react';
```

Add these two imports immediately after the existing `import { computeInsights } from '@/lib/insights';` line:
```ts
import { callAI, isAIConfigured } from '@/lib/aiClient';
import { buildInsightsInput, parseInsightsResponse } from '@/lib/aiInsights';
```

- [ ] **Step 2: Add digest, state, and handler**

Find the line `const ins = useMemo(` and its closing `);`. Immediately after that statement, add:

```ts
  // AI Insights — on-demand owner briefing. The digest is derived
  // once from `ins`; `hasData` gates the button so the AI is never
  // asked to summarise an empty business.
  const aiDigest = useMemo(() => buildInsightsInput(ins), [ins]);
  const hasData = aiDigest.totalRevenue8w > 0 || aiDigest.topServices.length > 0;
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiBullets, setAiBullets] = useState<string[]>([]);

  const handleAiSummary = async () => {
    setAiState('loading');
    setAiBullets([]);
    const res = await callAI('insights', aiDigest);
    if (!res.ok || !res.text) { setAiState('error'); return; }
    const parsed = parseInsightsResponse(res.text, aiDigest);
    if (!parsed.ok) { setAiState('error'); return; }
    setAiBullets(parsed.bullets);
    setAiState('done');
  };
```

- [ ] **Step 3: Render the button + summary card**

Find this block at the start of the returned JSX:

```tsx
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Insights</div>

      {/* ── Revenue trend ──────────────────────────────────────── */}
```

Insert the AI block between the title `<div>` and the Revenue-trend comment:

```tsx
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Insights</div>

      {isAIConfigured() && (
        <div className="ai-summary">
          <button
            className="ai-summary-btn press-scale"
            onClick={handleAiSummary}
            disabled={aiState === 'loading' || !hasData}
          >
            {aiState === 'loading' ? 'Summarising…' : '✨ AI summary'}
          </button>
          {aiState === 'done' && aiBullets.length > 0 && (
            <div className="ai-summary-card card-anim">
              <div className="ai-summary-label">AI summary</div>
              <ul className="ai-summary-list">
                {aiBullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          {aiState === 'error' && (
            <div className="ai-summary-error">Couldn't generate a summary — try again.</div>
          )}
        </div>
      )}

      {/* ── Revenue trend ──────────────────────────────────────── */}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Insights.tsx
git commit -m "feat(ai): AI summary button + card on the Insights page"
```

---

## Task 4: Styles

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add the AI summary styles**

In `src/styles/app.css`, find the `.qq-ai-error { … }` rule (the last rule of the Quick Quote AI price check block, added by feature #3). Immediately after that rule's closing `}`, add:

```css

/* ── Insights — AI summary ── */
.ai-summary { margin-bottom: 14px; }
.ai-summary-btn {
  width: 100%;
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--t1);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.ai-summary-btn:disabled { opacity: .6; cursor: default; }
.ai-summary-card {
  margin-top: 8px;
  background: var(--brand-primary-dim);
  border: 1px solid var(--brand-primary);
  border-radius: 12px;
  padding: 12px 14px;
}
.ai-summary-label {
  font-size: 10px; font-weight: 800; letter-spacing: 1px;
  text-transform: uppercase; color: var(--brand-primary); margin-bottom: 6px;
}
.ai-summary-list { margin: 0; padding-left: 18px; }
.ai-summary-list li {
  font-size: 13px; color: var(--t1); line-height: 1.5; margin-bottom: 4px;
}
.ai-summary-error {
  margin-top: 8px; font-size: 12px; color: var(--red); text-align: center;
}
```

(`--s2`, `--border`, `--t1`, `--red`, `--brand-primary`, `--brand-primary-dim` are all defined in the `:root` block at the top of the file.)

- [ ] **Step 2: Commit**

```bash
git add src/styles/app.css
git commit -m "feat(ai): style the Insights AI summary"
```

---

## Task 5: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `aiInsights` (`20 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed` (no component tests added by this feature).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

Run `npm run dev` (or use the deployed app), open the Insights page:
- The `✨ AI summary` button appears below the "Insights" title.
- With real job data, tapping it shows "Summarising…", then a card of 3-5 bullet points, each citing real numbers from the page's charts.
- On a brand-new business with no jobs, the button is disabled.
- Force an error (e.g. stop the network) → the inline "Couldn't generate a summary" message shows; the charts still render.

If `VITE_AI_PROXY_URL` is unset in the dev env, the button is correctly hidden — set it in `.env.local` to test locally, or test on the deployed app.

- [ ] **Step 5: Commit any verification fixes, then push**

```bash
git push
```

---

## Notes

- **Out of scope** (per spec): auto-firing on page load, conversational Q&A, prescriptive advice, caching summaries. Do not add these.
- The grounding guard guarantees every number shown is a real digest figure; it does not semantically verify the prose. That is intentional — see the spec's "Guard scope" note.
- Each task is independently committable and leaves the build green.
