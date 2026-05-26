# Smart Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-grounded pricing observations card to the Insights page that compares 90-day median sale prices against configured service-base prices, surfacing the gap as 3–5 short bullets (inform-only, no apply button).

**Architecture:** Pure helper module (`src/lib/pricingInsights.ts`) builds a per-(service, tire-size) digest from in-memory jobs, sends it to a new `pricing_insights` task on the existing Cloudflare Worker proxy, then parses + grounds the JSON reply against the digest's number set. A new `<PricingInsightsCard />` component renders four states (idle / loading / ready / error) below the existing AI Summary on the Insights page, gated on AI configuration + tire vertical + owner/admin role + ≥10 completed jobs in window. SessionStorage cache (30 min) prevents repeat token spend within a visit.

**Tech Stack:** TypeScript, React 18, Vite, Firebase Firestore (read-only, via existing snapshots), Cloudflare Workers (existing AI proxy), Anthropic Claude Haiku 4.5, `tsx`-based hand-rolled logic-test runner.

---

## Spec drift to surface up-front

The spec at [docs/superpowers/specs/2026-05-26-smart-pricing-design.md](../specs/2026-05-26-smart-pricing-design.md) refers to `settings.servicePricing[service].minPrice` as the "configured minimum." That field does **not exist** in the actual codebase ([src/types/index.ts:491-495](../../../src/types/index.ts#L491)). The real `ServicePricing` shape is:

```ts
export interface ServicePricing {
  enabled: boolean;
  basePrice: number;   // ← THIS is the floor (engine uses Math.max(sug, basePrice))
  minProfit: number;
}
```

This plan uses **`basePrice`** as the `configuredMin` source — confirmed via the flat-pricing engine at [src/config/businessTypes/pricing/flat.ts:62](../../../src/config/businessTypes/pricing/flat.ts#L62) (`sug = Math.max(sug, Number(sd.basePrice || 0))`). The semantic meaning is identical to what the spec described; only the field name differs.

## File structure

| File | Responsibility | Lines |
|---|---|---|
| `src/lib/pricingInsights.ts` (new) | Pure digest + grounding-guard helpers | ~140 |
| `tests/pricingInsights.test.ts` (new) | 11 logic tests | ~180 |
| `ai-proxy/worker.js` (modify) | Add `pricing_insights` task to `TASKS` map | +35 |
| `ai-proxy/README.md` (modify) | Document the new task | +10 |
| `src/components/insights/PricingInsightsCard.tsx` (new) | Card component + state machine + cache | ~150 |
| `src/pages/Insights.tsx` (modify) | Mount the new card below the AI Summary | +5 |

The `src/components/insights/` directory is new — created here for forward consolidation of all AI-insights cards (today's Smart Pricing, eventually a refactored AI Summary + Inventory Insights).

---

## Task 1: Pure module + tests

**Files:**
- Create: `src/lib/pricingInsights.ts`
- Create: `tests/pricingInsights.test.ts`

### Step-by-step

- [ ] **Step 1: Create `src/lib/pricingInsights.ts` with types + percentile helpers**

```ts
// src/lib/pricingInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  Smart Pricing — pure helpers.
//  Mirrors aiInventoryInsights.ts: build a compact per-(service, size)
//  digest, ground Claude's reply against the digest's number set.
//
//  Owner/admin only at the UI layer; pure here.
//  Spec: docs/superpowers/specs/2026-05-26-smart-pricing-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { normalizeTireSize } from '@/lib/utils';

export interface PricingGroup {
  service: string;
  size: string;            // user-facing tire size string (first seen)
  sales: number;
  medianRevenue: number;
  p25Revenue: number;
  p75Revenue: number;
  configuredMin: number;   // settings.servicePricing[service].basePrice
  gapPct: number;          // (median - configuredMin) / configuredMin * 100, rounded
}

export interface PricingDigest {
  vertical: 'tire';
  windowDays: 90;
  totalCompletedJobs: number;
  currency: 'USD';
  groups: PricingGroup[];
}

export type PricingInsightsResult =
  | { ok: true; bullets: string[] }
  | { ok: false; error: 'unparseable' | 'malformed' | 'ungrounded' };

const WINDOW_DAYS = 90;
const MIN_SALES_PER_GROUP = 3;
const TOP_N_GROUPS = 5;
const MAX_BULLETS = 5;
const r = Math.round;

function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00Z').getTime();
  const tb = new Date(b + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

/** Median of a sorted (ascending) array. Caller sorts. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Linear-interpolation percentile (0..1). Sorted (asc) input. */
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
```

- [ ] **Step 2: Add `buildPricingDigest` to `src/lib/pricingInsights.ts`**

Append to the file:

```ts
/**
 * Build the per-(service, normalized-size) digest from completed jobs
 * in the last 90 days. Excludes:
 *   - non-Completed jobs
 *   - jobs outside the 90-day window
 *   - groups with fewer than MIN_SALES_PER_GROUP sales
 *   - groups whose service has no configured basePrice (>0)
 *
 * Sorts groups by (gapPct * sales) descending, takes the top 5.
 */
export function buildPricingDigest(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
  today: string,
): PricingDigest {
  // Bucket by (service|normalized-size) → revenue list + user-facing label.
  const buckets = new Map<string, {
    service: string;
    sizeLabel: string;
    revenues: number[];
  }>();

  let totalCompleted = 0;
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    if (!j.date || daysBetween(today, j.date) > WINDOW_DAYS) continue;
    totalCompleted++;
    const norm = normalizeTireSize(j.tireSize || '');
    if (!norm || !j.service) continue;
    const rev = Number(j.revenue || 0);
    if (!Number.isFinite(rev) || rev <= 0) continue;
    const key = j.service + '|' + norm;
    let b = buckets.get(key);
    if (!b) {
      b = { service: j.service, sizeLabel: j.tireSize || norm, revenues: [] };
      buckets.set(key, b);
    }
    b.revenues.push(rev);
  }

  const groups: PricingGroup[] = [];
  for (const b of buckets.values()) {
    if (b.revenues.length < MIN_SALES_PER_GROUP) continue;
    const cfg = settings.servicePricing?.[b.service];
    const baseP = Number(cfg?.basePrice || 0);
    if (baseP <= 0) continue;                         // skip no-baseline groups
    const sorted = b.revenues.slice().sort((x, y) => x - y);
    const med = r(median(sorted));
    const p25 = r(percentile(sorted, 0.25));
    const p75 = r(percentile(sorted, 0.75));
    const gapPct = r(((med - baseP) / baseP) * 100);
    groups.push({
      service: b.service,
      size: b.sizeLabel,
      sales: b.revenues.length,
      medianRevenue: med,
      p25Revenue: p25,
      p75Revenue: p75,
      configuredMin: baseP,
      gapPct,
    });
  }

  // Sort by |gapPct| × sales descending — high-volume gaps in EITHER
  // direction (over- or under-priced) lead. Take top N.
  groups.sort((a, b) => Math.abs(b.gapPct) * b.sales - Math.abs(a.gapPct) * a.sales);

  return {
    vertical: 'tire',
    windowDays: WINDOW_DAYS,
    totalCompletedJobs: totalCompleted,
    currency: 'USD',
    groups: groups.slice(0, TOP_N_GROUPS),
  };
}
```

- [ ] **Step 3: Add `digestNumbers` + `parsePricingInsightsResponse` to `src/lib/pricingInsights.ts`**

Append:

```ts
/**
 * Flatten every numeric value in the digest into a Set<number>.
 * Tire size strings contribute their CONSTITUENT digits (225/65R17
 * → 225, 65, 17) so a bullet referencing a size by its digits is
 * considered grounded. Mirrors aiInventoryInsights.digestNumbers.
 */
function digestNumbers(d: PricingDigest): Set<number> {
  const set = new Set<number>();
  const add = (n: number): void => { if (Number.isFinite(n)) set.add(n); };
  add(d.totalCompletedJobs);
  add(d.windowDays);
  const addSizeDigits = (size: string): void => {
    const tokens = size.match(/\d+/g);
    if (!tokens) return;
    for (const t of tokens) add(parseInt(t, 10));
  };
  for (const g of d.groups) {
    add(g.sales);
    add(g.medianRevenue);
    add(g.p25Revenue);
    add(g.p75Revenue);
    add(g.configuredMin);
    add(g.gapPct);
    addSizeDigits(g.size);
  }
  return set;
}

/**
 * Parse the proxy reply, validate shape, and ground every numeric
 * token in each bullet against the digest. Drops ungrounded bullets;
 * returns ok:false if 0 grounded bullets remain. Mirrors
 * aiInventoryInsights.parseInventoryInsightsResponse.
 */
export function parsePricingInsightsResponse(
  text: string,
  digest: PricingDigest,
): PricingInsightsResult {
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
    const tokens = bullet.match(/\d[\d,]*(?:\.\d+)?/g);
    if (!tokens) continue;                            // a bullet with no numbers can't ground
    const grounded = tokens.every((t) => numbers.has(parseFloat(t.replace(/,/g, ''))));
    if (!grounded) continue;
    seen.add(bullet);
    bullets.push(bullet);
    if (bullets.length >= MAX_BULLETS) break;
  }
  if (!bullets.length) return { ok: false, error: 'ungrounded' };
  return { ok: true, bullets };
}

// ─── Visibility helper ─────────────────────────────────────────────
/**
 * Count completed jobs in the same 90-day window the digest uses.
 * Drives the visibility gate in PricingInsightsCard (>=10 to render).
 * Exposed here so the gate uses the SAME window as the digest itself.
 */
export function countCompletedJobsInWindow(
  jobs: ReadonlyArray<Job>,
  today: string,
): number {
  let n = 0;
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    if (!j.date || daysBetween(today, j.date) > WINDOW_DAYS) continue;
    n++;
  }
  return n;
}
```

- [ ] **Step 4: Create `tests/pricingInsights.test.ts` with the 11 cases**

```ts
// tests/pricingInsights.test.ts
// Run: npx tsx tests/pricingInsights.test.ts

import {
  buildPricingDigest,
  parsePricingInsightsResponse,
  countCompletedJobsInWindow,
} from '@/lib/pricingInsights';
import type { PricingDigest } from '@/lib/pricingInsights';
import type { Job, Settings, ServicePricing } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const TODAY = '2026-05-26';

// Job factory — only sets the fields buildPricingDigest reads.
const job = (over: Partial<Job>): Job => ({
  id: 'j',
  date: TODAY,
  status: 'Completed',
  service: 'Tire Installation',
  tireSize: '225/65R17',
  revenue: 150,
  ...over,
} as Job);

// Settings factory — supplies servicePricing entries.
const settings = (
  servicePricing: Record<string, ServicePricing> = {},
): Settings => ({
  servicePricing,
} as Settings);

const sp = (basePrice: number): ServicePricing => ({
  enabled: true, basePrice, minProfit: 0,
});

console.log('\n┌─ buildPricingDigest — filters ──────────────────');
{
  // 2 sales for one (service, size) → fewer than MIN_SALES_PER_GROUP (3)
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 160 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('groups with <3 sales are excluded', d.groups.length === 0);
}
{
  // Mix of in-window and out-of-window (>90 days old)
  const jobs = [
    job({ id: 'in1', date: TODAY, revenue: 150 }),
    job({ id: 'in2', date: TODAY, revenue: 160 }),
    job({ id: 'in3', date: TODAY, revenue: 170 }),
    job({ id: 'old', date: '2025-01-01', revenue: 999 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('jobs outside 90-day window are excluded',
    d.groups.length === 1 && d.groups[0].sales === 3);
}
{
  // Non-Completed status filtered out
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 160 }),
    job({ id: 'c', revenue: 170 }),
    job({ id: 'p', status: 'Pending', revenue: 999 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('non-Completed jobs are excluded',
    d.groups.length === 1 && d.groups[0].sales === 3);
}
{
  // Three sales but service has no servicePricing entry (basePrice === 0)
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 160 }),
    job({ id: 'c', revenue: 170 }),
  ];
  const d = buildPricingDigest(jobs, settings({}), TODAY);
  check('groups with no basePrice are excluded', d.groups.length === 0);
}

console.log('\n┌─ buildPricingDigest — statistics ───────────────');
{
  // Odd count → exact median.
  const jobs = [
    job({ id: 'a', revenue: 100 }),
    job({ id: 'b', revenue: 200 }),
    job({ id: 'c', revenue: 150 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(120) }),
    TODAY,
  );
  check('median is correct for odd count', d.groups[0].medianRevenue === 150);
}
{
  // Even count → avg of two middle values.
  const jobs = [
    job({ id: 'a', revenue: 100 }),
    job({ id: 'b', revenue: 150 }),
    job({ id: 'c', revenue: 160 }),
    job({ id: 'd', revenue: 200 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(120) }),
    TODAY,
  );
  check('median is correct for even count', d.groups[0].medianRevenue === 155);
}
{
  // p25 / p75 via linear-interp percentile.
  // 5 values evenly spaced: 100, 125, 150, 175, 200
  // p25 = sorted[1] = 125; p75 = sorted[3] = 175
  const jobs = [100, 125, 150, 175, 200].map((rev, i) =>
    job({ id: 'j' + i, revenue: rev }));
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(120) }),
    TODAY,
  );
  check('p25 and p75 are correct', d.groups[0].p25Revenue === 125 && d.groups[0].p75Revenue === 175);
}
{
  // gapPct rounding sanity: (155 - 100) / 100 * 100 = 55
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 155 }),
    job({ id: 'c', revenue: 160 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('gapPct is (median-base)/base*100 rounded', d.groups[0].gapPct === 55);
}

console.log('\n┌─ buildPricingDigest — top-N ordering ────────────');
{
  // Two services, equal sales, different gapPct → bigger |gap| sorts first
  const jobs: Job[] = [];
  // Service A: 3 sales at $150, base $100 → median 150, gap 50%
  for (let i = 0; i < 3; i++) {
    jobs.push(job({ id: 'a' + i, service: 'Installation', revenue: 150 }));
  }
  // Service B: 3 sales at $120, base $100 → median 120, gap 20%
  for (let i = 0; i < 3; i++) {
    jobs.push(job({ id: 'b' + i, service: 'Balance', revenue: 120 }));
  }
  const d = buildPricingDigest(
    jobs,
    settings({ Installation: sp(100), Balance: sp(100) }),
    TODAY,
  );
  check('top-N sorts by |gapPct| × sales desc',
    d.groups[0].service === 'Installation' && d.groups[1].service === 'Balance');
}

console.log('\n┌─ parsePricingInsightsResponse ──────────────────');
const digest: PricingDigest = {
  vertical: 'tire', windowDays: 90, totalCompletedJobs: 30, currency: 'USD',
  groups: [{
    service: 'Tire Installation', size: '225/65R17',
    sales: 6, medianRevenue: 165, p25Revenue: 155, p75Revenue: 175,
    configuredMin: 145, gapPct: 14,
  }],
};
{
  const res = parsePricingInsightsResponse('not json at all', digest);
  check('rejects non-JSON', !res.ok && res.error === 'unparseable');
}
{
  const res = parsePricingInsightsResponse('{"bullets": "not an array"}', digest);
  check('rejects wrong shape (bullets not array)',
    !res.ok && res.error === 'malformed');
}
{
  // Bullet with a number 999 NOT in the digest's number set
  const text = '{"bullets": ["Median for 225/65R17 is 999 dollars"]}';
  const res = parsePricingInsightsResponse(text, digest);
  check('drops a bullet containing a hallucinated number',
    !res.ok && res.error === 'ungrounded');
}
{
  // Two bullets — one with a hallucinated number, one fully grounded
  const text = JSON.stringify({
    bullets: [
      'Hallucinated median is 999 dollars',
      'Median for 225/65R17 sits at 165 dollars across 6 sales',
    ],
  });
  const res = parsePricingInsightsResponse(text, digest);
  check('drops the bad bullet, keeps the grounded one',
    res.ok && res.bullets.length === 1 && res.bullets[0].includes('165'));
}
{
  // Bullet quoting the size string verbatim AND a digest number
  const text = '{"bullets": ["The 225/65R17 line clusters at 165"]}';
  const res = parsePricingInsightsResponse(text, digest);
  check('keeps bullets that quote a size string verbatim',
    res.ok && res.bullets.length === 1);
}

console.log('\n┌─ countCompletedJobsInWindow ────────────────────');
{
  const jobs = [
    job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' }),
    job({ id: 'p', status: 'Pending' }),
    job({ id: 'o', date: '2025-01-01' }),
  ];
  check('counts only Completed jobs in window',
    countCompletedJobsInWindow(jobs, TODAY) === 3);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 5: Run the tests, confirm they all pass**

Run: `npx tsx tests/pricingInsights.test.ts`
Expected: `15 passed, 0 failed` (the 11 cases listed in the spec become 15 individual `check()` calls because some assert multiple invariants in one block).

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no output (exit code 0).

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricingInsights.ts tests/pricingInsights.test.ts
git commit -m "$(cat <<'EOF'
Smart Pricing: pure digest + grounding-guard helpers

Adds src/lib/pricingInsights.ts mirroring the aiInventoryInsights
pattern. buildPricingDigest groups completed jobs in the last 90
days by (service, normalized tire size), computes median + p25/p75
+ gapPct vs settings.servicePricing[service].basePrice, returns the
top 5 by |gapPct| * sales.

parsePricingInsightsResponse drops bullets that quote numbers not
in the digest's number set (size-string digits explicitly allowed).
countCompletedJobsInWindow exposes the same 90-day count the
visibility gate will need.

15 hand-rolled tsx tests cover filters, statistics, top-N ordering,
parse/grounding cases, and the window counter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Worker task + README + deploy

**Files:**
- Modify: `ai-proxy/worker.js:25-99` (`TASKS` map)
- Modify: `ai-proxy/README.md`

### Step-by-step

- [ ] **Step 1: Add the `pricing_insights` task to `ai-proxy/worker.js`**

Insert AFTER the closing `},` of `inventory_insights` (line ~98), BEFORE the closing `};` of `TASKS`:

```js
  // Smart Pricing observations (Phase B follow-up to audit). Compares
  // 90-day median sale prices to configured service basePrice and
  // surfaces the gap as 3-5 bullets. The client
  // (src/lib/pricingInsights.ts) builds `input` and grounds the reply
  // against the digest's number set; this handler owns the prompt.
  pricing_insights: (input) => {
    if (!input || typeof input !== 'object') {
      throw new Error('pricing_insights: input must be an object');
    }
    return {
      system:
        'You are writing a brief pricing observations summary for ' +
        'the owner of a mobile tire / roadside service business, ' +
        'from the digest provided. Write 3 to 5 short bullet points ' +
        'covering where actual sale prices sit relative to the ' +
        'configured minimum (configuredMin). Rules: (1) Use ONLY ' +
        'numbers that appear in the digest — never compute new ' +
        'figures such as percentages, sums, or growth deltas not ' +
        'already in the digest. The gapPct field is precomputed ' +
        'and is the ONLY percentage you may state. (2) Refer to a ' +
        "tire size by its exact string from the digest (e.g. " +
        "'225/65R17') — that string is allowed. (3) Skip any " +
        'group where p75Revenue divided by p25Revenue exceeds 2.5 ' +
        '— the spread is too wide to call a trend. (You do NOT need ' +
        'to state this; just omit those groups.) (4) Write any ' +
        'incidental quantity as a word (the top three sizes, over ' +
        'ninety days); use digits ONLY for actual digest figures. ' +
        '(5) Do NOT give prescriptive advice ("you should raise ' +
        'your price"); describe the gap and let the owner decide. ' +
        '(6) Omit any observation you cannot tie to a digest ' +
        'number. Respond with ONLY raw JSON, no markdown, as: ' +
        '{"bullets": ["<sentence>", "<sentence>"]}.',
      user: JSON.stringify(input),
      maxTokens: 400,
    };
  },
```

- [ ] **Step 2: Append a "Smart Pricing" section to `ai-proxy/README.md`**

Find the section that documents `inventory_insights` (look for "Inventory Insights" or grep for `inventory_insights` inside the README) and add this entry right after it (or at the end if no per-task section exists):

```markdown
### `pricing_insights`

Compares 90-day median sale price to configured service basePrice per
(service, tire-size) group. Returns 3–5 grounded bullets. Owner-facing
on the Insights page (tire vertical only).

**Input shape:** `PricingDigest` from `src/lib/pricingInsights.ts`.

**Output:** `{"bullets": [string]}` JSON; client grounds every numeric
token against the digest's number set.

**Cost:** ~$0.003 per call at Haiku 4.5 pricing.
```

- [ ] **Step 3: Smoke-test the new task locally with wrangler dev (optional but recommended)**

Run: `cd ai-proxy && npx wrangler dev`
In another shell, fetch a valid Firebase ID token (Settings → debug → "copy token" if you have one, or `firebase auth:export`) and:

```bash
curl -X POST http://localhost:8787 \
  -H "Authorization: Bearer <token>" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d '{"task":"pricing_insights","input":{"vertical":"tire","windowDays":90,"totalCompletedJobs":12,"currency":"USD","groups":[{"service":"Tire Installation","size":"225/65R17","sales":6,"medianRevenue":165,"p25Revenue":155,"p75Revenue":175,"configuredMin":145,"gapPct":14}]}}'
```

Expected: `{"ok":true,"text":"{\"bullets\":[...]}"}` within ~3s, bullets mention `225/65R17`, the number `165`, and the number `14`.

Stop wrangler dev with Ctrl-C when done.

- [ ] **Step 4: Deploy worker to production**

⚠️ This is a production deploy. The plan author should pause here and request explicit user authorization before running this command.

```bash
cd ai-proxy && npx wrangler deploy
```

Expected output:
```
Total Upload: ~11 KiB / gzip: ~4 KiB
Uploaded mobileserviceos-ai-proxy (~3s)
Deployed mobileserviceos-ai-proxy triggers
  https://mobileserviceos-ai-proxy.veyareid.workers.dev
Current Version ID: <hash>
```

- [ ] **Step 5: Production smoke test**

Get a fresh ID token from the live app (browser devtools → Application → IndexedDB → firebaseLocalStorageDb → fbase_key → stsTokenManager.accessToken, OR use the in-app debug if present), then:

```bash
curl -X POST https://mobileserviceos-ai-proxy.veyareid.workers.dev \
  -H "Authorization: Bearer <token>" \
  -H "Origin: https://app.mobileserviceos.app" \
  -H "Content-Type: application/json" \
  -d '{"task":"pricing_insights","input":{"vertical":"tire","windowDays":90,"totalCompletedJobs":12,"currency":"USD","groups":[{"service":"Tire Installation","size":"225/65R17","sales":6,"medianRevenue":165,"p25Revenue":155,"p75Revenue":175,"configuredMin":145,"gapPct":14}]}}'
```

Expected: same as the local smoke test. If you get `{"error":"unauthorized"}` your token has expired; refresh and retry.

- [ ] **Step 6: Commit**

```bash
git add ai-proxy/worker.js ai-proxy/README.md
git commit -m "$(cat <<'EOF'
Smart Pricing: add pricing_insights task to AI proxy

New TASKS entry that consumes a PricingDigest from the client and
returns grounded JSON bullets describing the gap between actual
90-day median sale price and configured basePrice per (service,
tire-size) group. Same prompt-engineering shape as inventory_insights
— numeric grounding rules, no prescriptive advice, JSON-only output.

README documents the new task with input/output/cost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Card component

**Files:**
- Create: `src/components/insights/PricingInsightsCard.tsx`

### Step-by-step

- [ ] **Step 1: Create the directory and the component file**

```bash
mkdir -p src/components/insights
```

Then create `src/components/insights/PricingInsightsCard.tsx`:

```tsx
// src/components/insights/PricingInsightsCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Smart Pricing — on-demand AI observations comparing 90-day actual
//  sale prices to configured service basePrice. Owner/admin only,
//  tire vertical only, hidden when there's insufficient data.
//
//  States: idle | loading | ready | error
//  Cache:  sessionStorage 'msos:pricing-insights:<bid>' (30 min)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { TODAY } from '@/lib/defaults';
import { callAI, isAIConfigured } from '@/lib/aiClient';
import {
  buildPricingDigest,
  parsePricingInsightsResponse,
  countCompletedJobsInWindow,
} from '@/lib/pricingInsights';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useMembership } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';

interface Props {
  jobs: Job[];
  settings: Settings;
  businessId: string;
}

interface CachedPayload {
  bullets: string[];
  generatedAt: number;       // epoch ms
}

const CACHE_TTL_MS = 30 * 60 * 1000;  // 30 min
const MIN_COMPLETED_JOBS = 10;
const cacheKey = (bid: string) => `msos:pricing-insights:${bid}`;

function readCache(bid: string): CachedPayload | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(bid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed || typeof parsed.generatedAt !== 'number') return null;
    if (Date.now() - parsed.generatedAt > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.bullets)) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(bid: string, bullets: string[]): void {
  try {
    const payload: CachedPayload = { bullets, generatedAt: Date.now() };
    sessionStorage.setItem(cacheKey(bid), JSON.stringify(payload));
  } catch { /* sessionStorage quota or disabled — ignore */ }
}

function formatRelative(epochMs: number): string {
  const ageMin = Math.floor((Date.now() - epochMs) / 60_000);
  if (ageMin < 1) return 'just now';
  if (ageMin === 1) return '1 min ago';
  return `${ageMin} min ago`;
}

export function PricingInsightsCard({ jobs, settings, businessId }: Props) {
  const vertical = useActiveVertical();
  const { role } = useMembership();
  const today = TODAY();
  const completedInWindow = useMemo(
    () => countCompletedJobsInWindow(jobs, today),
    [jobs, today],
  );

  const visible =
    isAIConfigured() &&
    vertical.features.inventoryDeduction &&        // tire only
    (role === 'owner' || role === 'admin') &&
    completedInWindow >= MIN_COMPLETED_JOBS;

  // Hydrate state from cache on mount so a tab-switch doesn't lose
  // the user's freshly-generated bullets.
  const cached = visible ? readCache(businessId) : null;
  const [bullets, setBullets] = useState<string[]>(cached?.bullets || []);
  const [generatedAt, setGeneratedAt] = useState<number | null>(cached?.generatedAt || null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    cached && cached.bullets.length ? 'ready' : 'idle',
  );

  // If the businessId changes (rare — switcher), reset to whatever
  // the new business's cache says.
  useEffect(() => {
    if (!visible) return;
    const fresh = readCache(businessId);
    setBullets(fresh?.bullets || []);
    setGeneratedAt(fresh?.generatedAt || null);
    setStatus(fresh && fresh.bullets.length ? 'ready' : 'idle');
  }, [businessId, visible]);

  if (!visible) return null;

  const handleGenerate = async (): Promise<void> => {
    setStatus('loading');
    const digest = buildPricingDigest(jobs, settings, today);
    if (digest.groups.length === 0) {
      // Insufficient grouped data even though completedInWindow >= 10
      // (e.g. every group has <3 sales). Fail soft to idle with a hint.
      addToast('Not enough repeat sales per size yet — try later', 'info');
      setStatus('idle');
      return;
    }
    const res = await callAI('pricing_insights', digest);
    if (!res.ok || !res.text) {
      const msg = res.error === 'rate_limited'
        ? 'AI rate limit reached — try again later'
        : 'Couldn\'t generate pricing insight — try again';
      addToast(msg, 'warn');
      setStatus('idle');
      return;
    }
    const parsed = parsePricingInsightsResponse(res.text, digest);
    if (!parsed.ok) {
      addToast('Pricing insight unavailable — try again', 'warn');
      setStatus('idle');
      return;
    }
    setBullets(parsed.bullets);
    const now = Date.now();
    setGeneratedAt(now);
    writeCache(businessId, parsed.bullets);
    setStatus('ready');
  };

  return (
    <div className="ai-summary card-anim" style={{ marginTop: 12 }}>
      <button
        className="ai-summary-btn press-scale"
        onClick={handleGenerate}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Analyzing 90 days of sales…' : '💰 Smart Pricing'}
      </button>
      {status === 'ready' && bullets.length > 0 && (
        <div className="ai-summary-card card-anim">
          <div className="ai-summary-label">
            Pricing observations
            {generatedAt && (
              <span style={{ color: 'var(--t3)', fontWeight: 400, marginLeft: 8 }}>
                · {formatRelative(generatedAt)}
              </span>
            )}
          </div>
          <ul className="ai-summary-list">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <button
            type="button"
            onClick={handleGenerate}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--brand-primary)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', padding: 0, marginTop: 6,
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add src/components/insights/PricingInsightsCard.tsx
git commit -m "$(cat <<'EOF'
Smart Pricing: PricingInsightsCard component

New component under src/components/insights/. Renders four states
(idle / loading / ready / error) with a Generate button that calls
the pricing_insights task on the AI proxy, parses + grounds the
reply via parsePricingInsightsResponse, and surfaces 3-5 bullets
under an existing .ai-summary-style card.

Visibility gate: AI configured + tire vertical (via
useActiveVertical) + owner/admin role + >=10 completed jobs in
the last 90 days. Hidden entirely otherwise.

SessionStorage cache (msos:pricing-insights:<bid>, 30 min TTL)
prevents repeat token spend within a single visit; tab-switch
preserves the last bullets without re-firing the proxy.

Error paths (network, 429, or 0 grounded bullets) toast and
return to idle — no persistent error UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire into Insights page

**Files:**
- Modify: `src/pages/Insights.tsx`

### Step-by-step

- [ ] **Step 1: Add the import**

In `src/pages/Insights.tsx`, add to the existing import block (after line 7 `import { buildInsightsInput, parseInsightsResponse } from '@/lib/aiInsights';`):

```ts
import { PricingInsightsCard } from '@/components/insights/PricingInsightsCard';
import { useBrand } from '@/context/BrandContext';
```

- [ ] **Step 2: Pull businessId from context**

Locate the `export function Insights({ jobs, settings }: Props) {` line and add immediately under it (before the `const ins = useMemo(...)` line):

```ts
  const { businessId } = useBrand();
```

- [ ] **Step 3: Render the card below the existing AI Summary**

Find the closing `</div>` of the existing `{isAIConfigured() && (...)}` block (around line 75 of the unmodified file — it's the wrap-up of the `.ai-summary` block). Immediately AFTER that closing `</div>` add:

```tsx
      <PricingInsightsCard jobs={jobs} settings={settings} businessId={businessId} />
```

The result should look like:

```tsx
      {isAIConfigured() && (
        <div className="ai-summary">
          {/* …existing AI Summary button + card…  */}
        </div>
      )}
      <PricingInsightsCard jobs={jobs} settings={settings} businessId={businessId} />

      {/* ── Daily job stats (Phase 5) ─────────────────────────── */}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (exit code 0).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: completes with `✓ built in <N>s`. Chunk-size warning on the firebase bundle is pre-existing — ignore.

- [ ] **Step 6: Manual smoke test on dev server**

Run: `npm run dev`
Open the dev URL (typically `http://localhost:5173`), sign in as an owner of a tire business that has ≥10 completed jobs in the last 90 days where at least one (service, tire-size) combo has ≥3 sales.

Navigate to Insights. The Smart Pricing card should render below the existing "✨ AI summary" block. Tap "💰 Smart Pricing":
1. Button label changes to "Analyzing 90 days of sales…"
2. Within ~3s, 3–5 bullets appear under "Pricing observations · just now"
3. A "Refresh" link is visible below the bullets
4. Tapping the page tab away and back: bullets persist (cache hit)
5. Tapping Refresh: bullets regenerate (proxy hit) — re-renders with "just now"

Stop the dev server with Ctrl-C when done.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Insights.tsx
git commit -m "$(cat <<'EOF'
Smart Pricing: render PricingInsightsCard on Insights page

Mount the new card directly below the existing AI Summary block.
businessId comes from BrandContext (needed for the sessionStorage
cache key). The card self-gates on visibility so this single line
is safe to render unconditionally — non-owner / non-tire / data-
insufficient cases render nothing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verify + push

**Files:** (none — verification only)

### Step-by-step

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Full logic-test suite**

Run: `npm test`
Expected: all suites pass. The new `pricingInsights.test.ts` should appear in the loop with `15 passed, 0 failed`. No suite reports failures.

- [ ] **Step 3: Full production build**

Run: `npm run build`
Expected: `✓ built in <N>s`. Chunks unchanged in shape; Smart Pricing adds ~3–4 KB to the Insights chunk.

- [ ] **Step 4: Verify the commits are sequential and clean**

Run: `git log --oneline -6`
Expected output should look like:
```
<hash> Smart Pricing: render PricingInsightsCard on Insights page
<hash> Smart Pricing: PricingInsightsCard component
<hash> Smart Pricing: add pricing_insights task to AI proxy
<hash> Smart Pricing: pure digest + grounding-guard helpers
<hash> spec: Smart Pricing v1 — AI pricing observations on Insights page
<hash> Phase B: composite indexes + Duplicate Job on long-press
```

- [ ] **Step 5: Push to main**

⚠️ This is a push to the default branch. Pause here and request explicit user authorization.

```bash
git push origin main
```

Expected: `<old>..<new>  main -> main`.

- [ ] **Step 6: Final post-deploy smoke (production)**

Open `https://app.mobileserviceos.app` (after GitHub Pages rebuilds — usually 1–2 min) as an owner. Navigate to Insights. Tap "💰 Smart Pricing". Confirm bullets render and reference the size + numbers from your real data, not hallucinated values.

If anything looks off (ungrounded numbers slip through, prompt produces prescriptive advice, etc.) capture the failing input + output and file as a follow-up; the prompt is a one-line edit at `ai-proxy/worker.js` and a re-deploy of the worker.

---

## Risk register (from spec)

| Risk | Mitigation in plan |
|---|---|
| Model hallucinates a price number | Task 1 step 3 — `parsePricingInsightsResponse` drops ungrounded bullets |
| All bullets fail grounding → empty card | Task 3 step 1 — `handleGenerate` toasts + returns to idle |
| Owner sees bullets, raises prices, loses jobs | Inform-only by design; no apply button in this plan |
| Token cost runs away | Already protected by the per-user rate limit shipped 2026-05-26 |
| Insufficient data → meaningless bullets | Task 3 step 1 — `MIN_COMPLETED_JOBS` gate + digest empty-groups soft-fail |
| Tech sees sale-price intel | Task 3 step 1 — `(role === 'owner' || role === 'admin')` gate |
| Spec/code drift on `minPrice` vs `basePrice` | Surfaced at the top of this plan; all code uses `basePrice` |
