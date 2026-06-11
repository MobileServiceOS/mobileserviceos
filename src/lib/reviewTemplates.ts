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
  /** Customer's vehicle (e.g. "Toyota Camry", "Ford F-150"). When
   *  present, vehicle-aware variants weave it into the message
   *  ("...on your Toyota Camry"). When absent, templates fall back
   *  gracefully — no dangling clauses, no "on your your vehicle"
   *  awkwardness. Optional. */
  vehicle?: string;
  /** Google review URL. If empty/missing, message returns without
   *  a link line so callers can decide what to do. */
  reviewUrl?: string;
  /** Seed for variant selection. Pass `job.id` for deterministic
   *  output. Omit for random rotation. */
  seed?: string;
  /** Force a specific variant index (0-based). Overrides seed.
   *  Useful for tests + manual preview UIs. */
  variantIndex?: number;
  /** When provided, the picker will avoid this index when selecting
   *  the next variant. Powers the "no consecutive duplicates"
   *  rotation behavior — caller persists the previously-returned
   *  index (typically in localStorage, scoped by businessId + bucket)
   *  and passes it on the next call. Only honored when the bucket
   *  has more than 1 variant. */
  lastUsedIdx?: number;
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
  // Specific tire services
  'Valve Stem Replacement': 'the valve stem replacement',
  'Tire Repair': 'the tire repair',
  'Used Tire Installation': 'the used tire install',
  'New Tire Installation': 'the new tire install',
  'Tire Mount & Balance': 'the mount and balance',
  'Roadside Tire Service': 'the roadside tire service',
  'Emergency Highway Service': 'the emergency highway service',
  'Commercial Truck Tire Service': 'the commercial truck tire service',
  'RV Tire Service': 'the RV tire service',
  // Mechanic vertical
  'Mobile Mechanic Services': 'the mobile mechanic service',
  'Battery Replacement': 'the battery replacement',
  'Oil Change': 'the oil change',
  'Brake Service': 'the brake service',
  // Detailing vertical
  'Car Wash': 'the car wash',
  'Detailing': 'the detail',
};

/** Service bucket → which template set applies. Keeps the variant
 *  arrays from exploding when several service keys want similar
 *  wording. */
function bucketFor(service: ServiceKey | undefined): TemplateBucket {
  if (!service) return 'generic';
  switch (service) {
    case 'Flat Tire Repair':
    case 'Tire Repair':
      return 'flat_repair';
    case 'Tire Replacement':
    case 'Tire Installation':
    case 'Mounting & Balancing':
    case 'Used Tire Installation':
    case 'New Tire Installation':
    case 'Tire Mount & Balance':
      return 'replacement';
    case 'Spare Tire Installation':
    case 'Spare Change':
      return 'spare_install';
    case 'Wheel Lock Removal':
      return 'wheel_lock';
    case 'Valve Stem Replacement':
      return 'valve_stem';
    case 'Roadside Tire Assistance':
    case 'Roadside Tire Service':
    case 'Emergency Highway Service':
    case 'Jump Start':
    case 'Fuel Delivery':
    case 'Lockout':
      return 'roadside';
    case 'Fleet Tire Service':
    case 'Heavy-Duty Tire Service':
    case 'Commercial Truck Tire Service':
    case 'RV Tire Service':
      return 'commercial';
    // ─── Mechanic vertical ──────────────────────────────────
    case 'Mobile Mechanic Services':
      return 'mechanic_general';
    case 'Battery Replacement':
      return 'battery';
    case 'Oil Change':
      return 'oil_change';
    case 'Brake Service':
      return 'brake';
    // ─── Detailing vertical ─────────────────────────────────
    case 'Car Wash':
      return 'car_wash';
    case 'Detailing':
      return 'detailing';
    default:
      return 'generic';
  }
}

type TemplateBucket =
  | 'flat_repair'
  | 'replacement'
  | 'spare_install'
  | 'wheel_lock'
  | 'valve_stem'
  | 'roadside'
  | 'commercial'
  // Mechanic vertical
  | 'mechanic_general'
  | 'battery'
  | 'oil_change'
  | 'brake'
  // Detailing vertical
  | 'car_wash'
  | 'detailing'
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
  salutation: string; // "Serge" or "Hi there" — use at sentence start
                      // when no "Hi"/"Thanks" prefix precedes the name.
                      // Keeps the opener grammatical when name is the
                      // generic-fallback "there" (a bare "There, ..."
                      // isn't a real greeting).
  service: string;    // "mounting and balancing" or "your service"
  city: string;       // "Aventura, FL" or "your area"
  biz: string;        // "Wheel Rush" or "our team"
  vehicle: string;    // "your Toyota Camry" or "" — empty string when
                      // the job didn't capture vehicle, so templates
                      // can interpolate `${vehicle}` without producing
                      // dangling commas. Templates that opt in should
                      // wrap with a leading space and adapt punctuation
                      // accordingly (see VEHICLE-aware variants).
  vehicleClause: string; // " on your Toyota Camry" or "" — a ready-to-paste
                      // " on {vehicle}" fragment for templates that want
                      // a tail clause without conditional logic.
}

