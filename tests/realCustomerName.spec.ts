// tests/realCustomerName.spec.ts
// Run: npx vitest run tests/realCustomerName.spec.ts
//
// Customer-facing name: blank OR the "Unknown" placeholder → '' so texts,
// invoices, and quotes never read "Hi Unknown".

import { describe, it, expect } from 'vitest';
import { realCustomerName } from '@/lib/utils';

describe('realCustomerName', () => {
  it('returns a real name as-is (trimmed)', () => {
    expect(realCustomerName('Lucas')).toBe('Lucas');
    expect(realCustomerName('  Maria Gomez ')).toBe('Maria Gomez');
  });
  it('treats blank/undefined/null as no name', () => {
    expect(realCustomerName('')).toBe('');
    expect(realCustomerName('   ')).toBe('');
    expect(realCustomerName(undefined)).toBe('');
    expect(realCustomerName(null)).toBe('');
  });
  it('treats the "Unknown" placeholder as no name (any case)', () => {
    expect(realCustomerName('Unknown')).toBe('');
    expect(realCustomerName('unknown')).toBe('');
    expect(realCustomerName('  UNKNOWN ')).toBe('');
  });
  it('does not strip names that merely contain "unknown"', () => {
    expect(realCustomerName('Unknowns Garage')).toBe('Unknowns Garage');
  });
  it('treats wrapped/variant placeholders as no name', () => {
    // The exact value seen in real data (job history showed "(unknown)").
    expect(realCustomerName('(unknown)')).toBe('');
    expect(realCustomerName('[Unknown]')).toBe('');
    expect(realCustomerName('Unknown Customer')).toBe('');
    expect(realCustomerName('unknown caller')).toBe('');
    expect(realCustomerName('no name')).toBe('');
    expect(realCustomerName('N/A')).toBe('');
    expect(realCustomerName('null')).toBe('');
  });
  it('preserves real names with punctuation', () => {
    expect(realCustomerName("O'Brien")).toBe("O'Brien");
    expect(realCustomerName('John D.')).toBe('John D.');
  });
});
