# Inventory AI Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On-demand owner briefing on the tire-vertical Inventory page — 3-5 grounded bullets generated from a compact aggregate digest of inventory + jobs. Owner / admin only. Mirrors AI Insights (#14).

**Architecture:** A pure `src/lib/aiInventoryInsights.ts` builds the digest from inventory + jobs (re-uses `inventoryHealthCounts` from Phase 2, `availableQty`/`reservedQty` from Phase 3) and parses Claude's reply through the same numeric grounding guard as `parseInsightsResponse`. A new `inventory_insights` proxy task owns the prompt. The Inventory tire view adds an `✨ AI inventory insight` button + bullet card, owner/admin only.

**Tech Stack:** TypeScript, React 18; Cloudflare Worker (`ai-proxy/`); hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-inventory-ai-insights-design.md`

---

## File Structure

- **Create `src/lib/aiInventoryInsights.ts`** — types + `buildInventoryInsightsInput()` + `parseInventoryInsightsResponse()`. Pure.
- **Create `tests/aiInventoryInsights.test.ts`** — logic tests.
- **Modify `ai-proxy/worker.js`** — add the `inventory_insights` entry to the `TASKS` map.
- **Modify `src/pages/Inventory.tsx`** — `TireInventoryView`: new button + bullet card, owner/admin only.
- **Modify `src/styles/app.css`** — small wrapper `.inv-ai-insight`. Re-use the existing `.ai-summary-*` classes from AI Insights for the bullet card body.

Notes for the engineer:
- `callAI`/`isAIConfigured` from `@/lib/aiClient`. `useMembership` is already imported in `Inventory.tsx`.
- `inventoryHealthCounts` from `@/lib/inventoryHealth`.
- `availableQty`, `reservedQty` from `@/lib/inventoryReservations`.
- `normalizeTireSize` from `@/lib/utils`.
- `TODAY()` from `@/lib/defaults`.

---

## Task 1: `src/lib/aiInventoryInsights.ts` + tests

**Files:**
- Create: `src/lib/aiInventoryInsights.ts`
- Test: `tests/aiInventoryInsights.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/aiInventoryInsights.test.ts`:

```ts
// tests/aiInventoryInsights.test.ts
// Run: npx tsx tests/aiInventoryInsights.test.ts

import {
  buildInventoryInsightsInput,
  parseInventoryInsightsResponse,
} from '@/lib/aiInventoryInsights';
import type { InventoryInsightsDigest } from '@/lib/aiInventoryInsights';
import type { InventoryItem, Job, ReservedSlot } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const TODAY = '2026-05-22';
const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 5, cost: 100, ...over,
});
const job = (over: Partial<Job>): Job => ({
  id: 'j', date: TODAY, tireSize: '225/65R17',
  ...over,
} as Job);
const slot = (over: Partial<ReservedSlot>): ReservedSlot => ({
  id: 's', qty: 1, createdAt: '2026-05-22T12:00:00.000Z', ...over,
});

