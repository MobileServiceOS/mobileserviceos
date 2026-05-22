# AI Insights — Design

> Roadmap feature #14 (AI Insights). Depends on the AI proxy
> (`docs/superpowers/specs/2026-05-22-ai-proxy-design.md`), deployed
> and verified.

## Goal

Add an on-demand AI summary to the Insights page: a fast, plain-English
owner briefing — 3-5 bullet points — generated from the metrics the
page already computes. It reads like a quick briefing, not a chatbot.

## Background

The Insights page (`src/pages/Insights.tsx`) renders deterministic
analytics from `computeInsights()` (`src/lib/insights.ts`): an 8-week
revenue trend, top services / lead sources / cities, repeat-customer
rate, and unpaid-invoice aging. The page is owner/admin only.

`computeInsights()` already returns a clean **aggregate** — counts,
sums, ranked stats. It holds no customer PII (customer identity
appears only as the `repeat` count). That makes it an ideal,
PII-free, token-light digest with no extra work.

AI Insights layers a natural-language synthesis over those numbers:
what the trend is doing, what is performing, and the single biggest
risk — each statement tied to a real figure.

## Hard constraints

Owner/admin only · on-demand only · Haiku only · compact digest only ·
no raw jobs · no customer PII · no auto-firing · no conversational
Q&A · no prescriptive business advice · bullets only · grounded
strictly in the digest numbers.

## Architecture

Three units, each with one responsibility:

1. **Proxy task** (`ai-proxy/worker.js`) — a new `insights` entry in
   the `TASKS` map. Owns the prompt server-side.
2. **`src/lib/aiInsights.ts`** (new, pure) — `buildInsightsInput()`
   trims the `Insights` object into a compact digest;
   `parseInsightsResponse()` parses Claude's reply and enforces the
   grounding guard. No I/O, no React — fully testable.
3. **Insights page UI** (`src/pages/Insights.tsx`) — an
   `✨ AI summary` button and a summary card.

`callAI` (`src/lib/aiClient.ts`, existing) is the transport.

## Data flow

1. The owner opens Insights (the page is already owner/admin-only —
   the AI summary inherits that gating) and taps `✨ AI summary`.
2. `buildInsightsInput(insights)` builds an `InsightsDigest`.
3. `callAI('insights', digest)` → proxy → Claude (Haiku, `maxTokens` 400).
4. `parseInsightsResponse(result.text, digest)` parses the reply and
   drops any bullet that fails the grounding guard.
5. The surviving bullets render in a card.

## Proxy task contract

`TASKS.insights(input)` returns `{ system, user, maxTokens }`. It
validates that `input` is an object and throws otherwise (the Worker
turns a throw into `400 bad_input`).

**Input** (`InsightsDigest`, sent by the client). Every number is
rounded to a whole integer — an owner briefing needs no cents, and
integer values make the grounding guard exact.

```ts
interface InsightsDigest {
  weeks: Array<{ week: string; revenue: number; profit: number }>; // 8, oldest→newest
  totalRevenue8w: number;
  totalProfit8w: number;
  topServices: Array<{ service: string; revenue: number; profit: number; count: number }>; // top 5
  topSources: Array<{ source: string; revenue: number; count: number }>;  // top 5
  topCities: Array<{ city: string; profit: number; count: number }>;      // top 5
  repeatCustomerPct: number;
  repeatCustomers: number;
  totalCustomers: number;
  unpaid: Array<{ bucket: string; count: number; total: number }>;        // 4 buckets
  totalUnpaid: number;
}
```

The digest is an aggregate — no job rows, no customer PII, ever leave
the device.

**Prompt** (server-side, in the task handler):

- *System:* "You are writing a brief business summary for the owner
  of a mobile service business, from the metrics digest provided.
  Write 3 to 5 short bullet points — a fast owner briefing, not a
  chatbot reply. Cover the revenue trend, what is performing well,
  and the single most important risk (for example, the oldest unpaid
  invoices). Rules: (1) Use ONLY numbers that appear in the digest —
  never compute new figures such as percentages, sums, or growth
  deltas not already in the digest. (2) Write any incidental quantity
  as a word (the top three services, over eight weeks); refer to the
  unpaid-aging buckets by description (the oldest unpaid invoices),
  never by day numbers; use digits ONLY for actual digest figures.
  (3) Do NOT give prescriptive advice; describe and flag, do not
  instruct. (4) Omit any observation you cannot tie to a digest
  number. Respond with ONLY raw JSON, no markdown, as:
  `{\"bullets\": [\"<sentence>\", \"<sentence>\"]}`."

  The bucket-by-description rule keeps the grounding guard from
  rejecting an otherwise valid risk bullet over an incidental "60".
- *User:* `JSON.stringify(input)`.
- *maxTokens:* 400.

**Output:** the Worker's generic `{ ok, text }`. Parsing and the
grounding guard are the client's job.

## `src/lib/aiInsights.ts`

```ts
buildInsightsInput(insights: Insights): InsightsDigest
```

- `weeks` — `insights.revenueTrend` mapped to `{ week, revenue, profit }`,
  every number rounded.
- `totalRevenue8w` / `totalProfit8w` — the rounded sums of the trend.
- `topServices` / `topSources` / `topCities` — the first 5 of each,
  numbers rounded.
- `repeatCustomerPct` / `repeatCustomers` / `totalCustomers` — from
  `insights.repeat`.
