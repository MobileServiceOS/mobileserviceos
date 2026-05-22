# AI Price Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand AI price suggestion to the Dashboard's Quick Quote, grounded in a compact statistical digest of the business's own job history.

**Architecture:** A pure `src/lib/aiPricing.ts` module builds a fixed-size history digest and parses Claude's reply. A new `pricing` task in the AI-proxy Worker owns the prompt server-side. The Dashboard's Quick Quote gets a button + result card that calls the existing `callAI` transport and feeds the result into the existing Custom-price tile.

**Tech Stack:** TypeScript, React 18, Vite; Cloudflare Worker (`ai-proxy/`); hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-ai-pricing-design.md`

---

## File Structure

- **Create `src/lib/aiPricing.ts`** — pure module. Owns `PricingHistoryDigest`, `PricingInput`, `PricingResult` types; `buildPricingInput()` (assemble payload + compute digest); `parsePricingResponse()` (parse + sanity-check Claude's reply). No I/O, no React.
- **Create `tests/aiPricing.test.ts`** — logic tests, hand-rolled `check()` runner.
- **Modify `ai-proxy/worker.js`** — add the `pricing` entry to the `TASKS` map.
- **Modify `src/pages/Dashboard.tsx`** — Quick Quote button, state, result card.
- **Modify `src/styles/app.css`** — button + card styles.

Notes for the engineer:
- The Custom-price path already exists in `Dashboard.tsx`: state `qqMode` (`'suggested' | 'premium' | 'custom'`), `qqCustom` (string), setter `setQqCustom`, and `qqRevenue`. "Use this price" only needs to call `setQqCustom` + `setQqMode('custom')`.
- `callAI(task, input)` from `src/lib/aiClient.ts` returns `{ ok, text?, error? }` and never throws.
- Logic tests run via `npx tsx tests/<name>.test.ts`; `npm test` runs all of them.
- `Job.revenue` is typed `number | string` — always coerce with the `num()` helper below.

---

## Task 1: `src/lib/aiPricing.ts` — pure module + tests

**Files:**
- Create: `src/lib/aiPricing.ts`
- Test: `tests/aiPricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/aiPricing.test.ts`:

```ts
// tests/aiPricing.test.ts
// Run: npx tsx tests/aiPricing.test.ts

import { buildPricingInput, parsePricingResponse } from '@/lib/aiPricing';
import type { Job, QuoteForm, QuoteResult } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const job = (over: Partial<Job>): Job => ({
  service: 'Flat Tire Repair', revenue: 100, date: '2026-05-01',
  emergency: false, lateNight: false, highway: false, weekend: false,
  ...over,
} as Job);

const form = (over: Partial<QuoteForm>): QuoteForm => ({
  service: 'Flat Tire Repair', vehicleType: 'Car',
  emergency: false, lateNight: false, highway: false, weekend: false,
  ...over,
});

const quote: QuoteResult = {
  suggested: 120, premium: 160, directCosts: 40, targetProfit: 80,
};

