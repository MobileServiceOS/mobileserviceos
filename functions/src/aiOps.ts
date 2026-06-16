// functions/src/aiOps.ts
// ═══════════════════════════════════════════════════════════════════
//  aiOps — HTTPS callable. The server-side boundary for the AI ops layer.
//
//  This is the ONLY place the Anthropic API key is used. It is read from
//  the ANTHROPIC_API_KEY secret (process.env, declared in the function's
//  `secrets`) and NEVER returned to or reachable by the client.
//
//  Contract: the client assembles the prompt (system + user) for a given
//  loop and sends it here; we authenticate (owner/admin of the business),
//  call the Anthropic Messages API via the official SDK, and return the
//  raw model text. The client safely parses + validates the JSON. Nothing
//  here acts on the business's data — it only generates text.
//
//  Model: defaults to a current Sonnet-class model for cost/quality,
//  overridable via the ANTHROPIC_MODEL env var or the request (both are
//  checked against an allow-list). Dormant-safe: if the key is missing
//  the call fails cleanly with AI_NOT_CONFIGURED rather than 500-ing.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';

void admin;

// Current Sonnet-class default (see docs/ai-ops-layer.md → Model config).
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set<string>([
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5',
]);

const MIN_TOKENS = 256;
const MAX_TOKENS = 4096;
const DEFAULT_TOKENS = 1024;

interface AiOpsInput {
  businessId: string;
  loopId: string;
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

interface AiOpsOutput {
  text: string;
  model: string;
}

function resolveModel(requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  const fromEnv = process.env.ANTHROPIC_MODEL;
  if (fromEnv && ALLOWED_MODELS.has(fromEnv)) return fromEnv;
  return DEFAULT_MODEL;
}

function clampTokens(n: number | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_TOKENS;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, Math.round(v)));
}

export const aiOps = onCall<AiOpsInput, Promise<AiOpsOutput>>(
  { secrets: ['ANTHROPIC_API_KEY'] },
  async (req): Promise<AiOpsOutput> => {
    const uid = req.auth?.uid;
    const { businessId, loopId, system, user, model, maxTokens } = req.data ?? ({} as AiOpsInput);

    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!loopId) throw new HttpsError('invalid-argument', 'loopId required');
    if (!system?.trim() || !user?.trim()) {
      throw new HttpsError('invalid-argument', 'system and user prompts required');
    }

    // Owner/admin gate — same pattern as sendManualReviewRequest.
    const db = admin.firestore();
    const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
    const role = memberSnap.data()?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    // Key lives only here. Dormant-safe when unconfigured.
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'AI_NOT_CONFIGURED');
    }

    const chosenModel = resolveModel(model);
    const client = new Anthropic({ apiKey });

    let resp;
    try {
      resp = await client.messages.create({
        model: chosenModel,
        max_tokens: clampTokens(maxTokens),
        system,
        messages: [{ role: 'user', content: user }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI request failed';
      throw new HttpsError('internal', msg);
    }

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!text) {
      throw new HttpsError('internal', 'empty AI response');
    }

    return { text, model: chosenModel };
  },
);
