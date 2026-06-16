// src/lib/ops/client.ts
// ═══════════════════════════════════════════════════════════════════
//  Client transport for the ops layer.
//
//  The ONLY thing that crosses the wire is the assembled prompt; the
//  Anthropic API key lives server-side on the `aiOps` callable Cloud
//  Function (functions/src/aiOps.ts) and is NEVER exposed to the client.
//
//  This module is the only ops file that imports firebase, so the pure
//  loop logic (gather / prompt / parse / approval / house-style) stays
//  unit-testable without a firebase mock.
// ═══════════════════════════════════════════════════════════════════

import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import type { OpsLoopId } from '@/lib/ops/registry';

/** Default model — a current Sonnet-class model for cost/quality.
 *  Overridable per call; the server also enforces an allow-list and can
 *  override via the ANTHROPIC_MODEL env var. */
export const DEFAULT_OPS_MODEL = 'claude-sonnet-4-6';

interface AiOpsRequest {
  businessId: string;
  loopId: OpsLoopId;
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}
interface AiOpsResponse {
  text: string;
  model: string;
}

// Mirrors the emulator-aware helper used elsewhere (ReviewAutomationSection).
function emulatorAwareFunctions() {
  const fns = getFunctions();
  const env =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const useEmu =
    Boolean(env.DEV) &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';
  if (useEmu) {
    try {
      connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    } catch {
      /* already connected */
    }
  }
  return fns;
}

/**
 * Call the server-side AI proxy. Returns the raw model text — the caller
 * is responsible for safe parsing (see each loop's parse function). The
 * server enforces auth (owner/admin) and holds the API key.
 */
export async function callAiOps(req: AiOpsRequest): Promise<string> {
  const fn = httpsCallable<AiOpsRequest, AiOpsResponse>(emulatorAwareFunctions(), 'aiOps');
  const { data } = await fn({ model: DEFAULT_OPS_MODEL, ...req });
  return data?.text ?? '';
}