/**
 * FLAT TIRE REPAIR — example output (Serge, Aventura, Wheel Rush):
 *   "Hi Serge, glad we could patch you up in Aventura today.
 *    A quick Google review helps other drivers find Wheel Rush
 *    when they need a fast fix."
 */
const FLAT_REPAIR: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} for your flat repair in ${city}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for trusting ${biz} with your flat repair today. A quick Google review would help other drivers find reliable mobile tire service.`,
  ({ name, city, biz }) =>
    `Hi ${name}, it was a pleasure helping you in ${city} today. If you were satisfied with the flat repair, please consider leaving ${biz} a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for choosing ${biz} for your flat repair. If we did a good job, a short Google review would mean a great deal to our team.`,
  ({ name, city, biz }) =>
    `Thank you, ${name}. A brief Google review about your flat repair in ${city} helps other drivers find ${biz} when they need a reliable fix.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for your business today. A quick Google review helps ${biz} continue serving drivers across ${city}.`,
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your flat repair in ${city}${vehicleClause}. If you were happy with the service, a quick Google review would mean a lot.`,
];

/**
 * REPLACEMENT / INSTALL / MOUNT-BALANCE — example:
 *   "Hi Serge, thanks again for choosing Wheel Rush for mounting and
 *    balancing in Aventura. A quick Google review helps other local
 *    drivers find reliable mobile tire service."
 */
const REPLACEMENT: Variant[] = [
  ({ name, service, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} for ${service} in ${city}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ salutation, service, biz }) =>
    `${salutation}, thank you for trusting ${biz} with ${service}. A quick Google review would help other local drivers find reliable mobile tire service.`,
  ({ name, service, city, biz }) =>
    `Hi ${name}, it was a pleasure handling ${service} for you in ${city} today. If you were satisfied, please consider leaving ${biz} a quick Google review.`,
  ({ name, biz }) =>
    `Thank you for your business, ${name}. A short Google review would help ${biz} keep showing up for drivers who need dependable mobile tire service.`,
  ({ salutation, service, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} for ${service} in ${city}. A brief Google review goes a long way for our small team.`,
  ({ name, service, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for ${service} in ${city}${vehicleClause}. If you were happy with the service, a quick Google review would mean a lot.`,
];

/**
 * SPARE INSTALL / SWAP — example:
 *   "Hi Serge, glad we got you back on the road with the spare in
 *    Aventura. A quick Google review helps Wheel Rush help more
 *    drivers stuck like you were."
 */
const SPARE_INSTALL: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} for your spare tire installation in ${city}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for calling ${biz} today. If the spare installation went well, a quick Google review would help other drivers find us.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your spare installation in ${city}. A short Google review would mean a great deal to our team.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about ${biz} helps more drivers find reliable mobile tire service when they need it.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. If we did a good job today, please consider leaving a quick Google review.`,
];

/**
 * WHEEL LOCK REMOVAL — example:
 *   "Hi Serge, glad we got that wheel lock off in Aventura. A short
 *    Google review helps Wheel Rush stand out for the next driver
 *    in the same spot."
 */
const WHEEL_LOCK: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} for your wheel lock removal in ${city}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with the wheel lock removal. A quick Google review would help other drivers find us.`,
  ({ name, city, biz }) =>
    `Hi ${name}, it was a pleasure helping you in ${city} today. If you were satisfied with the wheel lock removal, please consider a quick Google review for ${biz}.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A short Google review about ${biz} would mean a great deal to our small team.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. A brief Google review helps more drivers find reliable mobile service.`,
];

/**
 * ROADSIDE (incl. jump start / fuel / lockout) — example:
 *   "Hi Serge, glad we could help in Aventura today. A quick Google
 *    review helps Wheel Rush reach more drivers when they're in a
 *    bind."
 */
