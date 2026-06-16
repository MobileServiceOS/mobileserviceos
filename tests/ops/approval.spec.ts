// tests/ops/approval.spec.ts
// The approval gate: no side-effecting action runs without an approval flag.
import { describe, it, expect, vi } from 'vitest';
import {
  runAction,
  assertApproved,
  needsApproval,
  isSideEffecting,
  ApprovalRequiredError,
  type OpsActionSpec,
} from '@/lib/ops/approval';

const readOnly: OpsActionSpec = { id: 'read', label: 'Read', sideEffect: 'none', requiresApproval: false };
const sendAction: OpsActionSpec = { id: 'send', label: 'Send', sideEffect: 'send', requiresApproval: true };
// Mislabeled: declares a side effect but forgot requiresApproval. The
// gate must STILL refuse it (fail-closed) — that's the guarantee.
const mislabeled: OpsActionSpec = { id: 'pay', label: 'Pay', sideEffect: 'money', requiresApproval: false };

describe('classification', () => {
  it('isSideEffecting', () => {
    expect(isSideEffecting(readOnly)).toBe(false);
    expect(isSideEffecting(sendAction)).toBe(true);
  });
  it('needsApproval is fail-closed for side effects', () => {
    expect(needsApproval(readOnly)).toBe(false);
    expect(needsApproval(sendAction)).toBe(true);
    expect(needsApproval(mislabeled)).toBe(true); // despite requiresApproval:false
  });
});

describe('runAction gate', () => {
  it('runs a read-only action without approval', async () => {
    const exec = vi.fn().mockResolvedValue('ok');
    await expect(runAction(readOnly, { approved: false }, exec)).resolves.toBe('ok');
    expect(exec).toHaveBeenCalledOnce();
  });

  it('REFUSES a side-effecting action without approval (executor never runs)', async () => {
    const exec = vi.fn();
    await expect(runAction(sendAction, { approved: false }, exec)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs a side-effecting action once approved', async () => {
    const exec = vi.fn().mockResolvedValue('sent');
    await expect(runAction(sendAction, { approved: true }, exec)).resolves.toBe('sent');
    expect(exec).toHaveBeenCalledOnce();
  });

  it('refuses a mislabeled side-effecting action without approval (fail-closed)', async () => {
    const exec = vi.fn();
    await expect(runAction(mislabeled, { approved: false }, exec)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('assertApproved', () => {
  it('throws for gated actions without approval', () => {
    expect(() => assertApproved(sendAction, false)).toThrow(ApprovalRequiredError);
  });
  it('passes for gated actions with approval', () => {
    expect(() => assertApproved(sendAction, true)).not.toThrow();
  });
  it('passes for read-only actions regardless', () => {
    expect(() => assertApproved(readOnly, false)).not.toThrow();
  });
});
