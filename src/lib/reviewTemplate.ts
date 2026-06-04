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