const ROADSIDE: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for calling ${biz} for roadside assistance in ${city} today. If you were happy with the service, we'd appreciate a quick Google review.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for trusting ${biz} today. If we took good care of you, a quick Google review would help the next driver who needs us.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. A short Google review would help other drivers find reliable roadside assistance.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about ${biz} helps more drivers find dependable mobile service when they need it most.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for calling ${biz}. If we did a good job today, a quick Google review would mean a lot to our team.`,
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for roadside assistance in ${city}${vehicleClause}. A quick Google review would help more drivers find us.`,
];

/**
 * COMMERCIAL / FLEET — example:
 *   "Thanks for trusting Wheel Rush with your fleet work in Aventura,
 *    Serge. A quick Google review helps other local operators find a
 *    reliable mobile service."
 */
const COMMERCIAL: Variant[] = [
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your fleet service in ${city}. A quick Google review would help other operators find a reliable mobile service.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for your business. A short Google review would help ${biz} reach more fleet operators in the area.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} to keep your fleet moving in ${city}. If you were satisfied, please consider a quick Google review.`,
  ({ name, biz }) =>
    `Thank you for the partnership, ${name}. A brief Google review goes a long way for a small team like ${biz}.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for trusting ${biz} with today's fleet service. A short Google review would help other operators find us.`,
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for the fleet trust in ${city}${vehicleClause}. A short Google review helps other operators find a reliable mobile service.`,
];

/**
 * GENERIC — used when service is missing or doesn't match a bucket.
 */
/**
 * VALVE STEM REPLACEMENT — quick safety-focused service, often
 * roadside or follow-up. Cheap and fast, so review tone is
 * "small but important" rather than the bigger "thanks for the
 * trust" framing used for replacement.
 */
const VALVE_STEM: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your valve stem replacement in ${city}${vehicleClause}. A quick Google review would help more drivers find us.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with the valve stem replacement. A short Google review goes a long way for our small team.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for your business in ${city} today. If you were happy with the service, please consider leaving ${biz} a quick Google review.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about ${biz} really helps small jobs like ours stay visible to other drivers.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. A quick Google review helps other drivers find us for the same service.`,
];

/**
 * MECHANIC GENERAL — fallback for mobile mechanic services that
 * don't slot into battery / oil / brake. Convenience-focused tone
 * (mobile means we came to you).
 */
const MECHANIC_GENERAL: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for mobile mechanic service in ${city}${vehicleClause}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for choosing ${biz} for mobile service. A short Google review would help more drivers find a reliable mechanic who comes to them.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for your business in ${city} today. A quick Google review really helps ${biz} keep serving local drivers.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about ${biz} would help other drivers find dependable mobile mechanic service in the area.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. A quick Google review helps more drivers find a mechanic who comes to them.`,
];

/**
 * BATTERY REPLACEMENT — emergency-adjacent. Most calls are
 * stranded drivers. Tone leans toward "saved your day" framing.
 */
const BATTERY: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your battery replacement in ${city}${vehicleClause}. If you were happy with the service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your battery replacement. A short Google review would help the next driver with a dead start find us.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for calling ${biz} today. If the battery replacement in ${city} went well, a quick Google review would help more drivers find fast service.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about ${biz} helps other drivers find dependable mobile battery service when they need it.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for your business in ${city}. A short Google review helps ${biz} reach more drivers when their car won't start.`,
];

/**
 * OIL CHANGE — routine maintenance, low-emotion service. Friendly
 * "you took care of it" tone rather than dramatic "saved your day."
 */
const OIL_CHANGE: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your oil change in ${city}${vehicleClause}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your maintenance. A short Google review would help more drivers find mobile oil service at home.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about your oil change helps ${biz} stay in front of other drivers due for service.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for your business in ${city}. A short Google review helps ${biz} keep serving local drivers.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} today. A quick Google review helps neighbors in ${city} find reliable mobile oil service.`,
];

/**
 * BRAKE SERVICE — safety-focused service. Tone emphasizes peace of
 * mind + confidence rather than convenience.
 */
const BRAKE: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your brake service in ${city}${vehicleClause}. If you were happy with the service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your brake service. A short Google review would help more drivers find safe, reliable brake work.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about ${biz} helps other drivers find a mobile shop that handles safety work properly.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for your business in ${city}. A short Google review helps more drivers know ${biz} handles brake service right.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} today. A quick Google review helps more drivers in ${city} find dependable brake service.`,
];

/**
 * CAR WASH — short, friendly. The service is light + pleasant
 * so the review ask matches.
 */
