// tests/emptyJobDefaults.spec.ts
// Run: npx vitest run tests/emptyJobDefaults.spec.ts
//
// A newly-logged job defaults to Completed + Paid — the operator logs jobs
// after the work is done and collected.

import { describe, it, expect } from 'vitest';
import { EMPTY_JOB } from '@/lib/defaults';

describe('EMPTY_JOB defaults', () => {
  it('status defaults to Completed', () => {
    expect(EMPTY_JOB().status).toBe('Completed');
  });
  it('paymentStatus defaults to Paid', () => {
    expect(EMPTY_JOB().paymentStatus).toBe('Paid');
  });
});
