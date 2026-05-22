// src/lib/aiClient.ts
// ═══════════════════════════════════════════════════════════════════
//  Browser-side client for the AI proxy (ai-proxy/worker.js).
//
//  The proxy is a Cloudflare Worker that holds the Anthropic API key.
//  The app never sees the key — it sends { task, input } plus the
//  signed-in user's Firebase ID token, and the proxy brokers the call.
//
//  Every AI feature in the app goes through callAI(). The proxy owns
//  the prompt for each task; the client only names a task and supplies
//  input. See ai-proxy/README.md for deploy + how to add tasks.
// ═══════════════════════════════════════════════════════════════════

import { _auth } from './firebase';
import { aiProxyUrl } from './env';

/**
 * True when the app is wired to a deployed AI proxy. AI features
 * should hide / disable themselves when this is false rather than
 * erroring — the app works fine without AI.
 */
export function isAIConfigured(): boolean {
  return aiProxyUrl().length > 0;
}

export interface AIResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * Call an AI task through the proxy.
 *
 *   task  — a task name the proxy's TASKS registry knows (e.g. 'ping').
 *   input — task-specific payload; shape is defined by the proxy task.
 *
 * Never throws — every failure path resolves to { ok: false, error }.
 */
export async function callAI(task: string, input?: unknown): Promise<AIResult> {
  const url = aiProxyUrl();
  if (!url) {
    return { ok: false, error: 'ai_not_configured' };
  }

  const user = _auth?.currentUser;
  if (!user) {
    return { ok: false, error: 'not_signed_in' };
  }

  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    return { ok: false, error: 'token_failed' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ task, input }),
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }

  let data: { ok?: boolean; text?: string; error?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: 'bad_response' };
  }

  if (!res.ok || !data || data.ok !== true) {
    return { ok: false, error: (data && data.error) || `proxy_error_${res.status}` };
  }

  return { ok: true, text: data.text || '' };
}