const CAR_WASH: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your car wash in ${city}${vehicleClause}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your car wash today. A short Google review would mean a lot to our small team.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review about today's wash really helps ${biz} keep the schedule full.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. A quick Google review helps neighbors find a mobile wash that shows up on time.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for your business today. A short Google review about ${biz} really helps more local drivers find us.`,
];

/**
 * DETAILING — premium service, longer-form interaction. Tone is
 * grateful and quality-focused, matching the higher ticket size.
 */
const DETAILING: Variant[] = [
  ({ name, city, biz, vehicleClause }) =>
    `Hi ${name}, thank you for choosing ${biz} for your detail in ${city}${vehicleClause}. If you were happy with today's service, we'd appreciate a quick Google review.`,
  ({ salutation, biz }) =>
    `${salutation}, thank you for trusting ${biz} with your detail. A short Google review would help us reach more drivers looking for premium mobile detailing.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A brief Google review really helps ${biz} grow our local detailing business.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city} today. A short Google review helps neighbors find quality mobile detailing.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for your business today. If the detail met your expectations, a quick Google review would mean a lot to ${biz}.`,
];

const GENERIC: Variant[] = [
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for choosing ${biz} in ${city}. A quick Google review helps other local drivers find us.`,
  ({ name, biz }) =>
    `Thank you, ${name}. A short Google review would help ${biz} continue serving drivers in the area.`,
  ({ name, city, biz }) =>
    `Hi ${name}, thank you for your business today. A quick Google review about ${biz} in ${city} really helps neighbors find us.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for choosing ${biz}. If you were happy with today's service, a quick Google review would mean a lot.`,
  ({ salutation, city, biz }) =>
    `${salutation}, thank you for choosing ${biz} in ${city}. A short Google review would help us reach more local drivers.`,
  ({ name, biz }) =>
    `Hi ${name}, thank you for your business today. A quick Google review really helps ${biz} stay visible to other drivers.`,
];

const BUCKETS: Record<TemplateBucket, Variant[]> = {
  flat_repair: FLAT_REPAIR,
  replacement: REPLACEMENT,
  spare_install: SPARE_INSTALL,
  wheel_lock: WHEEL_LOCK,
  valve_stem: VALVE_STEM,
  roadside: ROADSIDE,
  commercial: COMMERCIAL,
  mechanic_general: MECHANIC_GENERAL,
  battery: BATTERY,
  oil_change: OIL_CHANGE,
  brake: BRAKE,
  car_wash: CAR_WASH,
  detailing: DETAILING,
  generic: GENERIC,
};

// ─────────────────────────────────────────────────────────────────────
//  Context resolution — applies all the fallback rules in one place.
// ─────────────────────────────────────────────────────────────────────

// Placeholder "names" that get written when a job/customer has no real
// name (see customers.ts / customerEntity.ts / the unknown-caller path).
// These must NEVER be addressed as a first name — fall back to "there".
const PLACEHOLDER_NAMES = new Set([
  'unknown', 'unknown caller', 'unknown customer', 'unnamed', 'no name',
  'customer', 'guest', 'n/a', 'na', 'none', 'null', 'undefined', 'test',
]);
function isPlaceholderName(s: string): boolean {
  return PLACEHOLDER_NAMES.has(s.trim().toLowerCase());
}

