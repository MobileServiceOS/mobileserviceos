# AI Ops Layer

The AI ops layer turns MSOS business data into **recommendations and drafts**,
with a hard **human-approval gate** on anything that spends money, sends a
customer-facing message, changes pricing, or is otherwise irreversible. Claude
drafts and recommends; the owner confirms each action.

Three loops ship today, and the pattern is reusable for more:

| Loop | What it does | Acts on its own? |
|---|---|---|
| **Daily brief** | Summarizes today + this week and the single most important thing to act on. | No — read-only |
| **Reorder recommendations** | Ranks tire sizes to reorder with suggested buy qty + reason. | No — read-only; the owner places the order |
| **Review reply** | Drafts a house-style reply to a Google review. | No — the owner approves, then sends; never auto-posted |

---

## How it works

```
Client (browser)                         Server (Cloud Function)        Anthropic
────────────────                         ──────────────────────         ─────────
gather MSOS data ──┐
build prompt       │   { system, user }      aiOps callable
(src/lib/ops)      ├──────────────────────▶  • owner/admin auth
                   │                          • reads ANTHROPIC_API_KEY ──▶ Messages API
safe-parse JSON ◀──┘     { text }            • returns raw model text  ◀── (JSON text)
validate shape
render cards / draft
   │
   └─ side-effecting action? ─▶ approval gate (runAction) ─▶ executes only if approved
```

Key properties:

- **The Anthropic API key never reaches the client.** Every Anthropic call runs
  server-side in the `aiOps` Cloud Function (`functions/src/aiOps.ts`), which
  reads the key from a secret. The only thing the client sends is the assembled
  prompt.
