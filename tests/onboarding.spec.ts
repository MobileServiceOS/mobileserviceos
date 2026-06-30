// tests/onboarding.spec.ts
// Run: npx vitest run tests/onboarding.spec.ts
//
// Pure helpers behind the Onboarding wizard — service-city parsing, the
// serviceArea label, required-field validation, and per-step "Continue"
// gating. Extracted so the two save paths can't drift and the rules are
// pinned.

import { describe, it, expect } from 'vitest';
import {
  parseServiceCities, buildServiceArea, validateOnboarding, canAdvanceFromStep, MAX_BUSINESS_NAME,
} from '@/lib/onboarding';

describe('parseServiceCities', () => {
  it('splits on commas, trims, drops empties', () => {
    expect(parseServiceCities(' Hollywood,  Hialeah ,, Miramar ')).toEqual(['Hollywood', 'Hialeah', 'Miramar']);
  });
  it('empty / whitespace-only → []', () => {
    expect(parseServiceCities('')).toEqual([]);
    expect(parseServiceCities('  , ,')).toEqual([]);
  });
});

describe('buildServiceArea', () => {
  it('lists up to 3 cities with the state', () => {
    expect(buildServiceArea(['Hollywood', 'Hialeah', 'Miramar', 'Davie'], 'West Park', 'FL'))
      .toBe('Hollywood · Hialeah · Miramar, FL');
  });
  it('falls back to the main city when no cities listed', () => {
    expect(buildServiceArea([], 'West Park', 'FL')).toBe('West Park, FL');
  });
  it('omits the state when blank', () => {
    expect(buildServiceArea([], 'West Park', '')).toBe('West Park');
  });
});

describe('validateOnboarding', () => {
  it('passes with name + state + city', () => {
    expect(validateOnboarding({ businessName: 'Wheel Rush', stateCode: 'FL', mainCity: 'West Park' })).toBeNull();
  });
  it('requires a business name → step 1', () => {
    expect(validateOnboarding({ businessName: '   ', stateCode: 'FL', mainCity: 'West Park' })?.step).toBe(1);
  });
  it('caps the business name length → step 1', () => {
    expect(validateOnboarding({ businessName: 'x'.repeat(MAX_BUSINESS_NAME + 1), stateCode: 'FL', mainCity: 'X' })?.step).toBe(1);
  });
  it('requires state + main city → step 2', () => {
    expect(validateOnboarding({ businessName: 'Wheel Rush', stateCode: '', mainCity: 'West Park' })?.step).toBe(2);
    expect(validateOnboarding({ businessName: 'Wheel Rush', stateCode: 'FL', mainCity: ' ' })?.step).toBe(2);
  });
});

describe('canAdvanceFromStep', () => {
  const ok = { businessName: 'Wheel Rush', stateCode: 'FL', mainCity: 'West Park' };
  it('step 1 needs a non-empty (and not over-long) name', () => {
    expect(canAdvanceFromStep(1, ok)).toBe(true);
    expect(canAdvanceFromStep(1, { ...ok, businessName: '' })).toBe(false);
    expect(canAdvanceFromStep(1, { ...ok, businessName: 'x'.repeat(MAX_BUSINESS_NAME + 1) })).toBe(false);
  });
  it('step 2 needs state + city', () => {
    expect(canAdvanceFromStep(2, ok)).toBe(true);
    expect(canAdvanceFromStep(2, { ...ok, stateCode: '' })).toBe(false);
    expect(canAdvanceFromStep(2, { ...ok, mainCity: '' })).toBe(false);
  });
  it('later steps are always advanceable', () => {
    const empty = { businessName: '', stateCode: '', mainCity: '' };
    expect(canAdvanceFromStep(3, empty)).toBe(true);
    expect(canAdvanceFromStep(4, empty)).toBe(true);
  });
});
