// src/lib/onboarding.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers behind the Onboarding wizard. Extracted from the
//  component so the logic is unit-testable and the two save paths
//  (per-step persistPartial + final finish) can't drift apart.
// ═══════════════════════════════════════════════════════════════════

/** A business name longer than this breaks headers, tabs, and the invoice
 *  PDF layout — and 80 is well above any legitimate name. */
export const MAX_BUSINESS_NAME = 80;

/** Split the comma-separated "other service cities" field into a clean,
 *  trimmed, empties-removed list. */
export function parseServiceCities(text: string): string[] {
  return (text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build the human-readable serviceArea label written to the brand:
 *  "Hollywood · Hialeah · Miramar, FL" when cities are listed, else
 *  "West Park, FL" from the main city. Caps the listed cities at 3. */
export function buildServiceArea(
  serviceCities: ReadonlyArray<string>,
  mainCity: string,
  stateCode: string,
): string {
  const st = (stateCode || '').trim();
  const suffix = st ? `, ${st}` : '';
  if (serviceCities.length) {
    return serviceCities.slice(0, 3).join(' · ') + suffix;
  }
  return `${(mainCity || '').trim()}${suffix}`;
}

export interface OnboardingRequiredFields {
  businessName: string;
  stateCode: string;
  mainCity: string;
}

/** First blocking problem in the required fields, with the step to jump
 *  to so the operator can fix it — or null when everything required is
 *  present. Used both to gate "Continue" per step and to guard finish(). */
export function validateOnboarding(f: OnboardingRequiredFields): { message: string; step: 1 | 2 } | null {
  const name = (f.businessName || '').trim();
  if (!name) return { message: 'Business name required', step: 1 };
  if (name.length > MAX_BUSINESS_NAME) {
    return { message: `Business name is too long (max ${MAX_BUSINESS_NAME} characters)`, step: 1 };
  }
  if (!f.stateCode || !(f.mainCity || '').trim()) {
    return { message: 'State and main city required', step: 2 };
  }
  return null;
}

/** Can the operator advance past the given step? Gates "Continue" so
 *  required fields are filled before moving on (step 1 = business name,
 *  step 2 = state + main city). Other steps have no required fields. */
export function canAdvanceFromStep(step: number, f: OnboardingRequiredFields): boolean {
  if (step === 1) {
    const name = (f.businessName || '').trim();
    return name.length > 0 && name.length <= MAX_BUSINESS_NAME;
  }
  if (step === 2) {
    return !!f.stateCode && !!(f.mainCity || '').trim();
  }
  return true;
}
