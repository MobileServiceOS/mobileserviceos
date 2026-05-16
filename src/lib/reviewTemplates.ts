// ═══════════════════════════════════════════════════════════════════
//  Mobile Service OS — Review Message Templates
// ═══════════════════════════════════════════════════════════════════
//
//  Generates concise, natural-sounding review-request messages that
//  vary by service type. Each template:
//    - Stays under ~250 chars before the link (mobile-friendly).
//    - Reads as one clean paragraph + a single newline before the URL.
//    - Mentions service + city naturally (local SEO without stuffing).
//    - Picks from 3–5 variants per service so messages don't feel
//      robotic across multiple customers.
//
//  Public API:
//    buildReviewMessage(opts)        — assemble a message string
//    pickReviewVariant(opts)         — return the template id picked
//                                       (useful for tests / A-B)
//    shareReviewMessage(opts, channel) — open SMS/iMessage/WhatsApp/
//                                         clipboard
//
//  Fallbacks:
//    - Missing customer name → "Hi there,"
//    - Missing service / unknown service → "your service"
//    - Missing city → "your area"
//    - Missing business name → "our team"
//    - Missing URL → message returned without link, caller can decide
//
//  Channels supported:
//    - 'sms'        → sms: scheme (auto-handled by iOS Messages app)
//    - 'imessage'   → sms:&body= (iMessage uses same handler on iOS)
//    - 'whatsapp'   → wa.me with body param
//    - 'clipboard'  → returns text; caller calls navigator.clipboard
//
//  All exported functions are pure when given a seed; randomness only
//  enters via `pickVariantIndex(undefined)`. Provide a seed (e.g.
//  job.id) for deterministic output — important for invoice replay,
//  tests, and "preview" UIs.
// ═══════════════════════════════════════════════════════════════════

/**
 * Service key as stored on jobs (matches DEFAULT_SERVICE_PRICING keys).
 * Unknown keys fall through to the generic template bucket.
 */
export type ServiceKey =
  | 'Flat Tire Repair'
  | 'Tire Replacement'
  | 'Tire Installation'
  | 'Mounting & Balancing'
  | 'Spare Tire Installation'
  | 'Spare Change'
  | 'Tire Rotation'
  | 'Wheel Lock Removal'
  | 'Roadside Tire Assistance'
  | 'Mobile Tire Service'
  | 'Jump Start'
  | 'Fuel Delivery'
  | 'Lockout'
  | 'Fleet Tire Service'
  | 'Heavy-Duty Tire Service'
  | string;

/**
 * Sharing channel. The message body is the same across channels; the
 * URL scheme and encoding differ.
 */
export type ShareChannel = 'sms' | 'imessage' | 'whatsapp' | 'clipboard';

