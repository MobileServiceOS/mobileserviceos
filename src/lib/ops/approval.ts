// src/lib/ops/approval.ts
// ═══════════════════════════════════════════════════════════════════
//  Human-approval gate — the hard requirement of the ops layer.
//
//  Claude DRAFTS and RECOMMENDS; the owner CONFIRMS. Any action that
//  spends money, sends a customer-facing message, changes pricing, or
//  is otherwise irreversible must require explicit owner approval in
//  the UI BEFORE it executes.
//
//  This is enforced with a FLAG ON THE ACTION, not UI convention. Every
//  side-effecting action routes through runAction(); it refuses to call
//  the executor unless the owner approved. The gate is FAIL-CLOSED: an
//  action that declares a side effect is gated even if someone forgot
//  to set requiresApproval, so a mislabeled action can never slip an
//  irreversible effect through.
//
//  Reads, summaries, and recommendations are sideEffect 'none' and run
//  without approval — they only render data.
// ═══════════════════════════════════════════════════════════════════

/** What kind of irreversible / outward effect an action causes. */
export type SideEffectKind =
  | 'none' // pure read / display — safe to render without approval
  | 'money' // spends money (places an order, issues a payout)
  | 'send' // sends a customer-facing message (SMS, email, review reply, invoice)
  | 'pricing' // changes pricing
  | 'irreversible'; // any other hard-to-undo action

export interface OpsActionSpec {
  /** Stable id, e.g. 'review.send'. */
  id: string;
  /** Human label for the confirm button. */
  label: string;
  /** Classification of the side effect. 'none' = read-only. */
  sideEffect: SideEffectKind;
  /**
   * Whether the owner must approve before this runs. For side-effecting
   * actions this MUST be true; the gate enforces it regardless (see
   * needsApproval) so a config slip can't bypass the gate.
   */
  requiresApproval: boolean;
}

/** Thrown when a gated action is invoked without owner approval. */
export class ApprovalRequiredError extends Error {
  readonly actionId: string;
  constructor(actionId: string) {
    super(`Action "${actionId}" requires explicit owner approval before it can run.`);
    this.name = 'ApprovalRequiredError';
    this.actionId = actionId;
  }
}

/** True if the action causes any outward / irreversible effect. */
export function isSideEffecting(action: OpsActionSpec): boolean {
  return action.sideEffect !== 'none';
}

/**
 * The single source of truth for "does this need approval". Fail-closed:
 * any side-effecting action needs approval even if requiresApproval was
 * left false.
 */
export function needsApproval(action: OpsActionSpec): boolean {
  return action.requiresApproval || isSideEffecting(action);
}

/** Throws ApprovalRequiredError unless the gate is satisfied. */
export function assertApproved(action: OpsActionSpec, approved: boolean): void {
  if (needsApproval(action) && !approved) {
    throw new ApprovalRequiredError(action.id);
  }
}

/**
 * THE chokepoint for executing any ops action. Runs `executor` only if
 * the approval gate permits. Read-only actions (sideEffect 'none',
 * requiresApproval false) run freely; everything else needs approved:true.
 */
export async function runAction<T>(
  action: OpsActionSpec,
  opts: { approved: boolean },
  executor: () => Promise<T> | T,
): Promise<T> {
  assertApproved(action, opts.approved);
  return await executor();
}
