import { SERVICE_PHRASES } from '@/lib/defaults';

/**
 * Review-request SMS generation.
 *
 * Goals:
 *   • Sound natural and human-written, not templated
 *   • Reliably include business name + service + city (and optionally state)
 *   • Encourage natural local-SEO mentions without keyword stuffing
 *   • Never produce malformed locations ("FL, FL", "Sunrise, FL, FL")
 *   • Stay concise and mobile-friendly (most templates ~250-320 chars before URL)
 *
 * Inputs are normalized aggressively because callers pass mixed shapes:
 *   • location may be "City", "City, ST", "City, State", or empty
 *   • state may be empty, a 2-letter code, or a full state name
 *   • brandName may be empty (we degrade gracefully without "our team")
 */

// ── Location normalization ──────────────────────────────────────
// Parses any reasonable location input into clean { city, state } parts.
// State is normalized to a 2-letter uppercase code when recognizable.

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
  // 2-letter code?
  if (s.length === 2) {
    const up = s.toUpperCase();
    return VALID_STATE_CODES.has(up) ? up : '';
  }
  // Full name?
  const code = STATE_NAME_TO_CODE[s.toLowerCase()];
  return code || '';
}

interface LocationParts {
  city: string;
  state: string; // 2-letter code or '' if unknown
}

/**
 * Combine raw `location` (may already contain state) and raw `state` inputs
 * into a single canonical { city, state } pair. Handles all the messy cases:
 *   ("Sunrise, FL", "FL")    → { city: "Sunrise", state: "FL" }   ← was bugged
 *   ("Sunrise, FL", "")      → { city: "Sunrise", state: "FL" }
 *   ("Sunrise", "FL")        → { city: "Sunrise", state: "FL" }
 *   ("Sunrise, Florida", "") → { city: "Sunrise", state: "FL" }
 *   ("Miami Beach, FL", "")  → { city: "Miami Beach", state: "FL" }
 *   ("", "FL")               → { city: "", state: "FL" }
 *   ("your area", "")        → { city: "", state: "" }
 */
function parseLocation(location: string, state: string): LocationParts {
  const stateCode = normalizeStateCode(state);
  const raw = (location || '').trim();

  // Sentinels that mean "no location"
  if (!raw || raw.toLowerCase() === 'your area') {
    return { city: '', state: stateCode };
  }

  // If location contains a comma, split on the LAST one — that's the
  // city/state separator (works even for "St. Louis, MO" and similar).
  const lastComma = raw.lastIndexOf(',');
  if (lastComma >= 0) {
    const left = raw.slice(0, lastComma).trim();
    const right = raw.slice(lastComma + 1).trim();
    const rightAsCode = normalizeStateCode(right);
    if (rightAsCode) {
      // Left is the city, right resolved to a state. If a state arg was also
      // passed and disagrees, prefer the explicit state arg only when the
      // parsed one didn't resolve. Here both resolved, so keep parsed.
      return { city: left, state: rightAsCode };
    }
    // Right side didn't resolve to a state code — treat the whole thing
    // as a multi-part city ("Winston-Salem, NC" still works above, but
    // "St. Mary's Parish" with no state lands here).
    return { city: raw, state: stateCode };
  }

  // No comma: location is just a city.
  return { city: raw, state: stateCode };
}

interface DisplayLocation {
  full: string;    // "City, ST" or "City" or "" — for in-body mentions
  cityOnly: string; // bare city for tighter phrasing
}

function displayLocation(parts: LocationParts): DisplayLocation {
  if (parts.city && parts.state) {
    return { full: `${parts.city}, ${parts.state}`, cityOnly: parts.city };
  }
  if (parts.city) return { full: parts.city, cityOnly: parts.city };
  if (parts.state) return { full: parts.state, cityOnly: '' };
  return { full: '', cityOnly: '' };
}

// ── Service phrasing ────────────────────────────────────────────
// SERVICE_PHRASES handles known services. For unknown ones we fall back to
// a generic phrase rather than awkwardly lowercasing service names like
// "Heavy-Duty Tire Service" → "heavy-duty tire service" which can read oddly.

