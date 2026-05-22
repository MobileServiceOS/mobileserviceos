// ai-proxy/worker.js
// ═══════════════════════════════════════════════════════════════════
//  Mobile Service OS — AI proxy (Cloudflare Worker).
//
//  The app is a no-backend PWA. This Worker is the ONE server-side
//  piece: it holds the Anthropic API key and brokers every AI call,
//  so the key is never shipped to the browser.
//
//  Request: POST { task, input }  +  Authorization: Bearer <Firebase ID token>
//  Response: { ok, text } | { error, ... }
//
//  Security — a public endpoint spends real money:
//   1. Firebase ID-token verification — only signed-in app users.
//   2. Origin allowlist — only the app's domains.
//   3. Task allowlist — only the prompt templates defined below.
//   4. (operator) Anthropic monthly spend cap — see README.
//
//  Deploy: see ai-proxy/README.md.
// ═══════════════════════════════════════════════════════════════════

// ─── Task registry ─────────────────────────────────────────────────
//  Each task owns its prompt server-side. The client sends only
//  { task, input }; it cannot drive arbitrary generation.
//  Roadmap features #3 / #7 / #14 add their tasks here later.
const TASKS = {
  // Health check. Exercises the whole chain (auth → routing →
  // Anthropic) with a tiny prompt so a deploy can be verified
  // end-to-end for a fraction of a cent.
  ping: () => ({
    system: 'You are a health check. Reply with exactly the word: pong',
    user: 'ping',
    maxTokens: 8,
  }),

  // AI Insights (roadmap #14). Turns a digest of computeInsights()
  // metrics into a short plain-English owner briefing. The client
  // (src/lib/aiInsights.ts) builds `input` and enforces a numeric
  // grounding guard on the reply; this handler owns the prompt.
  insights: (input) => {
    if (!input || typeof input !== 'object') {
      throw new Error('insights: input must be an object');
    }
    return {
      system:
        'You are writing a brief business summary for the owner of a ' +
        'mobile service business, from the metrics digest provided. ' +
        'Write 3 to 5 short bullet points — a fast owner briefing, not ' +
        'a chatbot reply. Cover the revenue trend, what is performing ' +
        'well, and the single most important risk (for example, the ' +
        'oldest unpaid invoices). Rules: (1) Use ONLY numbers that ' +
        'appear in the digest — never compute new figures such as ' +
        'percentages, sums, or growth deltas not already in the ' +
        'digest. (2) Write any incidental quantity as a word (the top ' +
        'three services, over eight weeks); refer to the unpaid-aging ' +
        'buckets by description (the oldest unpaid invoices), never by ' +
        'day numbers; use digits ONLY for actual digest figures. ' +
        '(3) Do NOT give prescriptive advice; describe and flag, do ' +
        'not instruct. (4) Omit any observation you cannot tie to a ' +
        'digest number. Respond with ONLY raw JSON, no markdown, as: ' +
        '{"bullets": ["<sentence>", "<sentence>"]}.',
      user: JSON.stringify(input),
      maxTokens: 400,
    };
  },
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin, env);
    }
    if (!originAllowed(origin, env)) {
      return json({ error: 'origin_not_allowed' }, 403, origin, env);
    }

    // ── Auth ────────────────────────────────────────────────────
    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const claims = await verifyFirebaseToken(bearer, env.FIREBASE_PROJECT_ID);
    if (!claims) {
      return json({ error: 'unauthorized' }, 401, origin, env);
    }

    // ── Dispatch ────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400, origin, env);
    }
    const handler = TASKS[body && body.task];
    if (!handler) {
      return json({ error: 'unknown_task' }, 400, origin, env);
    }

    let prompt;
    try {
      prompt = handler(body.input);
    } catch (e) {
      return json({ error: 'bad_input', detail: String(e).slice(0, 200) }, 400, origin, env);
    }

    // ── Call Claude ─────────────────────────────────────────────
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'proxy_misconfigured' }, 500, origin, env);
    }
    const result = await callClaude(prompt, env.ANTHROPIC_API_KEY, env.AI_MODEL);
    return json(result, result.ok ? 200 : 502, origin, env);
  },
};

// ─── Anthropic ─────────────────────────────────────────────────────
async function callClaude(prompt, apiKey, model) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5',
        max_tokens: prompt.maxTokens || 1024,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, error: 'llm_error', status: res.status, detail };
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: 'llm_unreachable', detail: String(e).slice(0, 200) };
  }
}

// ─── Firebase ID-token verification ────────────────────────────────
//  Verifies a Firebase Auth ID token (RS256 JWT): signature against
//  Google's published JWKS, plus aud / iss / exp / sub claims.
let _jwksCache = null;
let _jwksFetchedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getFirebaseJWKS() {
  const now = Date.now();
  if (_jwksCache && now - _jwksFetchedAt < JWKS_TTL_MS) return _jwksCache;
  const res = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  );
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const data = await res.json();
  const map = {};
  for (const k of data.keys || []) map[k.kid] = k;
  _jwksCache = map;
  _jwksFetchedAt = now;
  return map;
}

async function verifyFirebaseToken(token, projectId) {
  try {
    if (!token || !projectId) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const header = JSON.parse(b64urlToText(h));
    const payload = JSON.parse(b64urlToText(p));

    // Claims — cheap checks before the crypto.
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!payload.sub) return null;

    // Signature.
    const jwks = await getFirebaseJWKS();
    const jwk = jwks[header.kid];
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    );
    const data = new TextEncoder().encode(`${h}.${p}`);
    const sig = b64urlToBytes(s);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    return ok ? payload : null;
  } catch {
    return null;
  }
}

// ─── base64url helpers ─────────────────────────────────────────────
function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlToText(b64url) {
  return new TextDecoder().decode(b64urlToBytes(b64url));
}

// ─── CORS ──────────────────────────────────────────────────────────
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '')
    .split(',').map((o) => o.trim()).filter(Boolean);
}
function originAllowed(origin, env) {
  return allowedOrigins(env).includes(origin);
}
function corsHeaders(origin, env) {
  const allow = originAllowed(origin, env) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(obj, status, origin, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin, env) },
  });
}
