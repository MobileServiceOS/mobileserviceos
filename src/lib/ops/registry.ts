// src/lib/ops/registry.ts
// ═══════════════════════════════════════════════════════════════════
//  Ops-loop registry — the reusable pattern.
//
//  Every loop is described once here: its id, title, whether its primary
//  output is read-only (renders without approval), and the side-effecting
//  actions it can surface (each gated by the approval flag). Adding a new
//  loop later = add a module under ./loops + one entry here; the UI and
//  the gate invariant pick it up automatically.
//
//  The per-loop gather / buildPrompt / parse functions stay in their own
//  modules (typed precisely); this registry holds the metadata and the
//  approval contract.
// ═══════════════════════════════════════════════════════════════════

import type { OpsActionSpec } from '@/lib/ops/approval';
import { needsApproval } from '@/lib/ops/approval';

export type OpsLoopId = 'reorder' | 'review' | 'brief';

export interface OpsLoopMeta {
  id: OpsLoopId;
  title: string;
  description: string;
  /**
   * True when the loop's PRIMARY output is a read-only recommendation /
   * summary that may render without approval. False loops still render
   * their draft, but any side-effecting action is gated.
   */
  readOnly: boolean;
  /** Side-effecting actions this loop can surface (all gated). */
  actions: OpsActionSpec[];
}

export const OPS_LOOPS: Record<OpsLoopId, OpsLoopMeta> = {
  reorder: {
    id: 'reorder',
    title: 'Reorder recommendations',
    description:
      'Ranked tire sizes to reorder with suggested buy quantity and reason. The owner places the order.',
    readOnly: true,
    actions: [],
  },
  review: {
    id: 'review',
    title: 'Review reply',
    description:
      'Drafts a house-style reply to a Google review. The owner edits and sends; replies are never auto-posted.',
    readOnly: false,
    actions: [
      {
        id: 'review.send',
        label: 'Approve & use this reply',
        sideEffect: 'send', // customer-facing message
        requiresApproval: true,
      },
    ],
  },
  brief: {
    id: 'brief',
    title: 'Daily brief',
    description:
      "Summarizes today and this week and the single most important thing to act on. Read-only.",
    readOnly: true,
    actions: [],
  },
};

export const OPS_LOOP_LIST: OpsLoopMeta[] = [
  OPS_LOOPS.brief,
  OPS_LOOPS.reorder,
  OPS_LOOPS.review,
];

/** Every action declared across all loops. */
export function allOpsActions(): OpsActionSpec[] {
  return OPS_LOOP_LIST.flatMap((loop) => loop.actions);
}

/**
 * Gate invariant: every side-effecting action across the registry must
 * require approval. Returns the offenders (empty array = healthy). Used
 * by the guard test and can be asserted at startup.
 */
export function findUngatedSideEffects(): OpsActionSpec[] {
  return allOpsActions().filter((a) => a.sideEffect !== 'none' && !needsApproval(a));
}