- `unpaid` — `insights.unpaidAging` mapped to `{ bucket, count, total }`,
  rounded; `totalUnpaid` — the rounded sum of the bucket totals.

```ts
parseInsightsResponse(
  text: string,
  digest: InsightsDigest,
): { ok: true; bullets: string[] } | { ok: false; error: string }
```

1. Extract the first `{ … }` block from `text` (tolerates markdown
   fences). `JSON.parse` it. On failure → `{ ok: false, error: 'unparseable' }`.
2. Require `bullets` to be an array → else `{ ok: false, error: 'malformed' }`.
3. **Grounding guard.** Flatten every numeric value in `digest` into a
   `Set<number>` (the "digest numbers"). For each raw bullet, keep it
   only when ALL of the following hold; otherwise **drop it**:
   - it is a non-empty string after trimming;
   - it contains at least one numeric token (regex `/\d[\d,]*(?:\.\d+)?/g`,
     each token normalised by removing commas, then `parseFloat`);
   - **every** numeric token in it equals a value in the digest
     numbers set.
   This makes the guard concrete: a surviving bullet provably cites
   only real digest figures, and a bullet with no number (a vague
   platitude) or a fabricated number is omitted.
4. Trim survivors, drop exact duplicates, cap at **6**.
5. If at least one bullet survives → `{ ok: true, bullets }`. If none
   do → `{ ok: false, error: 'ungrounded' }`.

**Guard scope (honest boundary).** The guard guarantees every number
shown to the owner is a real digest figure and that every bullet
makes a numeric claim. It does not parse the surrounding prose for
semantic correctness — that is handled by the small, fully-grounded
digest (Claude has only real numbers to work with) plus the prompt's
explicit "digest numbers only / omit if ungrounded" instruction.
Rounding the digest to integers and forbidding computed figures is
what keeps the numeric-token check exact rather than approximate.

## Insights page UI

A button below the page title, above the Revenue-trend card:

- **Button** `✨ AI summary` — rendered only when `isAIConfigured()`.
  Disabled when there is no data to summarise — a cheap `hasData`
  check: `totalRevenue8w > 0` or `topServices.length > 0`. (No point
  spending a call to have the AI say "no data yet".)
- **State:** `aiState: 'idle' | 'loading' | 'done' | 'error'`,
  `aiBullets: string[]`.
- **On tap:** `aiState = 'loading'`, button label "Summarising…",
  disabled; `callAI` → `parseInsightsResponse`.
- **Summary card** (`aiState === 'done'`): the bullets as a list,
  each a short line, with a small "AI summary" label.
- **Error** (`aiState === 'error'`): one inline line — "Couldn't
  generate a summary — try again." Non-blocking; every chart on the
  page is unaffected.

Re-tapping re-runs the summary.

## Error handling

`callAI` never throws — every failure is `{ ok: false, error }`. All
failure paths — not configured, network error, proxy non-2xx,
`llm_error`, `unparseable` / `malformed` / `ungrounded` from the
guard — collapse to the single inline error state. The deterministic
Insights charts are never blocked by an AI failure.

## Edge cases

- **New business, little data** — the `hasData` check disables the
  button, so the AI is never asked to summarise nothing.
- **Sparse data that still passes `hasData`** — the digest carries
  whatever real numbers exist; the prompt covers what it can and the
  guard drops anything ungrounded.
- **All bullets fail the guard** — surfaces as the `ungrounded`
  error; the owner can retry. Rare when the prompt is followed.
- **Roles** — the Insights page is owner/admin only; the AI summary
  needs no extra gating.
- **Cost** — one Haiku call (~400 tokens out) per tap, on demand.

## Token efficiency

The digest is small by construction — `computeInsights()` already
returns aggregates, and `buildInsightsInput` trims each ranking to
the top 5 and rounds every number. The payload is O(1) in business
size: a shop with 50 jobs and one with 50,000 send the same shape.
No raw job rows are ever transmitted.

## Testing

`tests/aiInsights.test.ts` (hand-rolled `tsx` runner, like the other
`tests/*.test.ts`):

- `buildInsightsInput` — `weeks` mapped and rounded; `totalRevenue8w`
  / `totalProfit8w` summed correctly; each ranking capped at 5;
  `repeat` fields and `unpaid` buckets carried; `totalUnpaid` summed.
- `parseInsightsResponse` — clean JSON parsed; JSON inside markdown
  fences extracted; non-JSON → `unparseable`; non-array `bullets` →
  `malformed`; a bullet whose numbers are all in the digest is kept;
  a bullet citing a number absent from the digest is dropped; a
  bullet with no number is dropped; when every bullet is dropped →
  `ungrounded`; survivors are de-duplicated and capped at 6.

The `insights` proxy task gets a `curl` smoke test in the plan. The
Insights page UI has no component-test harness — it is verified
manually.

## Files

- Modify `ai-proxy/worker.js` — add the `insights` task.
- Create `src/lib/aiInsights.ts` — `InsightsDigest`, `buildInsightsInput`,
  `parseInsightsResponse`.
- Modify `src/pages/Insights.tsx` — button, state, summary card.
- Modify `src/styles/app.css` — button + card styles.
- Create `tests/aiInsights.test.ts` — logic tests.

## Out of scope (YAGNI)

- Auto-firing the summary on page load — on-demand only.
- Conversational / follow-up Q&A — a one-shot briefing only.
- Prescriptive advice — the AI describes and flags, never instructs.
- Caching / persisting summaries — each tap is a fresh call.