export interface ReviewMessageOptions {
  /** Customer's first name (or full name — we'll use as-is, trimmed). */
  customerName?: string;
  /** Service performed — should be a key from SERVICE_PHRASES. */
  service?: ServiceKey;
  /** City. State is optional and appended only when present. */
  city?: string;
  state?: string;
  /** Pre-built location label (e.g. "Aventura, FL"). When provided,
   *  takes precedence over city/state. */
  locationLabel?: string;
  /** Business name from brand settings. Falls back to "our team". */
  businessName?: string;
  /** Google review URL. If empty/missing, message returns without
   *  a link line so callers can decide what to do. */
  reviewUrl?: string;
  /** Seed for variant selection. Pass `job.id` for deterministic
   *  output. Omit for random rotation. */
  seed?: string;
  /** Force a specific variant index (0-based). Overrides seed.
   *  Useful for tests + manual preview UIs. */
  variantIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Service phrase map — same shape as defaults.SERVICE_PHRASES.
//  Duplicated here so this module is self-contained for tests; the
//  app calls passing the SERVICE_PHRASES export to bypass duplication.
// ─────────────────────────────────────────────────────────────────────

const SERVICE_NATURAL: Record<string, string> = {
  'Flat Tire Repair': 'the flat tire repair',
  'Tire Replacement': 'the tire replacement',
  'Tire Installation': 'the tire installation',
  'Mounting & Balancing': 'mounting and balancing',
  'Spare Tire Installation': 'the spare tire install',
  'Spare Change': 'the spare swap',
  'Tire Rotation': 'the tire rotation',
  'Wheel Lock Removal': 'the wheel lock removal',
  'Roadside Tire Assistance': 'the roadside assistance',
  'Mobile Tire Service': 'the mobile tire service',
  'Jump Start': 'the jump start',
  'Fuel Delivery': 'the fuel delivery',
  'Lockout': 'the lockout service',
  'Fleet Tire Service': 'the fleet tire service',
  'Heavy-Duty Tire Service': 'the heavy-duty tire service',
};

/** Service bucket → which template set applies. Keeps the variant
 *  arrays from exploding when several service keys want similar
 *  wording. */
function bucketFor(service: ServiceKey | undefined): TemplateBucket {
  if (!service) return 'generic';
  switch (service) {
    case 'Flat Tire Repair':
      return 'flat_repair';
    case 'Tire Replacement':
    case 'Tire Installation':
    case 'Mounting & Balancing':
      return 'replacement';
    case 'Spare Tire Installation':
    case 'Spare Change':
      return 'spare_install';
    case 'Wheel Lock Removal':
      return 'wheel_lock';
    case 'Roadside Tire Assistance':
    case 'Jump Start':
    case 'Fuel Delivery':
    case 'Lockout':
      return 'roadside';
    case 'Fleet Tire Service':
    case 'Heavy-Duty Tire Service':
      return 'commercial';
    default:
      return 'generic';
  }
}

type TemplateBucket =
  | 'flat_repair'
  | 'replacement'
  | 'spare_install'
  | 'wheel_lock'
  | 'roadside'
  | 'commercial'
  | 'generic';

// ─────────────────────────────────────────────────────────────────────
//  Templates
//
//  Each template is a function that returns the BODY (no link). Link
//  is appended by the assembler with a single \n separator.
//
//  Placeholders used inside the template:
//    {name}    customer first name (or "there")
//    {service} natural service phrase (with "the " prefix where it
//              reads well, e.g. "the flat tire repair")
//    {city}    location label
//    {biz}     business name
//
//  Naming: variants are intentionally short and slightly different
//  in opener / call-to-action so a customer base receiving multiple
//  requests over months doesn't see the same wording twice.
//
//  Character budget for each variant: aim ≤250 chars after
//  interpolation with typical-length values. Tested examples below
//  in the JSDoc above each bucket.
// ─────────────────────────────────────────────────────────────────────

type Variant = (ctx: TplContext) => string;
interface TplContext {
  name: string;       // "Serge" or "there"
  service: string;    // "mounting and balancing" or "your service"
  city: string;       // "Aventura, FL" or "your area"
  biz: string;        // "Wheel Rush" or "our team"
}

/**
 * FLAT TIRE REPAIR — example output (Serge, Aventura, Wheel Rush):
 *   "Hi Serge, glad we could patch you up in Aventura today.
 *    A quick Google review helps other drivers find Wheel Rush
 *    when they need a fast fix."
 */
const FLAT_REPAIR: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, glad we could patch you up in ${city} today. A quick Google review helps other drivers find ${biz} when they need a fast fix.`,
  ({ name, city, biz }) =>
    `Thanks for trusting ${biz} with your flat repair, ${name}. If the service in ${city} went well, a short review would mean a lot.`,
  ({ name, city, biz }) =>
    `Hi ${name}, hope you're back on the road. If we earned it, a quick review about your flat repair in ${city} helps ${biz} reach more drivers.`,
  ({ name, biz }) =>
    `Thanks again, ${name}. A 30-second Google review about your flat repair really helps ${biz} keep the lights on for the next driver.`,
];

/**
 * REPLACEMENT / INSTALL / MOUNT-BALANCE — example:
 *   "Hi Serge, thanks again for choosing Wheel Rush for mounting and
 *    balancing in Aventura. A quick Google review helps other local
 *    drivers find reliable mobile tire service."
 */
const REPLACEMENT: Variant[] = [
  ({ name, service, city, biz }) =>
    `Hi ${name}, thanks again for choosing ${biz} for ${service} in ${city}. A quick Google review helps other local drivers find reliable mobile tire service.`,
  ({ name, service, city, biz }) =>
    `${name}, thanks for letting ${biz} handle ${service} in ${city}. If you'd share a short review, it really helps neighbors find us.`,
  ({ name, service, biz }) =>
    `Hi ${name}, hope the new setup is rolling smooth. A quick review about ${service} would help ${biz} a ton.`,
  ({ name, service, city, biz }) =>
    `Thanks for the trust today, ${name}. If ${service} in ${city} went well, a Google review would help ${biz} reach more local drivers.`,
];

/**
 * SPARE INSTALL / SWAP — example:
 *   "Hi Serge, glad we got you back on the road with the spare in
 *    Aventura. A quick Google review helps Wheel Rush help more
 *    drivers stuck like you were."
 */
