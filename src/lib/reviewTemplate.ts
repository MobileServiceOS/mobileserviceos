// src/lib/reviewTemplate.ts
// ═══════════════════════════════════════════════════════════════════
//  reviewTemplate — pure renderer for the SMS template engine.
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"Template engine", §"Smart-empty stripping (addition #3)"
//
//  7 placeholders, smart-empty stripping for connective phrases that
//  would produce broken grammar when a variable is empty. Unknown
//  placeholders are left literal so operators see their typos.
//
//  Mirror: functions/src/lib/reviewTemplate.ts (byte-identical aside
//  from this header). Tests enforce identity.
// ═══════════════════════════════════════════════════════════════════

export interface TemplateVars {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  serviceType?: string;
  city?: string;
  vehicle?: string;
  reviewLink?: string;
}

const KNOWN_KEYS: ReadonlyArray<keyof TemplateVars> = [
  'firstName', 'lastName', 'businessName', 'serviceType',
  'city', 'vehicle', 'reviewLink',
];

// Connective-strip patterns run BEFORE placeholder substitution, so
// they can target the literal "{city}" / "{vehicle}" / "{lastName}"
// tokens in the template. Each pattern removes the connective phrase
// (preposition + space) only when its variable is empty/whitespace.
function _stripEmptyConnectives(template: string, vars: TemplateVars): string {
  let out = template;
  if (!vars.city?.trim())     out = out.replace(/ in \{city\}/g, '');
  if (!vars.vehicle?.trim())  out = out.replace(/ for your \{vehicle\}/g, '');
  // Trailing-space-before-lastName covers the "{firstName} {lastName}"
  // adjacency. Standalone "{lastName}" with no leading space falls
  // through to normal substitution → empty string.
  if (!vars.lastName?.trim()) out = out.replace(/ \{lastName\}/g, '');
  return out;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const stripped = _stripEmptyConnectives(template, vars);
  return stripped.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    if (!(KNOWN_KEYS as ReadonlyArray<string>).includes(key)) return match;
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? '';
  });
}

/**
 * Server-side auto-text review-request rotation pool. Used as the
 * fallback when the operator's saved settings.reviewSmsTemplate is
 * empty — picks one at random per send so consecutive customers do
 * not receive byte-identical SMS bodies.
 *
 * All five variants:
 *   - Use the same placeholder set: {firstName}, {businessName},
 *     {serviceType}, {city}, {reviewLink}
 *   - Include local-SEO terms (service + city + business name)
 *   - Read naturally with the existing smart-empty stripping
 *     ("in {city}", " for your {vehicle}", " {lastName}")
 *   - Sized to fit two SMS segments worst-case
 *
 * Wheel Rush operator approved variant 1 verbatim 2026-06-05; the
 * remaining four are tone-varied riffs on the same structure so
 * SEO + CTA stay consistent across sends.
 */
export const DEFAULT_REVIEW_TEMPLATES: ReadonlyArray<string> = [
  // V1 — operator's exact spec (gratitude + local SEO + social proof tail)
  `Hi {firstName}, thank you for choosing {businessName} for your {serviceType} service in {city}. If you were happy with the service today, we'd appreciate a quick Google review:

{reviewLink}

Your feedback helps other drivers find reliable mobile tire service when they need it most.`,

  // V2 — gratitude-forward, 5-star framing
  `{firstName}, thanks for trusting {businessName} with your {serviceType} in {city} today. If we earned a 5-star experience, would you share it on Google?

{reviewLink}

It helps drivers nearby find honest mobile tire help when they need it most.`,

  // V3 — community / local-business framing
  `Hi {firstName}, it was great helping you with your {serviceType} in {city} today. {businessName} grows through reviews from customers like you:

{reviewLink}

Thanks for supporting local mobile tire service.`,

  // V4 — professional / concise opener
  `Thanks for choosing {businessName} for {serviceType} in {city}, {firstName}. If you had a great experience, please consider a Google review:

{reviewLink}

Your review helps neighbors find reliable mobile tire repair when they need it most.`,

  // V5 — warm / personal, no tail line (shortest variant)
  `Hey {firstName}, thanks again for trusting {businessName} for your {serviceType} in {city}. We work hard to deliver fast, honest mobile tire service — if today met that bar, would you leave a quick Google review?

{reviewLink}`,
] as const;

/**
 * Pick one of the DEFAULT_REVIEW_TEMPLATES at random.
 *
 * Caller can inject a deterministic RNG (e.g. seeded prng) for tests
 * or per-job idempotency. Default is Math.random.
 */
export function pickReviewTemplate(rng: () => number = Math.random): string {
  const idx = Math.floor(rng() * DEFAULT_REVIEW_TEMPLATES.length);
  return DEFAULT_REVIEW_TEMPLATES[idx];
}
