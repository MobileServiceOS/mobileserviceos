# AI Proxy — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** Infrastructure — the LLM proxy that unblocks roadmap
features #3 (AI pricing), #7 (voice logging), #14 (AI insights).

## Goal

A server-side proxy that holds the Anthropic API key and brokers
every AI call, so the no-backend PWA can use an LLM without
exposing the key client-side.

## Constraint

The app has no backend (no Cloud Functions, no-Blaze). The proxy
is a **Cloudflare Worker** — free tier, single file, deployed with
`wrangler`. This feature delivers the Worker code + the client +
the deploy guide; the operator runs the actual deploy (their
Cloudflare account, their Anthropic key with billing).

## Architecture

```
app  →  callAI(task, input)            src/lib/aiClient.ts
     →  POST <VITE_AI_PROXY_URL>        + Firebase ID token
     →  Cloudflare Worker               ai-proxy/worker.js
        · verify Firebase ID token (RS256, Google JWKS)
        · origin allowlist
        · dispatch by `task` (server-owned prompt templates)
        · call Claude (claude-haiku-4-5)
     →  { ok, text }  →  app
```

## Security

A public endpoint spends real money — so:

1. **Firebase ID-token verification.** The Worker verifies the
   caller's Firebase JWT: RS256 signature against Google's JWKS
   (`securetoken@system` JWK endpoint), `aud` = the Firebase
   project, `iss` matches, not expired. Only signed-in users of
   the app can call the proxy. 401 otherwise.
2. **Origin allowlist** — `ALLOWED_ORIGINS` var (app domain +
   localhost). CORS reflects only allowed origins.
3. **Task allowlist** — the Worker runs only *defined* tasks and
   owns the prompt templates server-side; it can't be driven to
   arbitrary generation.
4. **Backstop** — the operator sets an Anthropic monthly spend cap
   (deploy guide step).

## Scope — plumbing only

This feature ships the *infrastructure*: auth, CORS, the Claude
call, a `task` dispatcher, and ONE `ping` task that exercises the
full chain (a minimal Claude call — verifies the deploy + key
end-to-end for a fraction of a cent). Features #3 / #7 / #14 each
add their own task to the Worker later.

## Files

| File | Change |
|---|---|
| `ai-proxy/worker.js` | **new** — the Cloudflare Worker |
| `ai-proxy/wrangler.toml` | **new** — Worker config (vars, not secrets) |
| `ai-proxy/README.md` | **new** — exact deploy steps |
| `src/lib/aiClient.ts` | **new** — `callAI(task, input)` + `isAIConfigured()` |
| `.env.example` | add `VITE_AI_PROXY_URL` |
| `vitest.config.ts` | widen `include` to `**/*.test.{ts,tsx}` |
| `tests/components/aiClient.test.ts` | client behavior test (vi.mock firebase + fetch) |

## Graceful-off

`VITE_AI_PROXY_URL` unset → `isAIConfigured()` is false → AI
features hide themselves; the app runs exactly as today. Nothing
breaks before the proxy is deployed.

## Testing

`tests/components/aiClient.test.ts` (vitest, mocks): not-configured
→ error; no signed-in user → error; happy path → parsed result;
proxy error status → error. The Worker is Cloudflare-runtime JS —
verified by the operator's `ping` smoke test post-deploy.

## Decisions locked during brainstorming

- Host: **Cloudflare Workers**.
- Provider: **Anthropic (Claude)**, model `claude-haiku-4-5`.
- Security: **Firebase ID-token verification** + origin + task
  allowlists.
- This feature = the proxy plumbing; the AI features come after.
