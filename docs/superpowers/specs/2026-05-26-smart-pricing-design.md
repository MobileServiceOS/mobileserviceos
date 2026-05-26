# Smart Pricing — Design Spec

**Status:** Approved · 2026-05-26
**Author:** brainstorm session 2026-05-26
**Implements:** Audit finding "Smart Pricing — highest-ROI AI capability"

## Goal

Show the owner where their actual sale prices over the last 90 days
sit relative to their configured minimum service prices. Surface as
3–5 short bullets inside the existing Insights page, alongside the
AI Summary and Inventory AI Insights cards.

**Out of scope (deferred to v2):** mechanic + detailing verticals,
deep-link / one-tap apply, multi-window toggle, per-city segmentation,
AddJob hot-path integration, customer-level pricing, trend-over-time
analysis.

## Constraint: no parallel calculator

The user's standing rule (memory: `feedback_ai_augmentation_philosophy`)
forbids AI displaying a competing price next to `calcQuote`'s output.
Smart Pricing therefore answers a question the deterministic engine
literally cannot:

> "Is your configured pricing leaving money on the table compared to
> what customers actually paid?"

The deterministic `computeBreakdown` engine only sees the operator's
configured min/max and cost basis. It cannot see actual sale-price
distribution. Smart Pricing reads that distribution and surfaces the
gap as an observation — never as a price suggestion the user might
copy into a job.

## Architecture

```
┌──────────────────────────┐    ┌──────────────────────────┐
│ src/lib/pricingInsights  │───▶│ ai-proxy: pricing_insights│
│  buildPricingDigest      │    │  prompt + grounding rules │
│  parsePricingInsights    │◀───│  → JSON bullets           │
└──────────────────────────┘    └──────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│ src/components/insights/PricingInsightsCard.tsx          │
│   states: idle | loading | ready | error                 │
│   sessionStorage cache: msos:pricing-insights:<bid>      │
│   visibility gate: AI configured && tire && owner/admin  │
│                    && >=10 completed jobs in window      │
└──────────────────────────────────────────────────────────┘
```

Mirrors the established `aiInventoryInsights.ts` + `<InventoryInsightsCard />`
pattern. The digest is built from `jobs` already loaded into browser
memory — no new Firestore queries, no raw row data leaves the device.

## Digest shape

```ts
interface PricingDigest {
  vertical: 'tire';                   // forward-compat for v2
  windowDays: 90;                     // fixed in v1
  totalCompletedJobs: number;         // context for the model
  currency: 'USD';
  groups: Array<{
    service: string;                  // e.g. "Tire Installation"
    size: string;                     // canonical from normalizeTireSize
    sales: number;                    // >= 3 (smaller groups filtered)
    medianRevenue: number;            // dollars, rounded
    p25Revenue: number;               // 25th percentile
    p75Revenue: number;               // 75th percentile
    configuredMin: number;            // settings.servicePricing[service].minPrice
    gapPct: number;                   // (median - min) / min * 100, rounded
  }>;
}
```

**Inclusion rules:**
- Status === 'Completed' AND in last 90 days
- `sales >= 3` per (service, normalized-size) group
- `configuredMin > 0` (groups with no baseline get a separate
  "no-configured-minimum" list rather than a gap number — v1 omits
  this list to keep scope tight; v2 may add it)

**Ordering:** sort by `gapPct * sales` descending, take top 5. Big
gap × high volume = real money; tiny gap × low volume = noise.

**Statistics:** median + IQR (p25 / p75), not mean. Mean is dragged
by outliers (one $400 premium-tire job warps the average).

## AI prompt + grounding

New task in `ai-proxy/worker.js`:

```js
pricing_insights: (input) => {
  if (!input || typeof input !== 'object') {
    throw new Error('pricing_insights: input must be an object');
  }
  return {
    system:
      'You are writing a brief pricing observations summary for the ' +
      'owner of a mobile tire / roadside service business, from the ' +
      'digest provided. Write 3 to 5 short bullet points covering ' +
      'where actual sale prices sit relative to the configured ' +
      'minimum. Rules: (1) Use ONLY numbers that appear in the digest ' +
      '— never compute new figures such as percentages, sums, or ' +
      'growth deltas not already in the digest. The gapPct field is ' +
      'precomputed and is the ONLY percentage you may state. ' +
      '(2) Refer to a tire size by its exact string from the digest ' +
      '(e.g. "225/65R17") — that string is allowed. (3) Skip any ' +
      'group where p75 divided by p25 exceeds 2.5 — the spread is ' +
      'too wide to call a trend. (You do NOT need to state this; ' +
      'just omit those groups.) (4) Write any incidental quantity as ' +
      'a word (the top three sizes, over ninety days); use digits ' +
      'ONLY for actual digest figures. (5) Do NOT give prescriptive ' +
      'advice ("you should raise your price"); describe the gap and ' +
      'let the owner decide. (6) Omit any observation you cannot tie ' +
      'to a digest number. Respond with ONLY raw JSON, no markdown, ' +
      'as: {"bullets": ["<sentence>", "<sentence>"]}.',
    user: JSON.stringify(input),
    maxTokens: 400,
  };
},
```

**Client-side grounding guard** in `parsePricingInsights(text)`:
1. JSON-extract `{ bullets: string[] }`; reject if shape wrong → return
   `{ bullets: [], grounded: false }`.
2. Build a set of allowed numbers: all `medianRevenue`, `p25Revenue`,
   `p75Revenue`, `configuredMin`, `gapPct`, `sales` across all groups
   plus `totalCompletedJobs` and `windowDays`.