function naturalServicePhrase(service: string): string {
  if (!service) return 'tire service';
  if (SERVICE_PHRASES[service]) return SERVICE_PHRASES[service];
  // Reasonable fallback for unknown services
  const lc = service.toLowerCase();
  if (lc.includes('tire')) return lc;
  return lc + ' service';
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
// Each template is a function over ResolvedParams. We use *small builders*
// inside so we can drop phrases entirely when data is missing (e.g. no city)
// rather than producing awkward "...in your area." filler.

interface ResolvedParams {
  greet: string;          // "Hi Mike,"  or  "Hi,"
  brandName: string;      // "Wheel Rush" — empty falls back inline
  service: string;        // "flat tire repair"  (lowercase, natural)
  convenience: string;    // "mobile flat tire repair", "roadside tire service", ...
  fullLocation: string;   // "Hollywood, FL"  or  "Hollywood"  or ""
  cityOnly: string;       // "Hollywood"  or  ""
  url: string;
}

/** "in [Location]" or "" — used inline without producing awkward gaps. */
function inLoc(p: ResolvedParams): string {
  return p.fullLocation ? ' in ' + p.fullLocation : '';
}
/** "in [City]" or "" — preferred when we want city alone in body copy. */
function inCity(p: ResolvedParams): string {
  return p.cityOnly ? ' in ' + p.cityOnly : '';
}
/** Brand reference that degrades gracefully when the brand name is missing. */
function brand(p: ResolvedParams): string {
  return p.brandName || 'our team';
}
/** Brand reference for "choosing X" — drops the awkward "choosing our team". */
function chooseBrand(p: ResolvedParams): string {
  return p.brandName ? `choosing ${p.brandName}` : 'choosing us';
}

const TEMPLATES: Array<(p: ResolvedParams) => string> = [
  // 1. Direct, professional, service + city/state
  (p) =>
    `${p.greet} thanks again for ${chooseBrand(p)} for your ${p.service}${inLoc(p)}. ` +
    `If you have a quick moment, a short review about your experience would mean a lot to our business.\n\n${p.url}`,

  // 2. Warm gratitude + convenience-framed local hook
  (p) =>
    `${p.greet} we really appreciate you ${chooseBrand(p)} today. ` +
    `If you have a moment, we'd love a quick review about your experience with our ${p.convenience}${inCity(p)}. ` +
    `It helps other local drivers find reliable help when they need it.\n\n${p.url}`,

  // 3. Concise, professional, suited for follow-ups
  (p) =>
    `${p.greet} appreciate you ${chooseBrand(p)} for your ${p.service}${inLoc(p)}. ` +
    `If you have a moment, a short review sharing your experience would mean a lot.\n\n${p.url}`,

  // 4. Local-discovery framing without cheese
  (p) =>
    `${p.greet} thanks for trusting ${brand(p)} with your ${p.service} today. ` +
    `A quick Google review${inCity(p) ? ' mentioning your experience' + inCity(p) : ''} would help other drivers nearby find us when they need reliable tire help.\n\n${p.url}`,

  // 5. Short, low-friction ask
  (p) =>
    `${p.greet} thank you for ${chooseBrand(p)}. ` +
    `If our ${p.convenience}${inLoc(p)} made things easier today, we'd really appreciate a quick review about your experience.\n\n${p.url}`,
];

// ── Rotation ────────────────────────────────────────────────────
// Deterministic per-customer so retries don't spam variety, but different
// customers get different templates across an SMB's send volume.

function pickTemplateIndex(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % TEMPLATES.length;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Build a review-request SMS body.
 *
 * Signature preserved across earlier iterations:
 *   url, customerName, service, location, brandName, state?
 *
 * `location` may already include state ("Sunrise, FL"); if so, the explicit
 * `state` arg is ignored to avoid duplication.
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

  const parts = parseLocation(location, state || '');
  const display = displayLocation(parts);

  const resolved: ResolvedParams = {
    greet,
    brandName: (brandName || '').trim(),
    service: naturalServicePhrase(service),
    convenience: conveniencePhrase(service),
    fullLocation: display.full,
    cityOnly: display.cityOnly,
    url: (url || '').trim(),
  };

  // Rotate by a stable seed. Phone would be ideal but isn't in scope here,
  // so customer name + brand + service + location gives us decent spread.
  const seed = (name + '|' + resolved.brandName + '|' + service + '|' + display.full).toLowerCase();
  const idx = pickTemplateIndex(seed);

  let msg = TEMPLATES[idx](resolved);

  // Cleanup pass: collapse any double spaces, fix " ." artifacts from
  // conditionally-dropped phrases.
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

// ── Test helpers (not load-bearing) ─────────────────────────────

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
  const parts = parseLocation(input.city, input.state);
  const display = displayLocation(parts);
  const resolved: ResolvedParams = {
    greet,
    brandName: (input.brandName || '').trim(),
    service: naturalServicePhrase(input.service),
    convenience: conveniencePhrase(input.service),
    fullLocation: display.full,
    cityOnly: display.cityOnly,
    url: (input.url || '').trim(),
  };
  return TEMPLATES.map((t) => {
    let msg = t(resolved);
    msg = msg.replace(/ {2,}/g, ' ').replace(/ \./g, '.').replace(/ ,/g, ',').replace(/\.\./g, '.');
    return msg;
  });
}