console.log('\n┌─ buildInventoryInsightsInput ──────────────────────');
{
  const items: InventoryItem[] = [
    item({ id: 'a', qty: 5, cost: 100 }),                // value 500
    item({ id: 'b', qty: 0, cost: 200, size: '245/40R18' }),  // value 0
  ];
  const d = buildInventoryInsightsInput(items, [], TODAY);
  check('totalSKUs counts items', d.totalSKUs === 2);
  check('totalQty sums item qty', d.totalQty === 5);
  check('totalValue sums qty*cost rounded', d.totalValue === 500);
}
{
  const items: InventoryItem[] = [
    item({ id: 'a', qty: 0 }),  // critical
    item({ id: 'b', qty: 1 }),  // low
    item({ id: 'c', qty: 5, size: '245/40R18' }),  // dead (no jobs)
  ];
  const d = buildInventoryInsightsInput(items, [], TODAY);
  check('health counts delegated correctly',
    d.criticalCount === 1 && d.lowCount === 1 && d.deadCount === 1);
}
{
  // Six different sizes each sold once; topSelling caps at 5.
  const items: InventoryItem[] = [];
  const jobs: Job[] = [
    job({ id: 'j1', tireSize: '225/65R17' }),
    job({ id: 'j2', tireSize: '245/40R18' }),
    job({ id: 'j3', tireSize: '255/55R20' }),
    job({ id: 'j4', tireSize: '215/70R16' }),
    job({ id: 'j5', tireSize: '275/35R21' }),
    job({ id: 'j6', tireSize: '195/60R15' }),
  ];
  const d = buildInventoryInsightsInput(items, jobs, TODAY);
  check('topSelling caps at 5', d.topSelling.length === 5);
}
{
  // Same size sold three times → counted as 3.
  const items: InventoryItem[] = [];
  const jobs: Job[] = [
    job({ id: 'j1', tireSize: '225/65R17' }),
    job({ id: 'j2', tireSize: '225/65R17' }),
    job({ id: 'j3', tireSize: '225/65R17' }),
  ];
  const d = buildInventoryInsightsInput(items, jobs, TODAY);
  check('topSelling tallies repeated sizes',
    d.topSelling.length === 1 && d.topSelling[0].count === 3);
}
{
  // Slow movers: qty > 1 + no jobs in last 84d.
  const items: InventoryItem[] = [
    item({ id: 'fast', qty: 5, size: '225/65R17' }),
    item({ id: 'slow', qty: 5, size: '245/40R18' }),
  ];
  const jobs: Job[] = [
    job({ id: 'recent', date: TODAY, tireSize: '225/65R17' }),
  ];
  const d = buildInventoryInsightsInput(items, jobs, TODAY);
  check('slowMovers excludes items with recent matching jobs',
    !d.slowMovers.some((s) => s.size === '225/65R17'));
  check('slowMovers includes items with no recent jobs',
    d.slowMovers.some((s) => s.size === '245/40R18'));
}
{
  // topReserved excludes zero-reserved items, capped at 3.
  const items: InventoryItem[] = [
    item({ id: 'a', size: '1', qty: 10, reservations: [slot({ qty: 3 })] }),
    item({ id: 'b', size: '2', qty: 10, reservations: [slot({ qty: 5 })] }),
    item({ id: 'c', size: '3', qty: 10, reservations: [slot({ qty: 1 })] }),
    item({ id: 'd', size: '4', qty: 10, reservations: [slot({ qty: 2 })] }),
    item({ id: 'e', size: '5', qty: 10 }),
  ];
  const d = buildInventoryInsightsInput(items, [], TODAY);
  check('topReserved excludes zero-reserved items',
    !d.topReserved.some((r) => r.size === '5'));
  check('topReserved caps at 3', d.topReserved.length === 3);
  check('topReserved sorted by reserved desc',
    d.topReserved[0].reserved >= d.topReserved[1].reserved);
}

console.log('\n┌─ parseInventoryInsightsResponse ───────────────────');
const digest: InventoryInsightsDigest = {
  totalSKUs: 12,
  totalQty: 42,
  totalValue: 4200,
  criticalCount: 3,
  lowCount: 2,
  healthyCount: 5,
  deadCount: 2,
  topSelling: [{ size: '225/65R17', count: 4 }],
  slowMovers: [{ size: '275/35R21', qty: 6, daysSinceLastJob: 120 }],
  topReserved: [{ size: '245/40R18', reserved: 7, available: 1 }],
};
// digest numbers: 12, 42, 4200, 3, 2, 5, 4, 6, 120, 7, 1
// plus size-component digits: 225, 65, 17, 275, 35, 21, 245, 40, 18

check('clean grounded JSON kept',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Total inventory value is 4200.","The 225/65R17 sold 4 times recently."]}',
      digest);
    return r.ok && r.bullets.length === 2;
  })());
