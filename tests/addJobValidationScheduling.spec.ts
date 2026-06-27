// tests/addJobValidationScheduling.spec.ts
// Run: npx vitest run tests/addJobValidationScheduling.spec.ts
//
// Scheduling a job ahead doesn't require a confirmed price (it's set at
// completion), so validateAddJob's revenueOptional relaxes the revenue gate
// — but a typed price must still be valid.

import { describe, it, expect } from 'vitest';
import { validateAddJob } from '@/lib/addJobValidation';

const PHONE = '+13055551234';

describe('validateAddJob — revenueOptional (Schedule Job)', () => {
  it('allows a blank revenue when scheduling', () => {
    const v = validateAddJob({ customerPhone: PHONE, service: 'Flat Tire Repair', revenue: '' }, { revenueOptional: true });
    expect(v.canSave).toBe(true);
    expect(v.missing).not.toContain('revenue');
  });

  it('still rejects a typed-but-invalid revenue when scheduling', () => {
    const v = validateAddJob({ customerPhone: PHONE, service: 'Flat Tire Repair', revenue: '-5' }, { revenueOptional: true });
    expect(v.canSave).toBe(false);
    expect(v.missing).toContain('revenue');
  });

  it('still requires revenue for a normal (logged) job', () => {
    const v = validateAddJob({ customerPhone: PHONE, service: 'Flat Tire Repair', revenue: '' });
    expect(v.canSave).toBe(false);
    expect(v.missing).toContain('revenue');
  });
});
