import { SERVICE_PHRASES } from '@/lib/defaults';

/**
 * Review-request SMS generation.
 *
 * Why this exists: the SMS body is the single highest-leverage piece of copy
 * for a mobile tire/roadside business. Each review that mentions the service
 * + city/state strengthens local SEO and AI-search relevance (e.g. "mobile
 * tire repair Hollywood FL"). The message must be human, varied, and never
 * sound templated — so this module ships multiple natural-language templates
 * and rotates between them deterministically per customer.
 *
 * Design rules:
 *   • Always include business name, service, and a city/state mention
 *   • Never keyword-stuff or read like an SEO ad
 *   • Encourage *natural* mention of the service & location, don't dictate it
 *   • Rotate templates by hashing the customer's phone, so a given customer
 *     gets the same template if asked twice, but a business sending to many
 *     customers gets variety across recipients
 */

interface ResolvedTemplateInput {
  customerName: string;
  service: string;
  city: string;
  state: string;
  brandName: string;
  url: string;
}

// Internal: produce the resolved template params from raw inputs
interface ResolvedParams {
  greet: string;
  brandName: string;
  service: string;
  location: string; // "City, ST" or "City" or fallback
  cityOnly: string; // bare city if available
  convenience: string;
  url: string;
}

/** Templates are pure functions over the resolved params. */
const TEMPLATES: Array<(p: ResolvedParams) => string> = [
  // 1. Service + city/state mention, gentle ask
  (p) => `${p.greet} thanks for choosing ${p.brandName} for your ${p.service} in ${p.location}. ` +
    `If you have a moment, a quick review mentioning your experience with our ${p.convenience} would really help other drivers in ${p.cityOnly || p.location} find us:\n\n${p.url}`,

  // 2. Convenience-first framing — appeals to roadside/mobile context
  (p) => `${p.greet} appreciate you trusting ${p.brandName} with your ${p.service} today. ` +
    `Quick favor: would you mind leaving a short review about the ${p.convenience} in ${p.location}? It really helps fellow drivers needing reliable help nearby:\n\n${p.url}`,

  // 3. Direct local-discovery framing
  (p) => `${p.greet} thanks again for the ${p.service} in ${p.location}. ` +
    `A quick Google review — even one sentence about how ${p.brandName} handled it on-site — goes a long way for a local business like ours:\n\n${p.url}`,

  // 4. Conversational / no preamble, story-friendly
  (p) => `${p.greet} hope the truck's rolling smooth. If you've got 30 seconds, would you drop us a quick review about today's ${p.service}? ` +
    `Mentioning ${p.brandName} and ${p.location} helps the next driver find us when they're stuck:\n\n${p.url}`,

  // 5. Gratitude-first with soft local hook
  (p) => `${p.greet} thank you for choosing ${p.brandName}. ` +
    `If our ${p.convenience} in ${p.location} made things easier for you today, a quick review about your experience would mean a lot:\n\n${p.url}`,
];

function resolveConvenience(service: string): string {
  const s = (service || '').toLowerCase();
  if (s.includes('roadside')) return 'roadside tire service';
  if (s.includes('fleet') || s.includes('commercial')) return 'mobile fleet tire service';
  if (s.includes('heavy') || s.includes('semi')) return 'heavy-duty mobile tire service';
  if (s.includes('flat')) return 'mobile flat tire repair';
  if (s.includes('install') || s.includes('mount') || s.includes('balanc')) return 'mobile tire installation';
  if (s.includes('replace')) return 'mobile tire replacement';
  return 'mobile tire service';
}

function resolveLocation(city: string, state: string): { location: string; cityOnly: string } {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (c && s) return { location: `${c}, ${s}`, cityOnly: c };
  if (c) return { location: c, cityOnly: c };
  if (s) return { location: s, cityOnly: '' };
  return { location: 'your area', cityOnly: '' };
}

/**
 * Pick a template index deterministically from a seed string so a given
 * customer always sees the same template even if the request is retried,
 * but different customers get variety. djb2 hash — cheap and good enough.
 */
function pickTemplateIndex(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % TEMPLATES.length;
}

function parseLegacyLocation(location: string): { city: string; state: string } {
  // Accept "City, ST" or plain "City" — split only on the LAST comma
  // so we don't trip on city names that contain commas (rare but real).
  const trimmed = (location || '').trim();
  const idx = trimmed.lastIndexOf(',');
  if (idx === -1) return { city: trimmed, state: '' };
  return {
    city: trimmed.slice(0, idx).trim(),
    state: trimmed.slice(idx + 1).trim(),
  };
}

/**
 * Public API — preserves legacy 6-arg signature plus optional 7th state arg.
 * Internally normalizes inputs and picks a rotating template.
 */
export function buildReviewMsg(
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string
): string {
  const name = (customerName || '').trim();
  const greet = name ? 'Hi ' + name + ',' : 'Hi,';
  const svc = SERVICE_PHRASES[service] || (service ? service.toLowerCase() : 'tire service');

  // If state was passed explicitly, prefer it; otherwise try to parse "City, ST"
  // out of the legacy `location` arg.
  let city = '';
  let stateCode = (state || '').trim();
  if (stateCode) {
    city = (location || '').trim();
  } else {
    const parsed = parseLegacyLocation(location || '');
    city = parsed.city;
    stateCode = parsed.state;
  }
  if ((city === 'your area' || !city) && !stateCode) {
    city = '';
    stateCode = '';
  }

  const { location: loc, cityOnly } = resolveLocation(city, stateCode);
  const convenience = resolveConvenience(service);

  // Seed rotation by customer name + phone-y bits. We don't have phone in scope
  // here, so we use the brand+service+location+name combo, which gives stable
  // per-customer variety across an SMB's send volume.
  const seed = (name + '|' + (brandName || '') + '|' + service + '|' + loc).toLowerCase();
  const idx = pickTemplateIndex(seed);

  const resolved: ResolvedParams = {
    greet,
    brandName: brandName || 'our team',
    service: svc,
    location: loc,
    cityOnly,
    convenience,
    url: url || '',
  };

  return TEMPLATES[idx](resolved);
}

export function openReviewSMS(
  phone: string,
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string
): void {
  const msg = encodeURIComponent(buildReviewMsg(url, customerName, service, location, brandName, state));
  const ph = (phone || '').replace(/\D/g, '');
  window.open(ph ? `sms:${ph}?body=${msg}` : `sms:?body=${msg}`);
}

// ── Internal helpers exposed for tests / preview, not load-bearing ────
export function _previewAllTemplates(params: ResolvedTemplateInput): string[] {
  const name = (params.customerName || '').trim();
  const greet = name ? 'Hi ' + name + ',' : 'Hi,';
  const svc = SERVICE_PHRASES[params.service] || (params.service ? params.service.toLowerCase() : 'tire service');
  const { location, cityOnly } = resolveLocation(params.city, params.state);
  const convenience = resolveConvenience(params.service);
  const resolved: ResolvedParams = {
    greet,
    brandName: params.brandName || 'our team',
    service: svc,
    location,
    cityOnly,
    convenience,
    url: params.url || '',
  };
  return TEMPLATES.map((t) => t(resolved));
}