const SPARE_INSTALL: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, glad we got you back on the road with the spare in ${city}. A quick Google review helps ${biz} help more drivers stuck like you were.`,
  ({ name, biz }) =>
    `Thanks for calling ${biz}, ${name}. If the spare swap went smooth, a short review would help us reach the next stranded driver.`,
  ({ name, city, biz }) =>
    `Hi ${name}, hope the rest of your day is easier. A quick review about the spare install in ${city} really helps ${biz} grow locally.`,
];

/**
 * WHEEL LOCK REMOVAL — example:
 *   "Hi Serge, glad we got that wheel lock off in Aventura. A short
 *    Google review helps Wheel Rush stand out for the next driver
 *    in the same spot."
 */
const WHEEL_LOCK: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, glad we got that wheel lock off in ${city}. A short Google review helps ${biz} stand out for the next driver in the same spot.`,
  ({ name, biz }) =>
    `${name}, hope you're rolling again. If the wheel lock removal went well, a quick review really helps ${biz} reach more drivers.`,
  ({ name, city, biz }) =>
    `Thanks for trusting ${biz} with the lock removal in ${city}, ${name}. A quick review would mean a lot to our small team.`,
];

/**
 * ROADSIDE (incl. jump start / fuel / lockout) — example:
 *   "Hi Serge, glad we could help in Aventura today. A quick Google
 *    review helps Wheel Rush reach more drivers when they're in a
 *    bind."
 */
const ROADSIDE: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, glad we could help in ${city} today. A quick Google review helps ${biz} reach more drivers when they're in a bind.`,
  ({ name, biz }) =>
    `Thanks for calling ${biz}, ${name}. If we got you sorted, a short review would help us be there for the next driver.`,
  ({ name, city, biz }) =>
    `${name}, hope the rest of the day goes easier. A quick Google review about today's service in ${city} really helps ${biz}.`,
  ({ name, biz }) =>
    `Thanks for the trust today, ${name}. A short review would help ${biz} keep showing up for drivers who need us.`,
];

/**
 * COMMERCIAL / FLEET — example:
 *   "Thanks for trusting Wheel Rush with your fleet work in Aventura,
 *    Serge. A quick Google review helps other local operators find a
 *    reliable mobile service."
 */
const COMMERCIAL: Variant[] = [
  ({ name, city, biz }) =>
    `Thanks for trusting ${biz} with your fleet work in ${city}, ${name}. A quick Google review helps other local operators find a reliable mobile service.`,
  ({ name, biz }) =>
    `${name}, appreciate the partnership. A short Google review would help ${biz} reach more fleets in the area.`,
  ({ name, city, biz }) =>
    `Hi ${name}, hope today's service kept your trucks moving. A quick review about ${biz} in ${city} really helps our local presence.`,
];

/**
 * GENERIC — used when service is missing or doesn't match a bucket.
 */
const GENERIC: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, thanks for choosing ${biz} in ${city}. A quick Google review helps other local drivers find us.`,
  ({ name, biz }) =>
    `Thanks again, ${name}. A short Google review would help ${biz} keep doing what we do.`,
  ({ name, city, biz }) =>
    `Hi ${name}, hope today's service went well. A quick review about ${biz} in ${city} really helps neighbors find us.`,
];

const BUCKETS: Record<TemplateBucket, Variant[]> = {
  flat_repair: FLAT_REPAIR,
  replacement: REPLACEMENT,
  spare_install: SPARE_INSTALL,
  wheel_lock: WHEEL_LOCK,
  roadside: ROADSIDE,
  commercial: COMMERCIAL,
  generic: GENERIC,
};

// ─────────────────────────────────────────────────────────────────────
//  Context resolution — applies all the fallback rules in one place.
// ─────────────────────────────────────────────────────────────────────

function resolveContext(opts: ReviewMessageOptions): TplContext {
  // Customer name — first word only (most reviewers expect first-name
  // address). If the value contains an email or numeric junk, fall
  // back to "there".
  const rawName = (opts.customerName || '').trim();
  let name = 'there';
  if (rawName) {
    const first = rawName.split(/\s+/)[0];
    // Reject obvious non-name values (emails, all digits, very long
    // strings) — these would feel weird in a casual greeting.
    if (
      first &&
      first.length <= 30 &&
      !/[@\d]/.test(first) &&
      /[A-Za-z]/.test(first)
    ) {
      name = first;
    }
  }

  // Service — look up the natural phrase. Fall back to a lowercased
  // version of the raw service, or "your service" if missing.
  const rawSvc = (opts.service || '').trim();
  let service = 'your service';
  if (rawSvc) {
    if (SERVICE_NATURAL[rawSvc]) {
      service = SERVICE_NATURAL[rawSvc];
    } else {
      service = `the ${rawSvc.toLowerCase()}`;
    }
  }

  // Location — prefer explicit label, otherwise compose city + state.
  let city = '';
  if (opts.locationLabel && opts.locationLabel.trim()) {
    city = opts.locationLabel.trim();
  } else if (opts.city && opts.city.trim()) {
    const c = opts.city.trim();
    const st = (opts.state || '').trim();
    city = st && !c.includes(',') ? `${c}, ${st}` : c;
  }
  if (!city) city = 'your area';

  const biz = (opts.businessName || '').trim() || 'our team';

  return { name, service, city, biz };
}