function resolveContext(opts: ReviewMessageOptions): TplContext {
  // Customer name — first word only (most reviewers expect first-name
  // address). If the value contains an email or numeric junk, fall
  // back to "there".
  const rawName = (opts.customerName || '').trim();
  let name = 'there';
  if (rawName && !isPlaceholderName(rawName)) {
    const first = rawName.split(/\s+/)[0];
    // Reject obvious non-name values (emails, all digits, very long
    // strings, placeholder labels) — these would read wrong in a
    // greeting. Anything rejected leaves the clean "there" fallback,
    // so the message never addresses a customer as "Unknown".
    if (
      first &&
      first.length <= 30 &&
      !/[@\d]/.test(first) &&
      /[A-Za-z]/.test(first) &&
      !isPlaceholderName(first)
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

  // Salutation = the form usable at the very start of a sentence.
  // For a real name we just use it as-is ("Serge, hope you're..."),
  // but for the "there" fallback we need a proper greeting opener
  // ("Hi there, hope you're..."). Templates that already prefix
  // with "Hi"/"Thanks"/"Hope" use {name} and stay unchanged.
  const salutation = name === 'there' ? 'Hi there' : name;

  // Vehicle resolution. When the job captured a vehicle, surface
  // two interpolation forms:
  //   - vehicle: "your Toyota Camry" (use mid-sentence after a
  //     preposition: "for your Toyota Camry")
  //   - vehicleClause: " on your Toyota Camry" (drop directly into
  //     a sentence with no conditional logic; produces a clean
  //     trailing clause when present, empty string when absent so
  //     the surrounding punctuation stays correct).
  // Reject obvious junk inputs (single chars, all-digit, etc.) so a
  // jobs sheet row with a stray "?" doesn't become "your ?".
  const rawVehicle = (opts.vehicle || '').trim();
  let vehicle = '';
  let vehicleClause = '';
  if (rawVehicle && rawVehicle.length >= 2 && /[A-Za-z]/.test(rawVehicle)) {
    vehicle = `your ${rawVehicle}`;
    vehicleClause = ` on ${vehicle}`;
  }

  return { name, salutation, service, city, biz, vehicle, vehicleClause };
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

function pickVariantIndex(
  seed: string | undefined,
  count: number,
  lastUsedIdx?: number,
): number {
  if (count <= 1) return 0;
  let idx = seed ? hashSeed(seed) % count : Math.floor(Math.random() * count);
  // Smart rotation: bump to the next slot when the picker lands on
  // the same variant the previous send used. Modular wrap keeps the
  // index in range. Only runs when the bucket has > 1 variant
  // (otherwise there's nowhere to bump to).
  if (lastUsedIdx !== undefined && idx === lastUsedIdx) {
    idx = (idx + 1) % count;
  }
  return idx;
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
      : pickVariantIndex(opts.seed, variants.length, opts.lastUsedIdx);
  const raw = variants[idx](ctx);

  // Sentence-case enforcement. Several templates open with
  // "${name}, ..." which reads correctly when name is a real
  // first name ("Serge, hope you're rolling again.") but breaks
  // grammatically when the fallback name "there" is used —
  // "there, hope you're rolling again." has a lowercase
  // sentence start. Uppercasing the very first character is the
  // minimal defensive fix; existing capitalized openers are
  // unaffected (Hi/Thanks/Hope already start uppercase).
  const body = raw.length > 0
    ? raw.charAt(0).toUpperCase() + raw.slice(1)
    : raw;

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
      : pickVariantIndex(opts.seed, variants.length, opts.lastUsedIdx);
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
  /** Customer's vehicle. Threaded into vehicle-aware variants. */
  vehicle?: string;
  jobId?: string;
  channel?: ShareChannel;
  /**
   * BusinessId scoping for the rotation tracker. When provided, the
   * picker reads/writes the last-used variant index per (business,
   * bucket) so two consecutive sends never repeat the same wording.
   * When omitted, rotation is disabled and the seed-based picker
   * runs unchanged (same job → same variant — preserves the
   * preview-then-send invariant).
   */
  businessId?: string;
}): string {
  const bucket = bucketFor(args.service);

  // Smart rotation: read the last-used variant index for this
  // (business, bucket) pair from localStorage. The picker then
  // avoids returning that index if the hash/random selection
  // happens to land on it. After the message is built, the new
  // index gets persisted for the next call.
  //
  // Storage is best-effort — Safari private mode + some embedded
  // webviews throw on localStorage access. We swallow + fall back
  // to seed-only behavior in that case rather than blocking the
  // review send.
  let lastUsedIdx: number | undefined;
  const storageKey = args.businessId
    ? `msos_review_last_${args.businessId}_${bucket}`
    : null;
  if (storageKey) {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
      if (v != null) {
        const parsed = parseInt(v, 10);
        if (Number.isFinite(parsed) && parsed >= 0) lastUsedIdx = parsed;
      }
    } catch {
      // ignore — rotation degrades to seed-only
    }
  }

  const opts: ReviewMessageOptions = {
    customerName: args.customerName,
    service: args.service,
    locationLabel: args.locationLabel,
    state: args.state,
    businessName: args.businessName,
    vehicle: args.vehicle,
    reviewUrl: args.reviewUrl,
    seed: args.jobId,
    lastUsedIdx,
  };

  // Persist the picked index for the NEXT send before opening the
  // sheet so the rotation advances even if the user cancels
  // mid-share.
  if (storageKey) {
    try {
      const { index } = pickReviewVariant(opts);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, String(index));
      }
    } catch {
      // ignore
    }
  }

  return shareReviewMessage({ ...opts, phone: args.phone }, args.channel || 'sms');
}
