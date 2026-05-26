# AI Proxy — Cloudflare Worker

Mobile Service OS is a no-backend PWA. AI features still need a server-side
piece, because the Anthropic API key must never ship to the browser. This
Worker is that piece — the **one** server-side component in the project.

It brokers every AI call:

```
Browser ──POST {task,input} + Firebase ID token──▶ Worker ──▶ Anthropic
        ◀──────────────── { ok, text } ──────────────────────┘
```

Security — a public endpoint spends real money, so the Worker enforces:

1. **Firebase ID-token verification** — only signed-in app users.
2. **Origin allowlist** — only the app's own domains.
3. **Task allowlist** — only the prompt templates baked into `worker.js`.
4. **Anthropic spend cap** — set by the operator (step 7 below).

---

## Deploy

You need a Cloudflare account and an Anthropic account. The whole thing
runs on free / pay-as-you-go tiers; expect a few cents for testing.

### 1. Create a Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up>. No paid plan needed —
Workers has a free tier.

### 2. Install Wrangler

Wrangler is Cloudflare's CLI for Workers.

```bash
npm install -g wrangler
```

### 3. Log in

```bash
wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account.

### 4. Fill in `wrangler.toml`

Edit `ai-proxy/wrangler.toml` and set the `[vars]`:

- `FIREBASE_PROJECT_ID` — your Firebase project id (Firebase Console →
  Project Settings → General). Defaults to `mobile-service-os`.
- `ALLOWED_ORIGINS` — comma-separated, no trailing slash. Include the
  deployed app origin and any local dev origin, e.g.
  `https://nashyberry.github.io,http://localhost:5173`.
- `AI_MODEL` — Anthropic model id. Defaults to `claude-haiku-4-5`.

### 5. Get an Anthropic API key

Create one at <https://console.anthropic.com/> → **API Keys**. Make sure
the account has billing set up, or calls will fail.

### 6. Store the key as a secret

The key is a **secret** — never put it in `wrangler.toml` or git.

```bash
cd ai-proxy
wrangler secret put ANTHROPIC_API_KEY
```

Paste the key when prompted. It is stored encrypted by Cloudflare and
injected into the Worker as `env.ANTHROPIC_API_KEY`.

### 7. Set an Anthropic spend cap

In the Anthropic Console → **Billing / Limits**, set a monthly spend
limit. The Worker's auth + allowlists keep out strangers, but a spend
cap is the backstop if anything slips through.

### 8. Deploy

```bash
cd ai-proxy
wrangler deploy
```

Wrangler prints the Worker URL, e.g.
`https://mobileserviceos-ai-proxy.<subdomain>.workers.dev`.

### 9. Wire the app to the proxy

Copy that URL into the app's environment as `VITE_AI_PROXY_URL`:

- Local dev — add to `.env.local`.
- Production — add to `.env.production` (or your host's env settings).

```
VITE_AI_PROXY_URL=https://mobileserviceos-ai-proxy.<subdomain>.workers.dev
```

When this var is empty the app simply treats AI features as unavailable —
nothing breaks.

---

## Smoke test

The `ping` task exercises the whole chain (auth → routing → Anthropic)
for a fraction of a cent. It needs a real Firebase ID token.

The app uses the **modular** Firebase SDK with `browserLocalPersistence`,
so there is no global `firebase` object — the signed-in user (and its
ID token) is persisted in `localStorage`. The simplest test runs
entirely in the browser console: open the deployed app, sign in,
then paste this. The token never leaves your machine.

```js
(async () => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('firebase:authUser:'));
  if (!k) return console.error('Not signed in on THIS tab — open the app and sign in.');
  const u = JSON.parse(localStorage.getItem(k));
  const tm = u && u.stsTokenManager;
  if (!tm || !tm.accessToken) return console.error('No token stored — reload and retry.');
  if (tm.expirationTime && Date.now() > tm.expirationTime) {
    return console.error('Token expired — reload the page, then re-run.');
  }
  const resp = await fetch('https://mobileserviceos-ai-proxy.veyareid.workers.dev', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tm.accessToken}`,
    },
    body: JSON.stringify({ task: 'ping' }),
  });
  console.log('HTTP', resp.status, await resp.json());
})();
```

Expected: `HTTP 200 { ok: true, text: 'pong' }`.

Run it on the **app's own tab** (the deployed origin) — not on any
other site, whose `localStorage` is separate. If you get `HTTP 401`,
reload the page so Firebase mints a fresh token, then re-run.

### Error responses

| Status | `error`              | Meaning                                       |
|--------|----------------------|-----------------------------------------------|
| 403    | `origin_not_allowed` | `Origin` not in `ALLOWED_ORIGINS`.            |
| 401    | `unauthorized`       | Missing / invalid / expired Firebase token.   |
| 400    | `bad_json`           | Body was not valid JSON.                       |
| 400    | `unknown_task`       | `task` not in the Worker's `TASKS` registry.  |
| 400    | `bad_input`          | Task handler rejected `input`.                 |
| 500    | `proxy_misconfigured`| `ANTHROPIC_API_KEY` secret not set.            |
| 502    | `llm_error`          | Anthropic returned a non-2xx (see `detail`).  |
| 502    | `llm_unreachable`    | Network error reaching Anthropic.              |

---

## Tasks

### `ping`

Health check. Exercises the whole chain (auth → routing → Anthropic) with a tiny prompt for end-to-end deployment verification.

**Input:** None (no validation).

**Output:** `{ ok: true, text: "pong" }`.

**Cost:** ~$0.0001 per call.

### `insights`

AI Insights (roadmap #14). Turns a digest of `computeInsights()` metrics into a short plain-English owner briefing covering revenue trend, performance, and key risks.

**Input shape:** Digest object from `src/lib/aiInsights.ts`.

**Output:** `{"bullets": [string]}` JSON; client enforces numeric grounding.

**Cost:** ~$0.003 per call at Haiku 4.5 pricing.

### `inventory_insights`

Inventory AI Insights (roadmap inventory Phase 4). Turns a compact inventory + jobs digest into an owner briefing covering restocking needs, slow movers, and risks.

**Input shape:** Digest object from `src/lib/aiInventoryInsights.ts`.

**Output:** `{"bullets": [string]}` JSON; client enforces numeric grounding.

**Cost:** ~$0.003 per call at Haiku 4.5 pricing.

### `pricing_insights`

Smart Pricing observations (Phase B follow-up to audit). Compares 90-day median sale price to configured service basePrice per (service, tire-size) group. Returns 3–5 grounded bullets. Owner-facing on the Insights page (tire vertical only).

**Input shape:** `PricingDigest` from `src/lib/pricingInsights.ts`.

**Output:** `{"bullets": [string]}` JSON; client grounds every numeric token against the digest's number set.

**Cost:** ~$0.003 per call at Haiku 4.5 pricing.

---

## Adding tasks

Each AI feature owns a prompt template server-side. The client only sends
`{ task, input }` — it cannot drive arbitrary generation. To add a task,
extend the `TASKS` map in `worker.js`:

```js
const TASKS = {
  ping: () => ({ system: '…', user: 'ping', maxTokens: 8 }),

  myTask: (input) => ({
    system: 'Instructions for the model.',
    user: `Some prompt built from ${input.something}.`,
    maxTokens: 512,
  }),
};
```

A handler receives the client's `input` and returns
`{ system, user, maxTokens }`. Throw on bad input — the Worker turns that
into a `400 bad_input`. Then redeploy with `wrangler deploy`.