// ─────────────────────────────────────────────────────────────────────
//  Variant picker — deterministic when given a seed, otherwise random.
// ─────────────────────────────────────────────────────────────────────

function hashSeed(seed: string): number {
  // Lightweight djb2 hash — deterministic, no external deps.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickVariantIndex(seed: string | undefined, count: number): number {
  if (count <= 1) return 0;
  if (seed) return hashSeed(seed) % count;
  return Math.floor(Math.random() * count);
}

// ─────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a complete review message body, including the link line if
 * provided. The body is one paragraph, then a single newline, then
 * the link.
 *
 *   "Hi Serge, thanks again for choosing Wheel Rush ...
 *    \n
 *    https://g.page/r/..."
 *
 * Caller controls how it's sent (SMS, iMessage, WhatsApp, clipboard
 * — see `shareReviewMessage`).
 */
export function buildReviewMessage(opts: ReviewMessageOptions): string {
  const ctx = resolveContext(opts);
  const bucket = bucketFor(opts.service);
  const variants = BUCKETS[bucket];
  const idx =
    opts.variantIndex !== undefined && opts.variantIndex >= 0
      ? opts.variantIndex % variants.length
      : pickVariantIndex(opts.seed, variants.length);
  const body = variants[idx](ctx);

  const url = (opts.reviewUrl || '').trim();
  if (!url) return body;
  return `${body}\n${url}`;
}

/**
 * Returns the picked variant info — useful for "preview" UIs and tests.
 */
export function pickReviewVariant(opts: ReviewMessageOptions): {
  bucket: TemplateBucket;
  index: number;
  variantCount: number;
} {
  const bucket = bucketFor(opts.service);
  const variants = BUCKETS[bucket];
  const index =
    opts.variantIndex !== undefined && opts.variantIndex >= 0
      ? opts.variantIndex % variants.length
      : pickVariantIndex(opts.seed, variants.length);
  return { bucket, index, variantCount: variants.length };
}

/**
 * Open a share sheet / messaging app for the given channel.
 *
 * Channels:
 *   - 'sms'       → sms:phone?body=<message>     (iOS Messages, Android)
 *   - 'imessage'  → same scheme as sms (iOS routes to iMessage when
 *                    the recipient is on iMessage; otherwise SMS)
 *   - 'whatsapp'  → https://wa.me/<phone>?text=  (works on web + app)
 *   - 'clipboard' → no navigation; returns the text so caller can
 *                   call navigator.clipboard.writeText(...) and toast
 *
 * Returns the message body so callers can toast / log it.
 */
export function shareReviewMessage(
  opts: ReviewMessageOptions & { phone?: string },
  channel: ShareChannel = 'sms',
): string {
  const body = buildReviewMessage(opts);

  if (channel === 'clipboard') {
    // Defer the actual clipboard write to the caller — different
    // surfaces (settings page, share sheet, toast) need to do
    // their own UI feedback.
    return body;
  }

  // Phone may contain formatting; strip to digits for tel-style URLs.
  // WhatsApp accepts E.164 without the '+'; sms: also accepts.
  const phoneDigits = (opts.phone || '').replace(/\D/g, '');
  const encoded = encodeURIComponent(body);

  let url: string;
  if (channel === 'whatsapp') {
    url = phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
  } else {
    // sms + imessage share the same scheme.
    url = phoneDigits ? `sms:${phoneDigits}?body=${encoded}` : `sms:?body=${encoded}`;
  }

  if (typeof window !== 'undefined') {
    window.open(url);
  }
  return body;
}

/**
 * Convenience wrapper for the most common use case from job actions
 * (Send Review button). Mirrors the old `openReviewSMS` signature so
 * callers don't need to switch APIs everywhere — internally builds
 * via the new template system. Default channel: SMS.
 */
export function openReviewSMSFromJob(args: {
  phone: string;
  reviewUrl: string;
  customerName: string;
  service: string;
  locationLabel: string;
  state?: string;
  businessName: string;
  jobId?: string;
  channel?: ShareChannel;
}): string {
  return shareReviewMessage(
    {
      phone: args.phone,
      reviewUrl: args.reviewUrl,
      customerName: args.customerName,
      service: args.service,
      locationLabel: args.locationLabel,
      state: args.state,
      businessName: args.businessName,
      seed: args.jobId,
    },
    args.channel || 'sms',
  );
}
