# Inventory AI Insights — Design

> **Phase 4** of the inventory upgrade. Final phase. Adds an
> on-demand AI owner briefing to the tire-vertical Inventory page,
> grounded strictly in the inventory + jobs data. Mirrors the AI
> Insights (#14) pattern almost exactly — same proxy contract
> shape, same numeric grounding guard, same chip-style affordance.

## Goal

The owner taps an **✨ AI inventory insight** button on the
Inventory page. Claude reads a compact digest (totals, health
counts, top sellers in the last 30 days, slow movers, reserved
sizes — all aggregates, no raw rows) and writes 3-5 bullet points
flagging what to restock, what to clear out, and the single
biggest risk. Every number Claude prints must appear in the
digest or the bullet is dropped.

## Hard constraints

- **Owner / admin only.** The button hides for technicians.
- **On-demand only** — no auto-firing.
- **Haiku only · `maxTokens: 400` · concise system prompt · no
  conversation memory · no chained calls.**
- **No raw inventory rows** ever leave the device — only aggregates
  (counts, top-N by size).
- **No customer PII.** Inventory has none anyway; this is belt-and-
  suspenders.
- **Numeric grounding guard.** A bullet survives only if every
  numeric token in its text matches a value in the digest. Drops
  silently otherwise. Same algorithm as `parseInsightsResponse` in
  `src/lib/aiInsights.ts`.

## Architecture

Three units — identical shape to AI Insights:

1. **Proxy task** (`ai-proxy/worker.js`) — new `inventory_insights`
   entry in `TASKS`. Owns the prompt.
2. **`src/lib/aiInventoryInsights.ts`** (new, pure) —
   `buildInventoryInsightsInput()` trims the inventory + jobs into
   the digest; `parseInventoryInsightsResponse()` parses + applies
   the grounding guard.
3. **Inventory page UI** — `✨ AI inventory insight` button +
   result card on the tire view, owner/admin only.

`callAI` is the existing transport.

## Digest shape

```ts
interface InventoryInsightsDigest {
  totalSKUs: number;
  totalQty: number;
  totalValue: number;                                   // sum qty*cost, rounded
  criticalCount: number;
  lowCount: number;
  healthyCount: number;
  deadCount: number;
  topSelling: Array<{ size: string; count: number }>;   // top 5 by job count, last 30 days
  slowMovers: Array<{ size: string; qty: number; daysSinceLastJob: number | null }>;
                                                        // up to 5 items, qty > 1, no jobs in last 84 days
  topReserved: Array<{ size: string; reserved: number; available: number }>;
                                                        // top 3 sizes with reservedQty > 0
}
```

Every number rounded to a whole integer — same rounding strategy as
AI Insights, which keeps the grounding guard's number-match exact
rather than approximate.

`size` strings are kept as user-typed (e.g. `"225/65R17"`); they
are not flattened into the number set, so a bullet referencing a
size string is allowed unless it cites a numeric value not in the
digest.

## Proxy task contract

`TASKS.inventory_insights(input)` returns `{ system, user, maxTokens }`.

- *System:* "You are writing a brief inventory briefing for the
  owner of a mobile tire / roadside service business, from the
  digest provided. Write 3 to 5 short bullet points covering: what
  to restock (use criticalCount / lowCount and the topSelling
  list), what to clear out (use slowMovers), and the single
  biggest risk (consider deadCount, reservedQty pressure). Rules:
  (1) Use ONLY numbers that appear in the digest — never compute
  new figures such as percentages, sums, or growth deltas not
  already in the digest. (2) Refer to a tire size by its exact
  string from the digest (e.g. '225/65R17') — that string is
  allowed. (3) Write any incidental quantity as a word (the top
  three sizes, over thirty days); use digits ONLY for actual
  digest figures. (4) Do NOT give prescriptive advice; describe and
  flag, do not instruct. (5) Omit any observation you cannot tie
  to a digest number. Respond with ONLY raw JSON, no markdown, as:
  `{\"bullets\": [\"<sentence>\", \"<sentence>\"]}`."
- *User:* `JSON.stringify(input)`.
- *maxTokens:* 400.

## `src/lib/aiInventoryInsights.ts`

```ts
buildInventoryInsightsInput(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
): InventoryInsightsDigest
```

Construction:
- `totalSKUs` = items length.
- `totalQty` = `sum(item.qty)`, rounded.
- `totalValue` = `sum(item.qty * item.cost)`, rounded.
- Health counts come from `inventoryHealthCounts(items, jobs, today)`
  (Phase 2 helper).
- `topSelling`: tally jobs in the last 30 days by
  `normalizeTireSize(j.tireSize)`, pick top 5 by count. Each entry's
  `size` is the un-normalized form taken from the FIRST matching
  inventory item (so the digest reads in the operator's voice). If
  no matching inventory item, fall back to `j.tireSize`.
- `slowMovers`: items with `qty > 1` AND no matching-size job in
  last 84 days. Sorted by `daysSinceLastJob` desc (deadest first).
  Capped at 5. `daysSinceLastJob` is `null` when no job ever
  matched (true "no data").
- `topReserved`: items with `reservedQty > 0`, sorted by `reserved`
  desc, capped at 3. Includes `available = availableQty(item)`.

```ts
parseInventoryInsightsResponse(
  text: string,
  digest: InventoryInsightsDigest,
): { ok: true; bullets: string[] } | { ok: false; error: string }
```

Identical structure to `parseInsightsResponse`:

1. Extract first `{ … }` JSON block.
2. Require `bullets` to be an array.
3. Build the digest's flat number set. Every numeric value in the
   digest contributes. Tire-size strings are NOT contributors
   directly (they're strings), but their CONSTITUENT NUMBERS are
   added (e.g. `"225/65R17"` contributes 225, 65, 17) so a bullet
   citing the size by parsing reads valid. (See implementation
   note below.)
4. Per bullet: trim; require ≥1 numeric token; require every
   numeric token to be in the digest number set. De-duplicate.
   Cap at 6.
5. Zero survivors → `{ ok: false, error: 'ungrounded' }`.

**Implementation note** on the size-number contribution: a tire
size like `225/65R17` contains numbers an LLM will naturally write
when referring to it. Adding the size's component digits to the
allowed set means a bullet "The 225/65R17 size sold 4 times this
month" is grounded (225, 65, 17 from the size string; 4 from the
topSelling count). This is the right reading of "grounded strictly
in the digest" — the sizes ARE in the digest.

## UI

A new affordance at the top of the tire Inventory page (below the
KPI row, above the health chip row), gated on
`role === 'owner' || role === 'admin'` AND `isAIConfigured()`:

- **Button** `✨ AI inventory insight` — gold-bordered, full width.
  Disabled when totalSKUs is 0 (no point asking).
- While loading: label switches to **Thinking…**; button disabled.
- On done: a card opens beneath the button with the bullet list,
  styled like AI Insights' `.ai-summary-card`. Reuse those classes.
- On error: an inline `.voice-error`-style line below the button.
  (Reuse the `.ai-summary-error` class.)
- Re-tapping re-runs.

The button is hidden for technician role and when `isAIConfigured()`
is false.

## Files

- Modify `ai-proxy/worker.js` — add the `inventory_insights` task.
- Create `src/lib/aiInventoryInsights.ts` — types, `buildInventoryInsightsInput`,
  `parseInventoryInsightsResponse`.
- Create `tests/aiInventoryInsights.test.ts` — logic tests.
- Modify `src/pages/Inventory.tsx` — `TireInventoryView`: new button
  + lazy-imported (`React.lazy`) bullets card, hooked into the
  existing `jobs` and `useMembership().role` already available
  after Phase 2.
- Modify `src/styles/app.css` — reuse the AI Insights `.ai-summary-*`
  classes; only one small wrapper class added (e.g.
  `.inv-ai-insight`).

## Edge cases

- **Empty inventory** — button disabled, no call.
- **No jobs in the last 30 days** — `topSelling` is empty. Claude
  is told to lean on health counts; bullets survive grounding.
- **All `dead` everywhere** — `slowMovers` populated, `topSelling`
  empty. Claude warns and surfaces the slow movers.
- **Role flips mid-session** — `useMembership()` re-renders;
  button visibility follows immediately.
- **`callAI` unavailable** — button hidden (`isAIConfigured()` is
  false).

## Testing

`tests/aiInventoryInsights.test.ts`:

- `buildInventoryInsightsInput` — totals correct; health counts
  delegated; `topSelling` capped at 5 + sorted by job count;
  `slowMovers` excludes items with recent jobs; `topReserved`
  excludes items with `reservedQty === 0` and is capped at 3.
- `parseInventoryInsightsResponse` —
  - clean JSON with grounded numbers → kept;
  - fenced JSON extracted;
  - non-JSON → `unparseable`;
  - non-object `bullets` → `malformed`;
  - bullet citing the digest's `totalQty` → kept;
  - bullet citing a number NOT in the digest → dropped → `ungrounded`
    when it's the only one;
  - bullet citing a tire size like `225/65R17` (where 225, 65, 17
    ARE digits derived from the size string) → kept;
  - bullet with no number → dropped;
  - dedup + cap at 6.

UI is verified manually.

## Out of scope (none — Phase 4 is the last inventory phase)

This concludes the four-phase inventory upgrade. Items not built:

- **Swipe gestures** — explicitly deferred in Phase 3's spec.
- **Auto-release of reservations on job cancel** — deferred (Phase
  3 sub-feature, would require job-lifecycle integration).
- **Per-supplier analytics** — possibly future work.
- **Virtualized list** — deferred until real perf signal.

Any of these can become its own brainstorm → spec → plan → ship
cycle if needed.