3. For each bullet, regex-extract every numeric token. If any token
   isn't in the allowed set → drop the bullet, log via
   `captureMessage('warning', '[pricingInsights] hallucinated number',
   { token, bullet })`.
4. If all bullets are dropped → return `{ bullets: [], grounded: false }`.

## UI

`<PricingInsightsCard />` in `src/components/insights/PricingInsightsCard.tsx`
(creating the `insights/` subfolder for forward consolidation).

**Visibility gate:**
```ts
const visible =
  isAIConfigured() &&
  vertical.features.inventoryDeduction &&         // tire only
  (role === 'owner' || role === 'admin') &&       // techs hidden
  completedInWindow >= 10;                        // not enough data otherwise
```
If `!visible`, the card doesn't render at all.

**States:**

| State | Trigger | UI |
|---|---|---|
| `idle` | Default | Card header + explainer ("Compare your last 90 days of sales to your configured minimums") + "Generate" button |
| `loading` | After tap, awaiting proxy | Spinner + "Analyzing 90 days of sales…" |
| `ready` | Proxy returned + grounding passed (>=1 bullet) | `<ul>` of bullets + "Refresh" link + cache timestamp |
| `error` | 429 / network / 0 grounded bullets | `addToast(message, 'warn')`, revert to `idle` |

**Cache:** last `ready` result cached in `sessionStorage` under
`msos:pricing-insights:<businessId>` for 30 min. Purged on tab close.
A fresh visit shows `idle` and the user explicitly taps Generate.

**Styling:** uses existing `.card` + `.card-pad`. Bullets 13px, 6px
vertical gap. Visually matches the AI Summary card already on the page.

## Cost model

- Digest size: ~5 groups × ~80 chars JSON ≈ 400 chars input
- Output: ~150 tokens
- Per call: ~$0.003 at Haiku 4.5 pricing
- Already protected by the per-user rate limit shipped this morning
  (30/hr soft, 100/day hard)

## Files

| File | Action | Purpose |
|---|---|---|
| `src/lib/pricingInsights.ts` | Create | `buildPricingDigest`, `parsePricingInsights`, type exports |
| `tests/pricingInsights.test.ts` | Create | 10 logic tests |
| `ai-proxy/worker.js` | Modify | Add `pricing_insights` task to TASKS registry |
| `ai-proxy/README.md` | Modify | Document the new task |
| `src/components/insights/PricingInsightsCard.tsx` | Create | Card UI + state machine |
| `src/pages/Insights.tsx` | Modify | Render `<PricingInsightsCard />` below AI Summary |

## Testing

Pure-logic tests in `tests/pricingInsights.test.ts` (hand-rolled
`tsx check()` runner, same shape as `tests/aiInventoryInsights.test.ts`):

1. `buildPricingDigest` excludes groups with fewer than 3 sales
2. `buildPricingDigest` excludes jobs outside the 90-day window
3. `buildPricingDigest` excludes non-Completed jobs
4. `buildPricingDigest` excludes groups with `configuredMin === 0`
5. Median is correct for even and odd counts
6. p25 / p75 are correct
7. Top-5 sort respects `gapPct * sales` descending
8. `parsePricingInsights` rejects non-JSON / wrong shape
9. `parsePricingInsights` drops a bullet containing a hallucinated number
10. `parsePricingInsights` keeps bullets that quote a size string verbatim
11. All-bullets-rejected → `grounded: false`, empty bullets

No tests for the React component (no component test harness in repo).
UI states verified manually on the dev server.

**Worker smoke test:**
```bash
curl -X POST https://mobileserviceos-ai-proxy.veyareid.workers.dev \
  -H "Authorization: Bearer <fresh-firebase-id-token>" \
  -H "Origin: https://app.mobileserviceos.app" \
  -d '{"task":"pricing_insights","input":{...sample digest}}'
```
Expected: `{"ok":true,"text":"{\"bullets\":[...]}"}` within 3s.

## Deploy

1. `git push` — code + tests land on `main`
2. `cd ai-proxy && npx wrangler deploy` — worker picks up new task
3. No Firestore rule / index changes required
4. Manual: open Insights as owner with ≥10 completed tire jobs in last
   90 days, tap Generate, confirm bullets render and are grounded.

## Risk register

| Risk | Mitigation |
|---|---|
| Model hallucinates a price number | Client-side numeric grounding guard drops the bullet |
| All bullets fail grounding → empty card | Soft-fail to toast, leaves card in `idle`, user can retry |
| Owner sees bullets, raises prices, loses jobs | Inform-only (no apply button); bullets describe, don't prescribe |
| Token cost runs away | Per-user rate limit already shipped (30/hr, 100/day) |
| Insufficient data → meaningless bullets | Visibility gate requires ≥10 completed jobs in window |
| Tech sees sale-price intel | Role gate (owner/admin only), matches existing `canViewProfit` policy |

## Estimated effort

~3 hours implementation + ~1 hour test pass + ~30 min smoke testing.
Single focused session.

## Success criteria

1. Owner with ≥10 completed tire jobs in last 90d sees the card on Insights
2. Tapping Generate returns 3–5 grounded bullets within 3 seconds
3. Bullets describe the gap between configured min and actual median
4. No bullet contains a number not in the digest
5. Card is hidden for techs and for any vertical that isn't tire
6. Re-tapping within 30 minutes serves cached result (no proxy call)