- **The model returns JSON only.** Each loop prompts for a strict JSON shape. The
  client *never* renders raw model text as structured data — it runs the text
  through `safeParseJson` (strips ``` fences, `try/catch`, extracts JSON from
  surrounding prose) and then validates the shape before use.
- **Reads render freely; side effects are gated.** Recommendations and summaries
  render without approval. Any side-effecting action routes through `runAction`,
  which refuses to execute without explicit owner approval — enforced by a
  **flag on the action**, not UI convention (and fail-closed: an action that
  declares a side effect is gated even if someone forgot to set the flag).

### File map

```
src/lib/ops/
  json.ts          safeParseJson + fence stripping + coercion helpers
  approval.ts      OpsActionSpec, runAction, the fail-closed approval gate
  houseStyle.ts    review-reply validators (no emoji / no dashes / phrase / counties)
  registry.ts      OPS_LOOPS metadata + the gate invariant (findUngatedSideEffects)
  client.ts        callAiOps — the only file that talks to firebase/functions
  loops/
    reorder.ts     gather + buildPrompt + parse (reuses inventoryIntel ranking)
    review.ts      gather + buildPrompt + parse (house style baked into the prompt)
    brief.ts       gather + buildPrompt + parse (reuses computeSizeDemand)
  index.ts         public barrel

src/components/ops/OpsPage.tsx   the in-app UI (More → AI Ops tab)
functions/src/aiOps.ts           the server boundary (holds the API key)
```

The loops **reuse the existing inventory intelligence** — `computeSizeDemand`
and `computeInventoryIntel` (deduped per-size on-hand + job-count ranking) from
`src/lib/inventoryIntel.ts`. They do not reinvent ranking.

---

## The approval gate

Every action carries a spec:

```ts
interface OpsActionSpec {
  id: string;
  label: string;
  sideEffect: 'none' | 'money' | 'send' | 'pricing' | 'irreversible';
  requiresApproval: boolean;
}
```

To run an action, go through the gate:

```ts
await runAction(action, { approved }, async () => {
  // ...the side effect (send the message, place the order)...
});
```

`runAction` throws `ApprovalRequiredError` (and never calls the executor) when
the action needs approval and `approved` is false. `needsApproval` is
**fail-closed**: `sideEffect !== 'none'` always needs approval, even if
`requiresApproval` was left false. The registry invariant
`findUngatedSideEffects()` returns the offenders (it must be empty) and is
asserted by the test suite.

Reads, summaries, and recommendations are `sideEffect: 'none'` and render
without approval.

---

## Adding a new loop

1. **Create `src/lib/ops/loops/<name>.ts`** exporting three pure functions:
   - `gather<Name>Context(...)` — assemble structured context from MSOS data
     (reuse existing pure helpers; keep it deterministic so it is unit-testable).
   - `build<Name>Prompt(ctx, …)` → `{ system, user }` — instruct the model to
     return **JSON only** in an explicit shape.
   - `parse<Name>Result(raw)` → `ParseResult<T>` — call `safeParseJson`, then
     validate the shape and coerce fields. Never trust raw text.
2. **Register it** in `src/lib/ops/registry.ts`: add the `OpsLoopId`, an
   `OPS_LOOPS` entry (`title`, `description`, `readOnly`), and — if the loop can
   trigger a side effect — an `OpsActionSpec` in `actions` with
   `requiresApproval: true`.
3. **Export** the new functions/types from `src/lib/ops/index.ts`.
4. **Render it** in `src/components/ops/OpsPage.tsx` (follow an existing card).
   Run side-effecting actions through `runAction`.
5. **Test it** under `tests/ops/<name>.spec.ts`: gather/output shape, malformed
   model output, and (if applicable) the approval gate.

No server change is required — `aiOps` is a generic prompt → text proxy; new
loops only add client-side prompt building and parsing.

---

## API key / secret configuration

The Anthropic key is a **server secret** for the `aiOps` Cloud Function. It is
never a `VITE_` variable (those are inlined into the client bundle).

```bash
# Set the secret (Firebase prompts for the value):
firebase functions:secrets:set ANTHROPIC_API_KEY

# Deploy the function so it picks up the secret:
firebase deploy --only functions:aiOps
```

`aiOps` declares `{ secrets: ['ANTHROPIC_API_KEY'] }` and reads
`process.env.ANTHROPIC_API_KEY`. Until the secret is set, the function fails
cleanly with `failed-precondition / AI_NOT_CONFIGURED` — the rest of the app is
unaffected, and the UI shows a friendly "AI is not configured yet" message.

Access control: `aiOps` is **owner/admin gated** (same membership check as
`sendManualReviewRequest`) — it verifies `businesses/{businessId}/members/{uid}`
has role `owner` or `admin`. In the UI, the **AI Ops** entry in the More sheet is
gated on `canViewFinancials`.

> Note: the repo also references an optional Cloudflare Worker AI proxy
> (`VITE_AI_PROXY_URL`, `ai-proxy/`). The active, in-repo path is the `aiOps`
> Cloud Function documented here; the Worker is an alternative server boundary
> and is not required.

---

## ⚠️ Required follow-ups before multi-tenant use

The current build is fine for a **single trusted tenant** (the owner dogfooding).
Two things **MUST** be done before a second tenant uses this, and are deliberately
left as documented follow-ups (not built yet):

1. **Move data gathering server-side.** Today the client assembles the context
   (it gathers from already-synced Firestore data via the `src/lib` ranking
   functions) and sends the finished `system` + `user` prompt to `aiOps`. That
   means a **tampered client could send an arbitrary or oversized prompt** and
   run up the Anthropic bill, regardless of the real business data. The fix:
   port the ranking (`inventoryIntel` / `computeSizeDemand` / the loop `gather`
   functions) into `functions/` as a **shared module**, and have `aiOps` accept
   only `{ businessId, loopId, params }` — gathering the data and building the
   prompt **on the server** from Firestore, so the client can no longer dictate
   what is sent to Anthropic.
2. **Add rate-limiting + abuse bounds to `aiOps`.** It currently has owner/admin
   **auth** (good) and clamps `maxTokens` to 256–4096, but there is **no
   per-tenant request-rate limit**. An authenticated owner (or a tampered
   client) can call it in a loop. Before multi-tenant: add per-uid / per-business
   rate limiting (e.g. a Firestore counter or the existing AI proxy Worker's
   per-uid limiter) and reject prompts over a sane size cap.

Until both are done, **do not expose this to a second tenant** — the blast
radius of a tampered client is "run up the Anthropic bill."

## Tracked follow-up: let CI self-deploy functions

`aiOps` was deployed **manually from the owner's machine** (`firebase login`
as the project owner `dkreid12`), because the CI workflow
(`.github/workflows/deploy-functions.yml`, which runs on push to `main`
touching `functions/**`) uses a **deployer service account that lacks the IAM
to deploy 2nd-gen functions and act as the runtime SA**. The local owner
identity has that IAM, so the manual deploy also auto-granted
`roles/secretmanager.secretAccessor` on `ANTHROPIC_API_KEY` to the runtime SA
(`77527561910-compute@developer.gserviceaccount.com`).

Result today: **merging a `functions/**` change does NOT reliably auto-deploy**
— the CI deploy job will fail on the ActAs/IAM permission. Functions must be
deployed by hand from an owner machine until this is fixed.

To make the pipeline self-deploy (documented, **not done** — out of scope for
this change):

- **Deployer SA** (the one CI authenticates as) needs:
  - `roles/iam.serviceAccountUser` **on the runtime SA**
    (`77527561910-compute@developer.gserviceaccount.com`) — the ActAs grant
    that's currently missing.
  - `roles/cloudfunctions.admin`
  - `roles/cloudbuild.builds.editor`
  - `roles/artifactregistry.writer`
- **Runtime SA** (`77527561910-compute@developer.gserviceaccount.com`) needs
  `roles/secretmanager.secretAccessor` on each secret it reads
  (already granted for `ANTHROPIC_API_KEY` during the manual deploy; future
  secrets need the same).

Until those grants exist, deploy functions with:
`npx firebase-tools deploy --only functions:<name> --project mobile-service-os`
from an owner machine. (Note: the standalone `firebase` **firepit** binary
bundles npm 8.19.4, whose predeploy `npm run build` crashes with
`Cannot read properties of undefined (reading 'stdin')`; run the deploy via
`npx firebase-tools` so the predeploy uses system npm. Also: the runtime is
**nodejs20**, deprecated 2026-04-30 / decommissioned 2026-10-30 — bump
`functions` to nodejs22 before then.)

## Model config

- **Default model:** `claude-sonnet-4-6` (a current Sonnet-class model — the
  cost/quality default).
- **Override per call:** `callAiOps({ ..., model })` (client) — useful for A/B.
- **Override globally:** set the `ANTHROPIC_MODEL` env var / secret on the
  function.
- **Allow-list:** the server only honors models in `ALLOWED_MODELS` in
  `functions/src/aiOps.ts` (`claude-sonnet-4-6`, `claude-opus-4-8`,
  `claude-haiku-4-5`); anything else falls back to the default. Add a model id to
  that set to allow it.
- **Output size:** `maxTokens` is clamped server-side to 256–4096 (default 1024).

The model returns JSON via prompt instruction (not structured-output mode) so the
safe-parse + validate path is exercised on every call — this is deliberate, and
the parsing/validation is covered by `tests/ops/*.spec.ts`.

---

## Tests

`tests/ops/` (vitest — run with `npm run test:ui`):

| File | Covers |
|---|---|
| `json.spec.ts` | JSON parsing/validation, including malformed / fenced / prose-wrapped / empty output |
| `approval.spec.ts` | The gate primitive — no side-effecting action runs without approval (incl. fail-closed) |
| `registry.spec.ts` | Registry invariant + end-to-end guard on the real review-send action |
| `houseStyle.spec.ts` | Review house style: no emoji, no dashes, required phrase, Broward + Miami Dade |
| `reorder.spec.ts` | Loop 1 gather (ranking, out-of-stock first) + output shape + malformed parse |
| `review.spec.ts` | Loop 2 gather + prompt rules + parse + house-style on a compliant draft |
| `brief.spec.ts` | Loop 3 gather (day/week totals, pending payments, sources) + parse |
