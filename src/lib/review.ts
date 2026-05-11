import { SERVICE_PHRASES } from '@/lib/defaults';

/**
 * Review-request SMS generation for the multi-tenant Mobile Service OS SaaS.
 *
 * Critical rules:
 *   • NEVER hardcode any tenant's business name. The brand string is always
 *     supplied by the caller and originates from businesses/{uid}/settings/main.
 *   • When the brand is missing, fall back to the generic phrase
 *     "our mobile tire service" — chosen because it reads naturally in every
 *     template both as a subject ("our mobile tire service helped...") and
 *     as an object ("choosing our mobile tire service today").
 *   • Encourage natural local-SEO mentions (service, city, state) without
 *     reading like a templated marketing blast.
 *   • Never produce malformed locations like "FL, FL" or "Sunrise, FL, FL".
 *   • Keep messages concise enough to fit in a single SMS preview.
 */

// ── Location normalization ──────────────────────────────────────

const STATE_NAME_TO_CODE: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'district of columbia': 'DC', 'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI',
  'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME',
  'maryland': 'MD', 'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
  'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE',
  'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX',
  'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
};

const VALID_STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

function normalizeStateCode(input: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  if (s.length === 2) {
    const up = s.toUpperCase();
    return VALID_STATE_CODES.has(up) ? up : '';
  }
  const code = STATE_NAME_TO_CODE[s.toLowerCase()];
  return code || '';
}

interface LocationParts { city: string; state: string }

/**
 * Combine raw `location` (may already contain state) and raw `state` inputs
 * into a single canonical { city, state } pair. Handles all the messy cases:
 *   ("Sunrise, FL", "FL")    → { city: "Sunrise", state: "FL" }   ← previously bugged
 *   ("Sunrise, Florida", "") → { city: "Sunrise", state: "FL" }
 *   ("Miami", "FL")          → { city: "Miami",   state: "FL" }
 *   ("", "FL")               → { city: "",        state: "FL" }
 *   ("your area", "")        → { city: "",        state: "" }
 */
function parseLocation(location: string, state: string): LocationParts {
  const stateCode = normalizeStateCode(state);
  const raw = (location || '').trim();
  if (!raw || raw.toLowerCase() === 'your area') {
    return { city: '', state: stateCode };
  }
  const lastComma = raw.lastIndexOf(',');
  if (lastComma >= 0) {
    const left = raw.slice(0, lastComma).trim();
    const right = raw.slice(lastComma + 1).trim();
    const rightAsCode = normalizeStateCode(right);
    if (rightAsCode) return { city: left, state: rightAsCode };
    return { city: raw, state: stateCode };
  }
  return { city: raw, state: stateCode };
}

interface DisplayLocation { full: string; cityOnly: string }
function displayLocation(parts: LocationParts): DisplayLocation {
  if (parts.city && parts.state) return { full: `${parts.city}, ${parts.state}`, cityOnly: parts.city };
  if (parts.city) return { full: parts.city, cityOnly: parts.city };
  if (parts.state) return { full: parts.state, cityOnly: '' };
  return { full: '', cityOnly: '' };
}

// ── Service phrasing ────────────────────────────────────────────

function naturalServicePhrase(service: string): string {
  if (!service) return 'tire service';
  if (SERVICE_PHRASES[service]) return SERVICE_PHRASES[service];
  const lc = service.toLowerCase();
  return lc.includes('tire') ? lc : lc + ' service';
}

function conveniencePhrase(service: string): string {
  const s = (service || '').toLowerCase();
  if (s.includes('roadside')) return 'roadside tire service';
  if (s.includes('fleet') || s.includes('commercial')) return 'mobile fleet tire service';
  if (s.includes('heavy') || s.includes('semi')) return 'heavy-duty mobile tire service';
  if (s.includes('flat')) return 'mobile flat tire repair';
  if (s.includes('install') || s.includes('mount') || s.includes('balanc')) return 'mobile tire installation';
  if (s.includes('replace')) return 'mobile tire replacement';
  if (s.includes('spare')) return 'mobile tire service';
  return 'mobile tire service';
}

// ── Templates ───────────────────────────────────────────────────
//
// Each template uses `brandRef` which transparently picks the tenant's brand
// or the generic fallback "our mobile tire service". Templates are designed
// to read naturally in BOTH modes — try reading each one twice, once with a
// real tenant name and once with the fallback phrase, to verify the grammar
// holds. The phrasing is deliberately neutral on that axis.

const BRAND_FALLBACK = 'our mobile tire service';

interface ResolvedParams {
  greet: string;         // "Hi Mike,"  or  "Hi,"
  brandRef: string;      // tenant name OR "our mobile tire service"
  hasBrand: boolean;     // true if a real tenant name was supplied
  service: string;       // "flat tire repair"
  convenience: string;   // "mobile flat tire repair"
  fullLocation: string;  // "Hollywood, FL" / "Hollywood" / ""
  cityOnly: string;      // "Hollywood" / ""
  url: string;
}

