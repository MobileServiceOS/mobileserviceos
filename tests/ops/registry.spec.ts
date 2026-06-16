// tests/ops/registry.spec.ts
// Registry invariant + the end-to-end guard: the real review-send action
// cannot run without owner approval.
import { describe, it, expect, vi } from 'vitest';
import { OPS_LOOPS, findUngatedSideEffects, allOpsActions } from '@/lib/ops/registry';
import { runAction, ApprovalRequiredError } from '@/lib/ops/approval';

describe('registry gate invariant', () => {
  it('has NO side-effecting action that skips approval', () => {
    expect(findUngatedSideEffects()).toEqual([]);
  });

  it('every declared action with a side effect requires approval', () => {
    for (const a of allOpsActions()) {
      if (a.sideEffect !== 'none') expect(a.requiresApproval).toBe(true);
    }
  });

  it('read-only loops declare no side-effecting actions', () => {
    expect(OPS_LOOPS.reorder.readOnly).toBe(true);
    expect(OPS_LOOPS.reorder.actions).toEqual([]);
    expect(OPS_LOOPS.brief.readOnly).toBe(true);
    expect(OPS_LOOPS.brief.actions).toEqual([]);
  });

  it('the review reply send action is a gated, customer-facing send', () => {
    const send = OPS_LOOPS.review.actions[0];
    expect(send.id).toBe('review.send');
    expect(send.sideEffect).toBe('send');
    expect(send.requiresApproval).toBe(true);
  });
});

describe('end-to-end guard on the real review-send action', () => {
  const send = OPS_LOOPS.review.actions[0];

  it('refuses to send without approval', async () => {
    const post = vi.fn();
    await expect(runAction(send, { approved: false }, post)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(post).not.toHaveBeenCalled();
  });

  it('sends once the owner approves', async () => {
    const post = vi.fn().mockResolvedValue('done');
    await expect(runAction(send, { approved: true }, post)).resolves.toBe('done');
    expect(post).toHaveBeenCalledOnce();
  });
});