check('fenced JSON extracted',
  (() => {
    const r = parseInventoryInsightsResponse(
      '```json\n{"bullets":["Total inventory value is 4200."]}\n```',
      digest);
    return r.ok && r.bullets.length === 1;
  })());
check('non-JSON → unparseable',
  (() => {
    const r = parseInventoryInsightsResponse('not JSON', digest);
    return !r.ok && r.error === 'unparseable';
  })());
check('non-array bullets → malformed',
  (() => {
    const r = parseInventoryInsightsResponse('{"bullets":"nope"}', digest);
    return !r.ok && r.error === 'malformed';
  })());
check('bullet citing absent number → dropped → ungrounded when only',
  (() => {
    const r = parseInventoryInsightsResponse('{"bullets":["Value is 9999."]}', digest);
    return !r.ok && r.error === 'ungrounded';
  })());
check('mixed: grounded kept, ungrounded dropped',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Total qty 42.","Value soared 8888."]}', digest);
    return r.ok && r.bullets.length === 1 && r.bullets[0] === 'Total qty 42.';
  })());
check('tire size digits (225, 65, 17) accepted as grounded',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["The 225/65R17 size moves well."]}', digest);
    return r.ok && r.bullets.length === 1;
  })());
check('bullet with no number → dropped → ungrounded',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Things look good."]}', digest);
    return !r.ok && r.error === 'ungrounded';
  })());
check('exact-duplicate bullets de-duplicated',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Total qty 42.","Total qty 42."]}', digest);
    return r.ok && r.bullets.length === 1;
  })());
check('survivors capped at 6',
  (() => {
    const r = parseInventoryInsightsResponse(
      JSON.stringify({ bullets: [
        'Value 4200.', 'Total 42 units.', 'Critical 3.',
        'Low 2.', 'Healthy 5.', 'Dead 2.', 'SKUs 12.', 'Sold 4.',
      ] }),
      digest);
    return r.ok && r.bullets.length === 6;
  })());

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/aiInventoryInsights.test.ts`
Expected: FAIL — module `@/lib/aiInventoryInsights` does not exist yet.

- [ ] **Step 3: Write `src/lib/aiInventoryInsights.ts`**

```ts
// src/lib/aiInventoryInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  Inventory AI Insights — pure helpers (roadmap inventory
//  upgrade — Phase 4 / final). Mirrors aiInsights.ts: build a
//  compact aggregate digest, ground Claude's reply against the
//  digest's number set.
//
//  Owner/admin only at the UI layer; pure here.
//  Spec: docs/superpowers/specs/2026-05-22-inventory-ai-insights-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';
import { normalizeTireSize } from '@/lib/utils';
import { inventoryHealthCounts } from '@/lib/inventoryHealth';
import { availableQty, reservedQty } from '@/lib/inventoryReservations';

export interface InventoryInsightsDigest {
  totalSKUs: number;
  totalQty: number;
  totalValue: number;
  criticalCount: number;
  lowCount: number;
  healthyCount: number;
  deadCount: number;
  topSelling: Array<{ size: string; count: number }>;
  slowMovers: Array<{ size: string; qty: number; daysSinceLastJob: number | null }>;
  topReserved: Array<{ size: string; reserved: number; available: number }>;
}

export type InventoryInsightsResult =
  | { ok: true; bullets: string[] }
  | { ok: false; error: string };

const TOP_SELL_N = 5;
const SLOW_MOVE_N = 5;
const TOP_RESERVED_N = 3;
const TOP_SELL_WINDOW_DAYS = 30;
const SLOW_MOVE_WINDOW_DAYS = 84;
const MAX_BULLETS = 6;
const r = Math.round;

