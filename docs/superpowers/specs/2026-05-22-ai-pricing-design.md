# AI Price Check — Design

> Roadmap feature #3 (AI Pricing). Depends on the AI proxy
> (`docs/superpowers/specs/2026-05-22-ai-proxy-design.md`), which is
> deployed and verified.

## Goal

Give the Quick Quote a second opinion: an on-demand AI price
suggestion, grounded in the business's own recent jobs and anchored
to the deterministic `calcQuote` result. It complements the
deterministic engine — it does not replace it.

## Background

The Dashboard's Quick Quote produces three prices: **Suggested** and
**Premium** (from `calcQuote`, a cost-plus-margin engine) and
**Custom** (hand-typed). `calcQuote` is pure math — it cannot weigh
what the business has actually been charging. Jobs carry real
history (`service`, `vehicleType`, `revenue`, `date`), and the AI
proxy can now broker a Claude call. AI Price Check uses that history
as grounding so the suggestion reflects this business, not a generic
guess.

## Architecture

Four units, each with one responsibility:

1. **Proxy task** (`ai-proxy/worker.js`) — a new `pricing` entry in
   the `TASKS` map. Owns the prompt server-side; receives structured
   input, returns Claude's text.
2. **`src/lib/aiPricing.ts`** (new, pure) — `buildPricingInput()`
   assembles the proxy payload; `parsePricingResponse()` parses and
   sanity-checks Claude's reply. No I/O, no React — fully testable.
3. **`callAI`** (`src/lib/aiClient.ts`, existing) — the transport.
4. **Quick Quote UI** (`src/pages/Dashboard.tsx`) — an
   `✨ AI price check` button and a result card.

## Data flow

1. The actor fills the Quick Quote and taps `✨ AI price check`.
2. Dashboard builds the payload:
   `buildPricingInput(qqForm, quote, completedJobs, verticalKey)`.
3. `callAI('pricing', input)` → proxy → Claude (Haiku, `maxTokens` 200).
4. Dashboard parses the reply: `parsePricingResponse(result.text, quote)`.
5. On success, a card shows the price + rationale and a
   **"Use this price"** button that fills the Custom tile.

## Proxy task contract

`TASKS.pricing(input)` returns `{ system, user, maxTokens }`. It
validates that `input` is an object and throws otherwise (the Worker
turns a throw into `400 bad_input`).

**Input** (`PricingInput`, sent by the client):

```ts
interface PricingInput {
  service: string;
  vehicleType: string;
  vertical: string;            // 'tire' | 'mechanic' | 'detailing'
  conditions: string[];        // active flags, e.g. ['emergency','weekend']
  deterministicQuote: {
    suggested: number;
    premium: number;
    directCosts: number;
  };
  history: PricingHistoryDigest;
}

// A compact statistical digest of the business's own past jobs for
// this service — computed locally, so individual job rows are never
// sent. Constant size regardless of how much history exists.
// Price fields are null when recentJobCount is 0; a condition
// average is null when no job in the window carried that flag.
interface PricingHistoryDigest {
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
```

`history` is an aggregate — no per-job rows, and therefore **no
customer PII**, ever leave the device. `buildPricingInput` computes
it locally. This also makes the payload constant-size: a business
with 10 past jobs and one with 10,000 send an identically small
digest.

**Prompt** (server-side, in the task handler):

- *System:* "You are a pricing assistant for a mobile service
  business (tire / mechanic / detailing). You are given a
  deterministic cost-plus quote and a statistical digest of the
  business's own recent jobs for this service (job count, average /
  median / min / max price, and per-condition averages). Recommend
  ONE price and a one-sentence rationale. Anchor to the deterministic
  quote and the digest — do NOT invent market rates or use outside
  pricing knowledge. Treat a `null` field as 'no data', never as
  zero. If `recentJobCount` is 0 or low, lean on the deterministic
  quote and say so in the rationale. Respond with ONLY raw JSON, no
  markdown, as: `{\"price\": <number>, \"rationale\": \"<one
  sentence>\"}`."
- *User:* `JSON.stringify(input)`.
- *maxTokens:* 200.

**Output:** the Worker's generic `{ ok, text }`. The Worker is a dumb
relay — it does not parse per-task responses. Parsing is the client's
job (`parsePricingResponse`).

## `src/lib/aiPricing.ts`

```ts
buildPricingInput(
  form: QuoteForm,
  quote: QuoteResult,
  completedJobs: Job[],
  vertical: string,
): PricingInput
```

- `conditions` — the subset of `emergency`/`lateNight`/`highway`/
  `weekend` that are `true` on `form`.
- `history` — a `PricingHistoryDigest` computed locally. Take
  `completedJobs` filtered to `job.service === form.service`, sorted
  by `date` descending, windowed to the **50 most recent** (recency
  bound — old prices are stale; 50 is well past the count needed for
  a stable median). From that window:
  - `recentJobCount` — window size.
  - `avgPrice` / `medianPrice` / `minPrice` / `maxPrice` — over
    `job.revenue`; `null` when the window is empty.
  - `lastJobDate` — the newest `date`; `null` when empty.
  - `recentEmergencyAvg` / `recentHighwayAvg` / `recentLateNightAvg`
    — mean `revenue` of window jobs whose `emergency` / `highway` /
    `lateNight` flag is `true`; `null` when no window job carries
    that flag (so a sparse condition reads as no-data, not $0).
  `Job` persists `emergency` / `lateNight` / `highway` as required
  booleans, so these are always computable.
- `deterministicQuote` — `suggested` / `premium` / `directCosts` lifted
  from `quote`.

```ts
parsePricingResponse(
  text: string,
  quote: QuoteResult,
): { ok: true; price: number; rationale: string }
 | { ok: false; error: string }
```

