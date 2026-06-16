// tests/serviceCitiesAndTagline.spec.ts
// Run: npx vitest run tests/serviceCitiesAndTagline.spec.ts
//
// Service-cities normalization + brand-default coalescing (tagline + the
// pre-populated service area) + the invoice tagline decision.

import { describe, it, expect } from 'vitest';
import { titleCaseCity, normalizeServiceCities } from '@/lib/locations';
import { resolveBrandDefaults, DEFAULT_BRAND, DEFAULT_SERVICE_CITIES } from '@/lib/defaults';
import { invoiceTaglineFor } from '@/lib/invoice';
import type { Brand } from '@/types';

describe('titleCaseCity', () => {
  it('title-cases and trims', () => {
    expect(titleCaseCity('  miami gardens ')).toBe('Miami Gardens');
    expect(titleCaseCity('NORTH MIAMI BEACH')).toBe('North Miami Beach');
    expect(titleCaseCity('hialeah')).toBe('Hialeah');
  });
  it('collapses inner whitespace', () => {
    expect(titleCaseCity('fort    lauderdale')).toBe('Fort Lauderdale');
  });
});

describe('normalizeServiceCities', () => {
  it('dedupes case-insensitively, first occurrence wins, order preserved', () => {
    expect(normalizeServiceCities(['Miami gardens', 'Miami Gardens', 'hialeah', 'Miami']))
      .toEqual(['Miami Gardens', 'Hialeah', 'Miami']);
  });
  it('drops blanks/whitespace entries', () => {
    expect(normalizeServiceCities(['Miami', '  ', '', 'Doral'])).toEqual(['Miami', 'Doral']);
  });
  it('handles null/undefined', () => {
    expect(normalizeServiceCities(null)).toEqual([]);
    expect(normalizeServiceCities(undefined)).toEqual([]);
  });
});

describe('resolveBrandDefaults', () => {
  const base = (over: Partial<Brand>): Brand => ({ ...DEFAULT_BRAND, ...over });

  it('blank tagline coalesces to "We rush. You roll."', () => {
    expect(resolveBrandDefaults(base({ tagline: '' })).tagline).toBe('We rush. You roll.');
    expect(resolveBrandDefaults(base({ tagline: '   ' })).tagline).toBe('We rush. You roll.');
    expect(DEFAULT_BRAND.tagline).toBe('We rush. You roll.');
  });
  it('a custom tagline is preserved', () => {
    expect(resolveBrandDefaults(base({ tagline: 'Fast & flat-free' })).tagline).toBe('Fast & flat-free');
  });
  it('empty service cities coalesce to the real service area (23 cities)', () => {
    const r = resolveBrandDefaults(base({ serviceCities: [] }));
    expect(r.serviceCities).toEqual(DEFAULT_SERVICE_CITIES);
    expect(r.serviceCities).toHaveLength(23);
    expect(r.serviceCities).toContain('Fort Lauderdale');
    expect(r.serviceCities).toContain('Brickell');
  });
  it('a custom service-cities list is preserved', () => {
    const r = resolveBrandDefaults(base({ serviceCities: ['Tampa'] }));
    expect(r.serviceCities).toEqual(['Tampa']);
  });
});

describe('invoiceTaglineFor', () => {
  const brand = { ...DEFAULT_BRAND, tagline: 'We rush. You roll.' } as Brand;
  it('renders the tagline on Pro', () => {
    expect(invoiceTaglineFor(brand, true)).toBe('We rush. You roll.');
  });
  it('is blank on Core (white-label is Pro-only)', () => {
    expect(invoiceTaglineFor(brand, false)).toBe('');
  });
  it('is blank when no tagline is set', () => {
    expect(invoiceTaglineFor({ ...DEFAULT_BRAND, tagline: '' } as Brand, true)).toBe('');
  });
});