function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00Z').getTime();
  const tb = new Date(b + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

export function buildInventoryInsightsInput(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
): InventoryInsightsDigest {
  // Totals.
  let totalQty = 0;
  let totalValue = 0;
  for (const it of items) {
    const q = Number(it.qty || 0);
    const c = Number(it.cost || 0);
    if (Number.isFinite(q)) totalQty += q;
    if (Number.isFinite(q) && Number.isFinite(c)) totalValue += q * c;
  }

  // Health counts (Phase 2 helper).
  const health = inventoryHealthCounts(items, jobs, today);

  // Map of normalized size → user-facing size (first-seen).
  const labelBySize = new Map<string, string>();
  for (const it of items) {
    const n = normalizeTireSize(it.size || '');
    if (n && !labelBySize.has(n)) labelBySize.set(n, it.size);
  }

  // Top selling: jobs in the last TOP_SELL_WINDOW_DAYS, by size.
  const sellTally = new Map<string, number>();
  // Also track the latest job date per normalized size (for slow movers).
  const lastJobDateBySize = new Map<string, string>();
  for (const j of jobs) {
    const n = normalizeTireSize(j.tireSize || '');
    if (!n || !j.date) continue;
    const age = daysBetween(today, j.date);
    if (age <= TOP_SELL_WINDOW_DAYS) {
      sellTally.set(n, (sellTally.get(n) || 0) + 1);
    }
    const prev = lastJobDateBySize.get(n);
    if (!prev || j.date > prev) lastJobDateBySize.set(n, j.date);
    if (!labelBySize.has(n)) labelBySize.set(n, j.tireSize);
  }
  const topSelling = Array.from(sellTally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SELL_N)
    .map(([n, count]) => ({ size: labelBySize.get(n) || n, count }));

  // Slow movers: qty > 1, no matching job within SLOW_MOVE_WINDOW_DAYS.
  const slowCandidates: Array<{ size: string; qty: number; daysSinceLastJob: number | null }> = [];
  for (const it of items) {
    const q = Number(it.qty || 0);
    if (q <= 1) continue;
    const n = normalizeTireSize(it.size || '');
    if (!n) continue;
    const lastDate = lastJobDateBySize.get(n);
    const days = lastDate ? daysBetween(today, lastDate) : null;
    const isSlow = days === null || days > SLOW_MOVE_WINDOW_DAYS;
    if (!isSlow) continue;
    slowCandidates.push({ size: it.size, qty: q, daysSinceLastJob: days });
  }
  slowCandidates.sort((a, b) => {
    const ad = a.daysSinceLastJob === null ? Infinity : a.daysSinceLastJob;
    const bd = b.daysSinceLastJob === null ? Infinity : b.daysSinceLastJob;
    return bd - ad;
  });
  const slowMovers = slowCandidates.slice(0, SLOW_MOVE_N);

  // Top reserved.
  const reservedCandidates: Array<{ size: string; reserved: number; available: number }> = [];
  for (const it of items) {
    const rq = reservedQty(it);
    if (rq <= 0) continue;
    reservedCandidates.push({
      size: it.size, reserved: rq, available: availableQty(it),
    });
  }
  reservedCandidates.sort((a, b) => b.reserved - a.reserved);
  const topReserved = reservedCandidates.slice(0, TOP_RESERVED_N);

  return {
    totalSKUs: items.length,
    totalQty: r(totalQty),
    totalValue: r(totalValue),
    criticalCount: health.critical,
    lowCount: health.low,
    healthyCount: health.healthy,
    deadCount: health.dead,
    topSelling,
    slowMovers,
    topReserved,
  };
}

// Flatten every numeric value in the digest into a Set<number>. Tire
// size strings contribute their CONSTITUENT digits (225/65R17 → 225,
// 65, 17) so a bullet referencing a size by its digits is grounded.
function digestNumbers(d: InventoryInsightsDigest): Set<number> {
  const set = new Set<number>();
  const add = (n: number): void => { if (Number.isFinite(n)) set.add(n); };
  add(d.totalSKUs); add(d.totalQty); add(d.totalValue);
  add(d.criticalCount); add(d.lowCount); add(d.healthyCount); add(d.deadCount);
  const addSizeDigits = (size: string): void => {
    const tokens = size.match(/\d+/g);
    if (!tokens) return;
    for (const t of tokens) add(parseInt(t, 10));
  };
  for (const s of d.topSelling) { add(s.count); addSizeDigits(s.size); }
  for (const s of d.slowMovers) {
    add(s.qty);
    if (s.daysSinceLastJob !== null) add(s.daysSinceLastJob);
    addSizeDigits(s.size);
  }
  for (const t of d.topReserved) {
    add(t.reserved); add(t.available); addSizeDigits(t.size);
  }
  return set;
}

export function parseInventoryInsightsResponse(
  text: string,
  digest: InventoryInsightsDigest,
): InventoryInsightsResult {
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

Run: `npx tsx tests/aiInventoryInsights.test.ts`
Expected: PASS — `21 passed, 0 failed`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/lib/aiInventoryInsights.ts tests/aiInventoryInsights.test.ts
git commit -m "feat(inventory): aiInventoryInsights pure module — digest + grounded parsing"
```

---

## Task 2: `inventory_insights` proxy task + deploy

**Files:**
- Modify: `ai-proxy/worker.js`

- [ ] **Step 1: Add the `inventory_insights` task**

In `ai-proxy/worker.js`, inside the `TASKS` map, immediately after the `insights` task (and before the closing `};` of the TASKS object), add:

```js
  // Inventory AI Insights (roadmap inventory Phase 4). Turns a
  // compact inventory + jobs digest into an owner briefing. The
  // client (src/lib/aiInventoryInsights.ts) builds `input` and
  // enforces a numeric grounding guard on the reply; this handler
  // owns the prompt.
  inventory_insights: (input) => {
    if (!input || typeof input !== 'object') {
      throw new Error('inventory_insights: input must be an object');
    }
    return {
      system:
        'You are writing a brief inventory briefing for the owner ' +
        'of a mobile tire / roadside service business, from the ' +
        'digest provided. Write 3 to 5 short bullet points ' +
        'covering: what to restock (use criticalCount / lowCount ' +
        'and the topSelling list), what to clear out (use ' +
        'slowMovers), and the single biggest risk (consider ' +
        'deadCount, reservedQty pressure). Rules: (1) Use ONLY ' +
        'numbers that appear in the digest — never compute new ' +
        'figures such as percentages, sums, or growth deltas not ' +
        'already in the digest. (2) Refer to a tire size by its ' +
        "exact string from the digest (e.g. '225/65R17') — that " +
        'string is allowed. (3) Write any incidental quantity as ' +
        'a word (the top three sizes, over thirty days); use ' +
        'digits ONLY for actual digest figures. (4) Do NOT give ' +
        'prescriptive advice; describe and flag, do not instruct. ' +
        '(5) Omit any observation you cannot tie to a digest ' +
        'number. Respond with ONLY raw JSON, no markdown, as: ' +
        '{"bullets": ["<sentence>", "<sentence>"]}.',
      user: JSON.stringify(input),
      maxTokens: 400,
    };
  },
```

- [ ] **Step 2: Deploy the Worker**

Run: `cd ai-proxy && npx wrangler deploy`
Expected: `Deployed mobileserviceos-ai-proxy` with a new `Current Version ID`.

- [ ] **Step 3: Smoke-test the deploy**

Run:
```bash
curl -s -X POST https://mobileserviceos-ai-proxy.veyareid.workers.dev \
  -H "Origin: https://app.mobileserviceos.app" \
  -H "Content-Type: application/json" \
  -d '{"task":"inventory_insights"}' -w " [%{http_code}]\n"
```
Expected: `{"error":"unauthorized"} [401]`.

- [ ] **Step 4: Commit**

```bash
git add ai-proxy/worker.js
git commit -m "feat(ai): add inventory_insights task to the AI proxy"
```

---

## Task 3: Inventory UI — owner/admin button + bullet card

**Files:**
- Modify: `src/pages/Inventory.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: CSS**

In `src/styles/app.css`, immediately after the `.inv-match-badge.warn` rule from Phase 3, add:

```css

/* ── Inventory AI insight — Phase 4 ──────────────────────────── */
.inv-ai-insight { margin-bottom: 12px; }
.inv-ai-insight-btn {
  width: 100%;
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--t1);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  min-height: 44px;
}
.inv-ai-insight-btn:disabled { opacity: .5; cursor: default; }
```

(The bullet card itself reuses `.ai-summary-card`, `.ai-summary-label`, `.ai-summary-list`, `.ai-summary-error` from AI Insights.)

- [ ] **Step 2: Imports in `Inventory.tsx`**

Add to the existing `@/lib`-group of imports:

```tsx
import { callAI, isAIConfigured } from '@/lib/aiClient';
import {
  buildInventoryInsightsInput, parseInventoryInsightsResponse,
} from '@/lib/aiInventoryInsights';
```

(`useMembership` is already imported; if not, add `import { useMembership } from '@/context/MembershipContext';` to the @/context group.)

- [ ] **Step 3: Add the AI insight state + handler**

Inside `TireInventoryView`, immediately **after** the `healthByItem` memo (added by Phase 2), add:

```tsx
  // Phase 4 — Inventory AI insight (owner/admin only).
  const membership = useMembership();
  const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
  const aiAvailable = isOwnerOrAdmin && isAIConfigured() && list.length > 0;
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiBullets, setAiBullets] = useState<string[]>([]);

  const handleAiInsight = async (): Promise<void> => {
    if (!aiAvailable) return;
    setAiStatus('loading');
    setAiBullets([]);
    const digest = buildInventoryInsightsInput(list, jobs, today);
    const res = await callAI('inventory_insights', digest);
    if (!res.ok || !res.text) { setAiStatus('error'); return; }
    const parsed = parseInventoryInsightsResponse(res.text, digest);
    if (!parsed.ok) { setAiStatus('error'); return; }
    setAiBullets(parsed.bullets);
    setAiStatus('done');
  };
```

(`useMembership` access is at the top of `TireInventoryView` if not already destructured there; if `membership` is undefined, ensure the `useMembership()` hook is called once inside this function.)

- [ ] **Step 4: Render the button + card**

Immediately **before** the existing health-chip row (Phase 2 — the row containing `All · Critical (N) · Low (N) · …`), render the AI block:

```tsx
      {aiAvailable && (
        <div className="inv-ai-insight">
          <button
            type="button"
            className="inv-ai-insight-btn press-scale"
            onClick={handleAiInsight}
            disabled={aiStatus === 'loading'}
          >
            {aiStatus === 'loading' ? 'Thinking…' : '✨ AI inventory insight'}
          </button>
          {aiStatus === 'done' && aiBullets.length > 0 && (
            <div className="ai-summary-card card-anim" style={{ marginTop: 8 }}>
              <div className="ai-summary-label">AI inventory insight</div>
              <ul className="ai-summary-list">
                {aiBullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          {aiStatus === 'error' && (
            <div className="ai-summary-error">Couldn't generate insight — try again.</div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Inventory.tsx src/styles/app.css
git commit -m "feat(inventory): owner/admin AI insight button + bullet card"
```

---

## Task 4: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `aiInventoryInsights` (`21 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

On the deployed app → Inventory (tire vertical):

- As **owner / admin**: the `✨ AI inventory insight` button
  appears above the health chip row. Tapping shows "Thinking…",
  then a bullet card with 3-5 grounded observations citing real
  digest numbers and tire sizes from the inventory.
- As **technician**: the button does NOT render.
- With `VITE_AI_PROXY_URL` unset locally: button does NOT render.
- Force an error (offline mid-tap): inline "Couldn't generate
  insight" appears; the inventory list is unaffected.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes

- This phase completes the four-phase inventory upgrade.
- Each task leaves the build green.
