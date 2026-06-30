// tests/legalRoute.spec.ts
// Run: npx vitest run tests/legalRoute.spec.ts
//
// The /privacy + /terms (and ?legal=) resolution that lets the App Store
// privacy URL render login-free.

import { describe, it, expect } from 'vitest';
import { legalTabFromLocation } from '@/lib/legalRoute';

describe('legalTabFromLocation', () => {
  it('resolves the clean /privacy path (the App Store URL)', () => {
    expect(legalTabFromLocation('/privacy', '')).toBe('privacy');
    expect(legalTabFromLocation('/privacy/', '')).toBe('privacy'); // trailing slash
    expect(legalTabFromLocation('/PRIVACY', '')).toBe('privacy');  // case-insensitive
  });
  it('resolves the clean /terms path', () => {
    expect(legalTabFromLocation('/terms', '')).toBe('terms');
  });
  it('resolves the ?legal= query form', () => {
    expect(legalTabFromLocation('/', '?legal=privacy')).toBe('privacy');
    expect(legalTabFromLocation('/', '?legal=terms')).toBe('terms');
  });
  it('returns null for the app root and unrelated paths', () => {
    expect(legalTabFromLocation('/', '')).toBeNull();
    expect(legalTabFromLocation('/dashboard', '')).toBeNull();
    expect(legalTabFromLocation('/', '?legal=bogus')).toBeNull();
  });
});
