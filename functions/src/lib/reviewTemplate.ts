// functions/src/lib/reviewTemplate.ts
// ═══════════════════════════════════════════════════════════════════
//  reviewTemplate — pure renderer (functions-side mirror).
//
//  Byte-identical to src/lib/reviewTemplate.ts (modulo this header).
//  Tests enforce identity. If you edit one, edit the other.
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

function _stripEmptyConnectives(template: string, vars: TemplateVars): string {
  let out = template;
  if (!vars.city?.trim())     out = out.replace(/ in \{city\}/g, '');
  if (!vars.vehicle?.trim())  out = out.replace(/ for your \{vehicle\}/g, '');
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
