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
  recentJobs: Array<{          // this business's own history
    vehicleType: string;
    revenue: number;
    date: string;
  }>;
}
```

`recentJobs` carries **no customer PII** — only vehicle, price, and
date. The client is responsible for that (see `buildPricingInput`).

**Prompt** (server-side, in the task handler):

- *System:* "You are a pricing assistant for a mobile service
  business (tire / mechanic / detailing). You are given a
  deterministic cost-plus quote and the business's own recent jobs
  for this service. Recommend ONE price and a one-sentence rationale.
  Anchor to the deterministic quote and the recent-job prices — do
  NOT invent market rates or use outside pricing knowledge. If there
  is little or no history, lean on the deterministic quote and say so
  in the rationale. Respond with ONLY raw JSON, no markdown, as:
  `{\"price\": <number>, \"rationale\": \"<one sentence>\"}`."
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
- `recentJobs` — `completedJobs` filtered to `job.service === form.service`,
  sorted by `date` descending, capped at the **15** most recent, each
  mapped to `{ vehicleType, revenue, date }` only.
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

- **No history for the service** — `recentJobs` is empty; the prompt
  instructs Claude to lean on the deterministic quote and say so.
- **Roles** — the Quick Quote is already visible to every role
  (technicians can see revenue), so AI Price Check needs no extra
  gating.
- **Cost** — one Haiku call (~200 tokens) per tap, on demand only —
  fractions of a cent. No auto-firing.

## Testing

`tests/aiPricing.test.ts` (hand-rolled tsx runner, like the other
`tests/*.test.ts`):

- `buildPricingInput` — conditions mapped correctly; `recentJobs`
  filtered to the matching service, sorted newest-first, capped at 15,
  and carrying no fields beyond `vehicleType`/`revenue`/`date`;
  `deterministicQuote` lifted correctly.
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