- Extract the first `{ ... }` block from `text` (tolerates markdown
  fences or stray prose around it).
- `JSON.parse` it. On failure → `{ ok: false, error: 'unparseable' }`.
- Require `price` to be a finite positive number and `rationale` a
  non-empty string → else `{ ok: false, error: 'malformed' }`.
- **Sanity bound:** reject when `price` falls outside
  `[quote.directCosts, quote.premium * 3]` → `{ ok: false, error: 'out_of_range' }`.
  This catches a hallucinated extra digit or a loss-making price.
  (When `quote.directCosts` is 0 the floor is simply "> 0".)

## Quick Quote UI

Below the existing `qq-meta` line, before the Start Job CTA:

- **Button** `✨ AI price check` — rendered only when
  `isAIConfigured()` is true (the app works fine without AI).
- **State:** `aiState: 'idle' | 'loading' | 'done' | 'error'`,
  `aiResult: { price, rationale } | null`, `aiError: string`.
- **On tap:** `aiState = 'loading'`; button label becomes "Checking…"
  and is disabled; call `callAI` → `parsePricingResponse`.
- **Result card** (`aiState === 'done'`): `money(price)` headline, the
  rationale beneath, and a **"Use this price"** button that runs
  `setQqCustom(String(price))` + `setQqMode('custom')` so the price
  flows through the existing Custom-tile path into Start Job.
- **Error** (`aiState === 'error'`): one inline line — "Couldn't get
  an AI price — try again." Non-blocking; the Suggested / Premium /
  Custom tiles keep working regardless.

Re-tapping the button re-runs the check (e.g. after changing inputs).

## Error handling

`callAI` never throws — every failure is `{ ok: false, error }`. All
failure paths — not configured, network error, proxy non-2xx,
`llm_error`, and `parsePricingResponse` rejection — collapse to the
single inline error state. The deterministic quote is never blocked
by an AI failure.

## Edge cases

- **No history for the service** — `recentJobCount` is 0 and every
  digest price field is `null`; the prompt instructs Claude to treat
  `null` as no-data and lean on the deterministic quote.
- **Roles** — the Quick Quote is already visible to every role
  (technicians can see revenue), so AI Price Check needs no extra
  gating.
- **Cost** — one Haiku call (~200 tokens) per tap, on demand only —
  fractions of a cent. No auto-firing.

## Token efficiency

The history is sent as a fixed ~9-field digest rather than an array
of job rows. This is the design's main scaling decision:

- **Per-call input tokens:** ~40% lower. A 15-row job array is the
  bulk of the variable payload; a constant ~9-number digest replaces
  it. The history portion alone shrinks ~80% (~220 → ~45 tokens);
  the whole call's input drops roughly 440 → 270 tokens.
- **Per-call cost:** ~25% lower — less than the token cut because the
  fixed system prompt and the output tokens are unchanged. At an
  assumed Haiku 4.5 rate of ~$1 / $5 per million input / output
  tokens, that is roughly $0.00067 → $0.00050 per call.
- **Projected monthly savings:** volume-dependent. At 10,000 active
  users averaging 15 checks/month (~150k calls) the saving is on the
  order of ~$25–30/month; at ~400k calls/month, ~$70/month. Modest in
  absolute dollars (Haiku is cheap), but it scales linearly and
  leaves more headroom under the operator's Anthropic spend cap.
- **Scalability:** the payload is O(1) in history depth — a business
  with 10,000 past jobs sends the same small digest as one with 10.
- **Privacy:** aggregates leave the device, never per-job rows.

**Pricing-quality effect:** negligible, arguably neutral-to-positive.
A "recommend one price" task needs central tendency (avg / median),
spread (min / max), and a volume / recency signal — exactly what the
digest carries — and aggregates are less prone to over-anchoring on a
single outlier row than raw rows are. The one thing lost is
per-vehicle-type correlation within the history, but `calcQuote`
already prices vehicle type via its `vehiclePricing` multipliers and
sends that result as the anchor, so the AI layer does not need
vehicle-type granularity in the history.

## Testing

`tests/aiPricing.test.ts` (hand-rolled tsx runner, like the other
`tests/*.test.ts`):

- `buildPricingInput` — conditions mapped correctly; the `history`
  digest is correct: `recentJobCount` / `avg` / `median` (verify both
  even- and odd-count medians) / `min` / `max` over matching-service
  jobs, the 50-job recency window applied, condition averages taken
  only over flagged jobs, and every stat `null` when no matching
  history exists; `deterministicQuote` lifted correctly.
- `parsePricingResponse` — clean JSON parsed; JSON inside markdown
  fences extracted; non-JSON rejected as `unparseable`; missing/
  non-numeric `price` rejected as `malformed`; out-of-band price
  rejected as `out_of_range`; an in-band price accepted.

The `pricing` proxy task gets a `curl` smoke test in the
implementation plan. The Dashboard UI has no component-test harness —
it is verified manually.

## Files

- Modify `ai-proxy/worker.js` — add the `pricing` task.
- Create `src/lib/aiPricing.ts` — `PricingInput`, `buildPricingInput`,
  `parsePricingResponse`.
- Modify `src/pages/Dashboard.tsx` — button, state, result card.
- Modify `src/styles/app.css` — button + card styles.
- Create `tests/aiPricing.test.ts` — logic tests.

## Out of scope (YAGNI)

- AddJob integration — Quick Quote only for now.
- Market-rate mode — rejected during brainstorming (hallucination
  risk, no grounding).
- Caching / persisting AI results — each tap is a fresh call.
- Auto-firing the check — on-demand only, for cost and clarity.