console.log('\n┌─ buildPricingInput ───────────────────────────────');
{
  const input = buildPricingInput(form({ emergency: true, weekend: true }), quote, [], 'tire');
  check('conditions reflect true flags',
    JSON.stringify(input.conditions) === JSON.stringify(['emergency', 'weekend']));
  check('deterministicQuote lifted',
    input.deterministicQuote.suggested === 120
    && input.deterministicQuote.premium === 160
    && input.deterministicQuote.directCosts === 40);
  check('vertical passed through', input.vertical === 'tire');
  check('empty history → recentJobCount 0', input.history.recentJobCount === 0);
  check('empty history → null stats',
    input.history.avgPrice === null && input.history.medianPrice === null
    && input.history.minPrice === null && input.history.maxPrice === null
    && input.history.lastJobDate === null);
}
{
  const jobs: Job[] = [
    job({ service: 'Flat Tire Repair', revenue: 100, date: '2026-05-01' }),
    job({ service: 'Flat Tire Repair', revenue: 200, date: '2026-05-03' }),
    job({ service: 'Flat Tire Repair', revenue: 300, date: '2026-05-02' }),
    job({ service: 'Brake Job', revenue: 999, date: '2026-05-04' }),
  ];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('filters to matching service only', h.recentJobCount === 3);
  check('avgPrice = mean of matching', h.avgPrice === 200);
  check('medianPrice (odd count)', h.medianPrice === 200);
  check('minPrice', h.minPrice === 100);
  check('maxPrice', h.maxPrice === 300);
  check('lastJobDate = newest matching date', h.lastJobDate === '2026-05-03');
}
{
  const jobs: Job[] = [
    job({ revenue: 100 }), job({ revenue: 200 }),
    job({ revenue: 300 }), job({ revenue: 500 }),
  ];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('medianPrice (even count) = mean of middle two', h.medianPrice === 250);
}
{
  const jobs: Job[] = [
    job({ revenue: 100, emergency: true }),
    job({ revenue: 300, emergency: true }),
    job({ revenue: 999, highway: true }),
  ];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('recentEmergencyAvg over flagged jobs only', h.recentEmergencyAvg === 200);
  check('recentHighwayAvg over flagged jobs only', h.recentHighwayAvg === 999);
  check('recentLateNightAvg null when no flagged job', h.recentLateNightAvg === null);
}
{
  const jobs: Job[] = Array.from({ length: 60 }, (_, i) =>
    job({ revenue: i, date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}` }));
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('history window caps at 50 jobs', h.recentJobCount === 50);
}
{
  const jobs: Job[] = [job({ revenue: '150' as unknown as number })];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('string revenue coerced to number', h.avgPrice === 150);
}

console.log('\n┌─ parsePricingResponse ────────────────────────────');
check('clean JSON parsed',
  (() => { const r = parsePricingResponse('{"price":130,"rationale":"ok"}', quote);
    return r.ok && r.price === 130 && r.rationale === 'ok'; })());
check('JSON inside markdown fences extracted',
  (() => { const r = parsePricingResponse('```json\n{"price":130,"rationale":"ok"}\n```', quote);
    return r.ok && r.price === 130; })());
check('non-JSON → unparseable',
  (() => { const r = parsePricingResponse('the price is good', quote);
    return !r.ok && r.error === 'unparseable'; })());
check('missing price → malformed',
  (() => { const r = parsePricingResponse('{"rationale":"ok"}', quote);
    return !r.ok && r.error === 'malformed'; })());
check('non-numeric price → malformed',
  (() => { const r = parsePricingResponse('{"price":"lots","rationale":"ok"}', quote);
    return !r.ok && r.error === 'malformed'; })());
check('empty rationale → malformed',
  (() => { const r = parsePricingResponse('{"price":130,"rationale":"  "}', quote);
    return !r.ok && r.error === 'malformed'; })());
check('price above premium*3 → out_of_range',
  (() => { const r = parsePricingResponse('{"price":600,"rationale":"ok"}', quote);
    return !r.ok && r.error === 'out_of_range'; })());
check('price below directCosts → out_of_range',
  (() => { const r = parsePricingResponse('{"price":10,"rationale":"ok"}', quote);
    return !r.ok && r.error === 'out_of_range'; })());
check('price at the band edge accepted',
  (() => { const r = parsePricingResponse('{"price":40,"rationale":"ok"}', quote);
    return r.ok && r.price === 40; })());

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/aiPricing.test.ts`
Expected: FAIL — module `@/lib/aiPricing` does not exist yet.

- [ ] **Step 3: Write `src/lib/aiPricing.ts`**

```ts
// src/lib/aiPricing.ts
// ═══════════════════════════════════════════════════════════════════
//  AI Price Check — pure helpers (roadmap feature #3).
//
//  buildPricingInput()    — assembles the proxy payload, including a
//                           compact statistical digest of the
//                           business's own job history (no per-job
//                           rows, so no customer PII leaves the app).
//  parsePricingResponse() — parses + sanity-checks Claude's reply.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-pricing-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Job, QuoteForm, QuoteResult } from '@/types';

// Recency bound — the digest is computed over the most recent N
// matching-service jobs. Old prices are stale; 50 is well past the
// count needed for a stable median.
const HISTORY_WINDOW = 50;

export interface PricingHistoryDigest {
  recentJobCount: number;
  avgPrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  lastJobDate: string | null;
  recentEmergencyAvg: number | null;
  recentHighwayAvg: number | null;
  recentLateNightAvg: number | null;
}

export interface PricingInput {
  service: string;
  vehicleType: string;
  vertical: string;
  conditions: string[];
  deterministicQuote: { suggested: number; premium: number; directCosts: number };
  history: PricingHistoryDigest;
}

export type PricingResult =
  | { ok: true; price: number; rationale: string }
  | { ok: false; error: string };

function num(v: number | string): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function digest(jobs: Job[]): PricingHistoryDigest {
  const prices = jobs.map((j) => num(j.revenue));
  const condAvg = (flag: 'emergency' | 'highway' | 'lateNight'): number | null =>
    mean(jobs.filter((j) => j[flag]).map((j) => num(j.revenue)));
  return {
    recentJobCount: jobs.length,
    avgPrice: mean(prices),
    medianPrice: median(prices),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    lastJobDate: jobs.length
      ? jobs.reduce((m, j) => (j.date > m ? j.date : m), jobs[0].date)
      : null,
    recentEmergencyAvg: condAvg('emergency'),
    recentHighwayAvg: condAvg('highway'),
    recentLateNightAvg: condAvg('lateNight'),
  };
}

export function buildPricingInput(
  form: QuoteForm,
  quote: QuoteResult,
  completedJobs: Job[],
  vertical: string,
): PricingInput {
  const conditions: string[] = [];
  if (form.emergency) conditions.push('emergency');
  if (form.lateNight) conditions.push('lateNight');
  if (form.highway) conditions.push('highway');
  if (form.weekend) conditions.push('weekend');

  const matching = completedJobs
    .filter((j) => j.service === form.service)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, HISTORY_WINDOW);

  return {
    service: form.service,
    vehicleType: form.vehicleType,
    vertical,
    conditions,
    deterministicQuote: {
      suggested: quote.suggested,
      premium: quote.premium,
      directCosts: quote.directCosts,
    },
    history: digest(matching),
  };
}

export function parsePricingResponse(text: string, quote: QuoteResult): PricingResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const o = obj as { price?: unknown; rationale?: unknown };
  const price = typeof o.price === 'number' ? o.price : NaN;
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  if (!Number.isFinite(price) || price <= 0 || !rationale) {
    return { ok: false, error: 'malformed' };
  }
  // Sanity band — catches a hallucinated extra digit or a
  // loss-making price. directCosts 0 ⇒ the floor is simply "> 0".
  const floor = quote.directCosts > 0 ? quote.directCosts : 0;
  const ceil = quote.premium > 0 ? quote.premium * 3 : Infinity;
  if (price < floor || price > ceil) {
    return { ok: false, error: 'out_of_range' };
  }
  return { ok: true, price, rationale };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/aiPricing.test.ts`
Expected: PASS — `26 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiPricing.ts tests/aiPricing.test.ts
git commit -m "feat(ai): aiPricing pure module — history digest + response parsing"
```

---

## Task 2: `pricing` task in the AI proxy

**Files:**
- Modify: `ai-proxy/worker.js` (the `TASKS` map, currently `ping` only)

- [ ] **Step 1: Add the `pricing` task**

In `ai-proxy/worker.js`, inside the `TASKS` object, add a second entry after `ping` (keep `ping`):

```js
  // AI Price Check (roadmap #3). Recommends one price from the
  // deterministic quote plus a digest of the business's own history.
  // The client (src/lib/aiPricing.ts) builds `input`; this handler
  // owns the prompt. Response is parsed client-side.
  pricing: (input) => {
    if (!input || typeof input !== 'object') {
      throw new Error('pricing: input must be an object');
    }
    return {
      system:
        'You are a pricing assistant for a mobile service business ' +
        '(tire / mechanic / detailing). You are given a deterministic ' +
        "cost-plus quote and a statistical digest of the business's " +
        'own recent jobs for this service (job count, average / median ' +
        '/ min / max price, and per-condition averages). Recommend ONE ' +
        'price and a one-sentence rationale. Anchor to the deterministic ' +
        'quote and the digest — do NOT invent market rates or use ' +
        'outside pricing knowledge. Treat a null field as "no data", ' +
        'never as zero. If recentJobCount is 0 or low, lean on the ' +
        'deterministic quote and say so in the rationale. Respond with ' +
        'ONLY raw JSON, no markdown, as: ' +
        '{"price": <number>, "rationale": "<one sentence>"}.',
      user: JSON.stringify(input),
      maxTokens: 200,
    };
  },
```

- [ ] **Step 2: Deploy the Worker**

The operator's Cloudflare account is already authorized (`wrangler login` done earlier).

Run: `cd ai-proxy && npx wrangler deploy`
Expected: `Deployed mobileserviceos-ai-proxy` with a new `Current Version ID`.

- [ ] **Step 3: Smoke-test the deploy**

Run:
```bash
curl -s -X POST https://mobileserviceos-ai-proxy.veyareid.workers.dev \
  -H "Origin: https://app.mobileserviceos.app" \
  -H "Content-Type: application/json" \
  -d '{"task":"pricing"}' -w " [%{http_code}]\n"
```
Expected: `{"error":"unauthorized"} [401]` — confirms the Worker deployed and still gates auth. (A full functional test of the `pricing` task needs a Firebase token and happens via the UI in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add ai-proxy/worker.js
git commit -m "feat(ai): add pricing task to the AI proxy"
```

---

## Task 3: Quick Quote — AI price check UI

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Add imports**

In `src/pages/Dashboard.tsx`, add to the import block near the top (alongside the other `@/lib` imports):

```ts
import { callAI, isAIConfigured } from '@/lib/aiClient';
import { buildPricingInput, parsePricingResponse } from '@/lib/aiPricing';
```

- [ ] **Step 2: Add component state**

Find the line `const [qqMode, setQqMode] = useState<'suggested' | 'premium' | 'custom'>('suggested');`. Immediately after the `qqCustom` state declaration that follows it, add:

```ts
  // AI Price Check — on-demand; never blocks the deterministic tiles.
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiResult, setAiResult] = useState<{ price: number; rationale: string } | null>(null);
```

- [ ] **Step 3: Add the handler**

Find `const handleStartJob = () => {`. Immediately above it, add:

```ts
  const handleAiPriceCheck = async () => {
    setAiState('loading');
    setAiResult(null);
    const input = buildPricingInput(qqForm, quote, completedJobs, vertical.key);
    const res = await callAI('pricing', input);
    if (!res.ok || !res.text) { setAiState('error'); return; }
    const parsed = parsePricingResponse(res.text, quote);
    if (!parsed.ok) { setAiState('error'); return; }
    setAiResult({ price: parsed.price, rationale: parsed.rationale });
    setAiState('done');
  };
```

Note: `quote`, `completedJobs`, `qqForm`, and `vertical` are all already defined in this component. `vertical` is the `useActiveVertical()` result and exposes `.key`.

- [ ] **Step 4: Render the button + card**

Find this block in the Quick Quote section:

```tsx
        <div className="qq-meta">Direct cost {money(quote.directCosts)} · target profit {money(quote.targetProfit)}</div>
        <button className="cta-btn press-scale qq-cta" onClick={handleStartJob}>
```

Insert the AI block between the `qq-meta` div and the `<button>`:

```tsx
        <div className="qq-meta">Direct cost {money(quote.directCosts)} · target profit {money(quote.targetProfit)}</div>
        {isAIConfigured() && (
          <div className="qq-ai">
            <button
              className="qq-ai-btn press-scale"
              onClick={handleAiPriceCheck}
              disabled={aiState === 'loading'}
            >
              {aiState === 'loading' ? 'Checking…' : '✨ AI price check'}
            </button>
            {aiState === 'done' && aiResult && (
              <div className="qq-ai-card card-anim">
                <div className="qq-ai-price">{money(aiResult.price)}</div>
                <div className="qq-ai-rationale">{aiResult.rationale}</div>
                <button
                  className="qq-ai-use"
                  onClick={() => {
                    setQqCustom(String(aiResult.price));
                    setQqMode('custom');
                  }}
                >
                  Use this price
                </button>
              </div>
            )}
            {aiState === 'error' && (
              <div className="qq-ai-error">Couldn't get an AI price — try again.</div>
            )}
          </div>
        )}
        <button className="cta-btn press-scale qq-cta" onClick={handleStartJob}>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(ai): AI price check button + result card in Quick Quote"
```

---

## Task 4: Styles

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add the AI block styles**

In `src/styles/app.css`, immediately after the line `.qq-cta { margin-top: 12px; }`, add:

```css

/* ── Quick Quote — AI price check ── */
.qq-ai { margin-top: 10px; }
.qq-ai-btn {
  width: 100%;
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  color: var(--t1);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.qq-ai-btn:disabled { opacity: .6; cursor: default; }
.qq-ai-card {
  margin-top: 8px;
  background: var(--brand-primary-dim);
  border: 1px solid var(--brand-primary);
  border-radius: 12px;
  padding: 12px;
}
.qq-ai-price { font-size: 20px; font-weight: 800; color: var(--brand-primary); }
.qq-ai-rationale {
  font-size: 12px; color: var(--t2); margin-top: 4px; line-height: 1.4;
}
.qq-ai-use {
  margin-top: 10px;
  width: 100%;
  background: var(--brand-primary);
  border: none;
  border-radius: 8px;
  padding: 8px;
  color: #1a1a1a;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}
.qq-ai-error {
  margin-top: 8px; font-size: 12px; color: var(--red); text-align: center;
}
```

(`--s2`, `--border`, `--t1`, `--t2`, `--red`, `--brand-primary`, `--brand-primary-dim` are all defined in the `:root` block at the top of this file.)

- [ ] **Step 2: Commit**

```bash
git add src/styles/app.css
git commit -m "feat(ai): style the Quick Quote AI price check"
```

---

## Task 5: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `aiPricing`.

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

Run `npm run dev`, open the Dashboard, scroll to Quick Quote:
- The `✨ AI price check` button appears below the cost/profit line.
- Tapping it shows "Checking…", then a card with a price + one-sentence rationale.
- "Use this price" fills the Custom tile and selects it; the Start Job CTA updates to that amount.
- Force an error (e.g. temporarily stop the network) → the inline "Couldn't get an AI price" message shows and the Suggested/Premium/Custom tiles still work.

If `VITE_AI_PROXY_URL` is unset in the dev env, the button is correctly hidden — set it in `.env.local` to test locally.

- [ ] **Step 5: Commit any verification fixes, then push**

```bash
git push
```

---

## Notes

- **Out of scope** (per spec): AddJob integration, market-rate mode, caching AI results, auto-firing. Do not add these.
- **No `recentWeekendAvg`** — the digest carries three condition averages (`emergency` / `highway` / `lateNight`) per the approved spec. `weekend` is still reported in `conditions` for the current quote, just not as a historical average.
- Each task is independently committable and leaves the build green.