function inLoc(p: ResolvedParams): string {
  return p.fullLocation ? ' in ' + p.fullLocation : '';
}
function inCity(p: ResolvedParams): string {
  return p.cityOnly ? ' in ' + p.cityOnly : '';
}

const TEMPLATES: Array<(p: ResolvedParams) => string> = [
  // 1. Gratitude-first, service + location mention
  (p) =>
    `${p.greet} thanks for choosing ${p.brandRef} today. ` +
    `If you have a moment, we'd really appreciate a quick review about your ${p.service}${inLoc(p)}. ` +
    `It helps other local drivers find reliable mobile tire help.\n\n${p.url}`,

  // 2. Short and direct
  (p) =>
    `${p.greet} thanks again for choosing ${p.brandRef} for your ${p.service}${inLoc(p)}. ` +
    `A quick review sharing your experience would mean a lot to our business.\n\n${p.url}`,

  // 3. Convenience-framed (without "rolling smooth" or other cheese)
  (p) =>
    `${p.greet} we really appreciate you choosing ${p.brandRef} today. ` +
    `If you have a moment, a short review about your experience with our ${p.convenience}${inCity(p)} would help other local drivers find us when they need help.\n\n${p.url}`,

  // 4. Local-discovery framing
  (p) =>
    `${p.greet} thanks for the ${p.service} today. ` +
    `A short Google review${inCity(p) ? ' about your experience' + inCity(p) : ' about your experience'} would help other drivers nearby find ${p.brandRef} when they need mobile tire help.\n\n${p.url}`,

  // 5. Low-friction ask
  (p) =>
    `${p.greet} thank you for choosing ${p.brandRef}. ` +
    `If our ${p.convenience}${inLoc(p)} made things easier today, we'd really appreciate a quick review about your experience.\n\n${p.url}`,
];

// ── Deterministic rotation ──────────────────────────────────────

function pickTemplateIndex(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % TEMPLATES.length;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Build a review-request SMS body for a given tenant.
 *
 * @param url         The review URL (from businessSettings.reviewUrl)
 * @param customerName Customer's name (used in greeting)
 * @param service     Service name from the job (e.g. "Flat Tire Repair")
 * @param location    The job's city, or fullLocationLabel like "Sunrise, FL"
 * @param brandName   The TENANT's business name from businessSettings.businessName
 * @param state       Optional 2-letter state code (e.g. "FL")
 *
 * If brandName is empty, all template references degrade to the generic
 * "our mobile tire service" — they never leak a hardcoded tenant name.
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
  const greet = name ? `Hi ${name},` : 'Hi,';

  const trimmedBrand = (brandName || '').trim();
  const hasBrand = trimmedBrand.length > 0;
  const brandRef = hasBrand ? trimmedBrand : BRAND_FALLBACK;

  const parts = parseLocation(location, state || '');
  const display = displayLocation(parts);

  const resolved: ResolvedParams = {
    greet,
    brandRef,
    hasBrand,
    service: naturalServicePhrase(service),
    convenience: conveniencePhrase(service),
    fullLocation: display.full,
    cityOnly: display.cityOnly,
    url: (url || '').trim(),
  };

  // Stable seed for per-customer rotation.
  const seed = (name + '|' + trimmedBrand + '|' + service + '|' + display.full).toLowerCase();
  const idx = pickTemplateIndex(seed);

  let msg = TEMPLATES[idx](resolved);
  // Cleanup: collapse spaces, fix " ." / " ," from any conditionally dropped phrases
  msg = msg.replace(/ {2,}/g, ' ').replace(/ \./g, '.').replace(/ ,/g, ',').replace(/\.\./g, '.');
  return msg;
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

// ── Test helper (not load-bearing) ──────────────────────────────

interface ResolvedTemplateInput {
  customerName: string;
  service: string;
  city: string;
  state: string;
  brandName: string;
  url: string;
}

export function _previewAllTemplates(input: ResolvedTemplateInput): string[] {
  const name = (input.customerName || '').trim();
  const greet = name ? `Hi ${name},` : 'Hi,';
  const trimmedBrand = (input.brandName || '').trim();
  const hasBrand = trimmedBrand.length > 0;
  const brandRef = hasBrand ? trimmedBrand : BRAND_FALLBACK;
  const parts = parseLocation(input.city, input.state);
  const display = displayLocation(parts);
  const resolved: ResolvedParams = {
    greet, brandRef, hasBrand,
    service: naturalServicePhrase(input.service),
    convenience: conveniencePhrase(input.service),
    fullLocation: display.full,
    cityOnly: display.cityOnly,
    url: (input.url || '').trim(),
  };
  return TEMPLATES.map((t) => {
    let m = t(resolved);
    m = m.replace(/ {2,}/g, ' ').replace(/ \./g, '.').replace(/ ,/g, ',').replace(/\.\./g, '.');
    return m;
  });
}
