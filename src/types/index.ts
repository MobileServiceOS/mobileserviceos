// ═══════════════════════════════════════════════════════════════════
//  Mobile Service OS — Canonical Type System
// ═══════════════════════════════════════════════════════════════════
//
//  Single source of truth for shared types. Components, contexts,
//  hooks, and library code MUST import from here (`@/types`) rather
//  than defining their own.
//
//  Consolidation philosophy:
//    - Additive where safe. Most existing fields are unchanged.
//    - All new fields are optional so existing Firestore documents
//      remain readable without migration.
//    - The MemberDoc shape was updated to match the membership flow
//      the rest of the app expects (businessId, invitedBy,
//      assignedBusinessId, status union). This replaces the earlier
//      draft shape — there were no production consumers yet.
//
// ═══════════════════════════════════════════════════════════════════

import type { Timestamp } from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────
//  Status / enum types
// ─────────────────────────────────────────────────────────────────────

export type PaymentStatus = 'Paid' | 'Pending Payment' | 'Partial Payment' | 'Cancelled';
export type JobStatus = 'Completed' | 'Pending' | 'Cancelled';
export type TireSource = 'Inventory' | 'Bought for this job' | 'Customer supplied';

/**
 * Canonical payment method union — STORED VALUES (lowercase identifiers).
 * Use this in Firestore, query keys, and CSS class suffixes.
 *
 * Display labels are separate — see PaymentMethodSheet for the
 * canonical lowercase ↔ "Title Case" mapping for UI rendering.
 */
export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'zelle'
  | 'venmo'
  | 'cashapp'
  | 'check'
  | 'apple_pay'
  | 'google_pay'
  | 'other';

/**
 * Current connection / write state of the local app vs Firestore.
 * Surfaced in the header pill.
 */
export type SyncStatus = 'local' | 'syncing' | 'connected' | 'offline' | 'sync_failed';

/**
 * Top-level nav tabs. Adding a tab here must also be reflected in the
 * router switch in App.tsx and in AppBottomNav.
 */
export type TabId =
  | 'dashboard'
  | 'add'
  | 'history'
  | 'customers'
  | 'leads'
  | 'customerProfile'
  | 'insights'
  | 'payouts'
  | 'expenses'
  | 'inventory'
  | 'settings'
  | 'help'
  | 'success';

// ─────────────────────────────────────────────────────────────────────
//  Plan / Billing
// ─────────────────────────────────────────────────────────────────────

/**
 * Subscription tier. Two-tier architecture preserved internally
 * (Core $39.99/mo, Pro $89.99/mo) even though only Pro is offered publicly
 * today — this lets us turn Core marketing on later without touching
 * the type system or backend.
 *
 * Public-facing onboarding always assigns `'pro'` for new accounts.
 * The Core literal exists for future pricing experiments, internal
 * downgrade flows, and legacy Firestore documents that may still
 * have `'core'` on disk.
 *
 * All gating decisions MUST go through `src/lib/planAccess.ts` —
 * never hand-roll `plan === 'pro'` checks at call sites. The module
 * exposes `canAccessFeature()`, `hasProAccess()`, `isTeamEnabled()`
 * for typed, centralized gating.
 */
export type Plan = 'core' | 'pro';

/**
 * Stripe-aligned subscription lifecycle states. 'inactive' covers the
 * pre-Stripe period and any account whose subscription record has been
 * deleted; 'trialing' covers the free-trial window before first
 * payment.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'inactive';

// ─────────────────────────────────────────────────────────────────────
//  Team / Membership
// ─────────────────────────────────────────────────────────────────────

/**
 * Role assigned to a member inside a business. Owners can do anything;
 * admins manage techs and view financials; technicians log jobs and
 * (per business config) optionally override prices.
 */
export type TeamRole = 'owner' | 'admin' | 'technician';

/**
 * Alias kept so legacy imports of `Role` continue to compile. Treat
 * `Role` and `TeamRole` as identical. New code can pick either.
 */
export type Role = TeamRole;

/**
 * Lifecycle state of a team member document. 'pending' = invite sent,
 * not yet accepted; 'active' = signed in and participating; 'disabled'
 * = revoked but kept for historical attribution.
 */
export type MemberStatus = 'active' | 'pending' | 'disabled';

/**
 * Technician work status — the field-service "where am I right now"
 * signal. Distinct from `MemberStatus` (the member-doc lifecycle) and
 * from `JobStatus` (the per-job state). Stored at
 * `businesses/{bid}/presence/{uid}`. Self-managed: each user writes
 * only their own presence doc.
 *
 *   available  — at base / dispatch-ready
 *   enroute    — driving to a job
 *   onsite     — at customer location
 *   busy       — actively working / not interruptible
 *   off_duty   — clocked out, not taking jobs
 *
 *   offline is implied by an absent / stale presence doc — the UI
 *   shows "Offline" when no presence doc exists for the user.
 */
export type TechStatus = 'available' | 'enroute' | 'onsite' | 'busy' | 'off_duty';

export interface PresenceDoc {
  uid: string;
  status: TechStatus;
  /** Optional free-text the operator types when changing status
   *  ("lunch", "stopped for gas", "headed to Smith job"). */
  note?: string;
  /** ISO timestamp the status was last set. Used to show "5 min ago"
   *  on the dispatch board so stale presences are obvious. */
  updatedAt: string;
}

export const TECH_STATUSES: TechStatus[] = ['available', 'enroute', 'onsite', 'busy', 'off_duty'];

export const TECH_STATUS_LABELS: Record<TechStatus, string> = {
  available: 'Available',
  enroute:   'En Route',
  onsite:    'On Site',
  busy:      'Busy',
  off_duty:  'Off Duty',
};

/** Colour tone for the status pill / dot. Matches existing pill
 *  CSS conventions (green/amber/red/neutral). */
export const TECH_STATUS_TONE: Record<TechStatus, 'green' | 'amber' | 'red' | 'neutral'> = {
  available: 'green',
  enroute:   'amber',
  onsite:    'amber',
  busy:      'red',
  off_duty:  'neutral',
};

/**
 * Firestore document shape for `businesses/{bid}/members/{memberId}`.
 *
 * The membership flow:
 *   1. Owner enters an email + role → MemberDoc written with
 *      status='pending', invitedAt, invitedBy.
 *   2. On signup, Cloud Function (future batch) resolves the email
 *      to an auth uid and updates status='active', joinedAt, uid.
 *   3. assignedBusinessId is set when an admin/tech is moved from
 *      one business to another — preserves audit trail.
 *
 * Many fields are optional because docs at different stages of the
 * lifecycle have different fields populated.
 */
export interface MemberDoc {
  /** Auth uid — populated once the member has signed up + accepted. */
  uid?: string;
  /** Email — the canonical identifier for invites before signup.
   *  Always required; how the invite is addressed. */
  email: string;
  /** Display name shown on job cards / invoices for technician
   *  attribution. Populated on accept or set manually by owner. */
  displayName?: string;
  /** Role inside this business. Owners are seeded automatically. */
  role: Role;
  /**
   * Primary business this member belongs to. Optional because the
   * owner-seed flow writes a MemberDoc before the businessId is
   * finalized on the docs side. Resolvers can default to the current
   * brand context's businessId when missing.
   */
  businessId?: string;
  /** When an admin/tech is reassigned, this tracks the previous
   *  business for audit purposes. Optional. */
  assignedBusinessId?: string;
  /** Auth uid of the owner/admin who sent the invite. */
  invitedBy?: string;
  /** Timestamp the invite was created. Accepts Firestore Timestamp,
   *  JS Date, or ISO string for cross-environment write/read. */
  invitedAt?: Timestamp | Date | string;
  /** Timestamp the member accepted and was promoted to active.
   *  Same flexible type as invitedAt. */
  joinedAt?: Timestamp | Date | string;
  /** Lifecycle state. See MemberStatus comments. */
  status: MemberStatus;
  /**
   * Per-member permission overrides. When present, these take precedence
   * over role-default permissions resolved from the user's `role`.
   * Stored as a partial map so owners can grant individual flags without
   * having to specify the full permission set. Read by permissions.ts
   * and the membership resolver.
   */
  permissions?: Partial<Permissions>;
  /**
   * Token of the invite this member came in through, stamped at the
   * moment of acceptance. Used by the Firestore rule that allows an
   * invitee to self-create their own member doc: the rule reads
   * `getAfter(invites/{inviteToken})` and confirms the invite was
   * just transitioned to status='accepted' for this user in the same
   * atomic writeBatch. Absent on owner-bootstrap and admin-added
   * member docs. Never updated after create.
   */
  inviteToken?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Invites
// ─────────────────────────────────────────────────────────────────────

/**
 * Pending team invite. Stored top-level at:
 *
 *   invites/{token}
 *
 * Token-keyed (random URL-safe string) so:
 *
 *   1. The invite link contains a single opaque identifier — no email
 *      leakage in the URL, no PII in browser history.
 *   2. The invitee can be ANY new or existing user; the link does not
 *      require a specific Firebase Auth account to exist beforehand.
 *   3. Owners can reissue invites without exposing previous tokens
 *      (rotate by revoking + creating).
 *   4. Lifecycle states (pending / accepted / expired / revoked) are
 *      tracked in-doc rather than via existence checks alone — gives
 *      a clean audit trail.
 *
 * Security: Firestore rules enforce that:
 *   - Only owner/admin of the target business creates invites for it
 *   - The invite role must be admin or technician (never owner)
 *   - Any authed user can READ a pending invite if they know the token
 *     (treated like a one-time secret in the URL)
 *   - Only an authed user whose verified token email MATCHES the
 *     invite's `email` field can transition it to `accepted` AND only
 *     if status is still `pending` AND expiresAt is in the future
 *   - Owner/admin of the inviting business can revoke (transition to
 *     `revoked`) any of their own invites
 *
 * See `firestore.rules` and `docs/INVITES-SETUP.md` for the rule block.
 */
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface InviteDoc {
  /** Random URL-safe token — also the document ID. Used as the
   *  single value in the invite link's query param (?invite=<token>). */
  id: string;
  /** Same as `id`. Stored as a field for query-friendliness and
   *  explicit-naming clarity in rule expressions. */
  token: string;
  /** Lowercased email the invite was issued to. Acceptance is gated
   *  on `request.auth.token.email.lower() == this.email`. */
  email: string;
  /** Business the invitee will be attached to on acceptance. */
  businessId: string;
  /** Role assigned on acceptance. Owner is excluded — owners are
   *  seeded on first signup, never invited. */
  role: 'admin' | 'technician';
  /** Lifecycle state. `pending` → `accepted` | `revoked` | `expired`.
   *  Expired transitions can be done client-side lazily on read, OR by
   *  a future scheduled Cloud Function. */
  status: InviteStatus;
  /** Auth uid of the user who created the invite. Required for audit
   *  trail and to satisfy the Firestore rule that limits invite creation
   *  to verified members of the target business. */
  invitedBy: string;
  /** Optional display name of the inviter — surfaced in the accepting
   *  UI ("You've been invited by Alex"). */
  invitedByDisplayName?: string;
  /** Business name at time of invite — surfaced in the accepting UI
   *  so the invitee knows which business they're joining. */
  businessName?: string;
  /** ISO timestamp the invite was created. Used for sort order. */
  invitedAt: string;
  /** ISO timestamp after which the invite cannot be accepted.
   *  Default: 14 days from invitedAt. Firestore rules block any
   *  accept transition where this is in the past. */
  expiresAt: string;
  /** ISO timestamp the invite was accepted. Null until acceptance. */
  acceptedAt?: string;
  /** Auth uid of the user who accepted. Null until acceptance. */
  acceptedByUid?: string;
  /** Optional free-form note from the inviter. */
  note?: string;
}

/**
 * Permission flags resolved from the current user's role + business plan.
 * Computed by MembershipContext and read by components to gate UI.
 *
 * Keep this aligned with MembershipContext's permission resolver — if
 * you add a flag here, the resolver must compute it.
 */
export interface Permissions {
  // Financial visibility
  canViewFinancials: boolean;
  canViewRevenue: boolean;
  canViewProfit: boolean;
  canManageExpenses: boolean;
  // Inventory
  canManageInventory: boolean;
  // Pricing
  canEditPricingSettings: boolean;
  canViewPricingSettings: boolean;
  canUsePricingEngine: boolean;
  canOverrideJobPrice: boolean;
  // Team + billing
  canManageTeam: boolean;
  canManageOwners: boolean;
  canManageBilling: boolean;
  // Business settings + branding
  canEditBusinessSettings: boolean;
  canUploadLogo: boolean;
  // Customer-facing actions
  canGenerateInvoices: boolean;
  canSendReviews: boolean;
  // Jobs
  canCreateJobs: boolean;
  canEditJobs: boolean;
  canDeleteJobs: boolean;
  // Analytics
  canViewAdvancedReports: boolean;
}

// ─────────────────────────────────────────────────────────────────────
//  Brand
// ─────────────────────────────────────────────────────────────────────

export interface Brand {
  businessName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  phone: string;
  email: string;
  website: string;
  reviewUrl: string;
  /** When false, suppress the post-payment review-request prompt.
   *  undefined / true → prompt on (default). Lives next to
   *  reviewUrl — both are review configuration. */
  autoReviewPrompt?: boolean;
  invoiceFooter: string;
  serviceArea: string;
  businessType: string;
  tagline: string;
  state?: string;
  mainCity?: string;
  fullLocationLabel?: string;
  serviceCities?: string[];
  serviceRadius?: number;
  onboardingComplete?: boolean;
  /** ISO timestamp when onboarding finished. Used by the existing-
   *  customer trial migration in App.tsx + the grandfather check in
   *  planAccess.ts (isExistingCustomer) to identify accounts that
   *  signed up before the paywall flip and deserve a 14-day trial
   *  on their first post-flip visit. */
  onboardingCompletedAt?: string | null;
  /** When true, the invoice renders a warranty box near the footer with
   *  warrantyText. When false/missing, the box is omitted entirely. */
  warrantyEnabled?: boolean;
  /** Text shown inside the invoice warranty box when warrantyEnabled is
   *  true. Suggested defaults: "90-day workmanship warranty on eligible
   *  services." */
  warrantyText?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Pricing
// ─────────────────────────────────────────────────────────────────────

export interface ServicePricing {
  enabled: boolean;
  basePrice: number;
  minProfit: number;
}

export interface VehiclePricing {
  addOnProfit: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Expenses
//
//  An Expense is any money-out event for the business. The system
//  supports four distinct flavors via the `type` field:
//
//    • recurring     — monthly subscriptions / fixed costs (insurance,
//                       rent, software). `active` toggles them on/off
//                       without losing history.
//    • one_time      — a single money-out event with a date (a tank
//                       of gas, a toll, a hand tool).
//    • job_linked    — a one-time expense attached to a specific job
//                       via `jobId`. Caller decides whether it also
//                       reduces job profit (typically yes for parts /
//                       tire purchase, no for tolls / gas — UI shows
//                       a hint either way).
//    • inventory     — bulk purchase of inventory items. Tracked here
//                       for business net profit, but the per-unit cost
//                       flows into Job COGS via the existing
//                       inventoryDeduction path so it isn't double-
//                       counted.
//
//  Backward compat: legacy expense docs only carry {id, name, amount,
//  active}. The deserializer fills `type: 'recurring'` and
//  `category: 'other'` so they continue to behave exactly as before.
// ─────────────────────────────────────────────────────────────────────

export type ExpenseCategory =
  | 'gas'
  | 'tolls'
  | 'tire_purchase'
  | 'parts'
  | 'tools'
  | 'insurance'
  | 'marketing'
  | 'supplies'
  | 'rent_storage'
  | 'software'
  | 'other';

export type ExpenseType =
  | 'recurring'
  | 'one_time'
  | 'job_linked'
  | 'inventory';

export type ExpensePaymentMethod =
  | 'cash' | 'card' | 'zelle' | 'venmo' | 'cashapp' | 'check' | 'other';

export interface Expense {
  id: string;
  /** Human-readable label. For recurring expenses this is the
   *  subscription / vendor name ("Geico", "Adobe CC"). For one-time
   *  expenses the UI defaults this from the category if not set. */
  name: string;
  amount: number;
  /** Recurring-expense on/off toggle. Ignored for non-recurring types
   *  (one-time / job_linked / inventory always count as actuals). */
  active: boolean;
  /** Spend category — see EXPENSE_CATEGORIES. Drives the dashboard
   *  breakdown and reporting. Legacy docs default to 'other'. */
  category?: ExpenseCategory;
  /** Lifecycle type — see comment block above the interface. Legacy
   *  docs default to 'recurring'. */
  type?: ExpenseType;
  /** ISO date (YYYY-MM-DD). Required for one_time / job_linked /
   *  inventory so they can be summed into weekly / monthly windows.
   *  Recurring expenses don't carry a date — they accrue every month. */
  date?: string;
  /** Free-text notes / receipt reference. */
  notes?: string;
  /** How it was paid. Helps reconciliation. */
  paymentMethod?: ExpensePaymentMethod;
  /** Vendor / source — free text ("Shell", "Discount Tire", etc). */
  vendor?: string;
  /** When type === 'job_linked', the job this expense belongs to. */
  jobId?: string;
  /** ISO timestamp the row was created. Used for audit + sort order. */
  createdAt?: string;
}

/** Ordered list of all expense categories — drives chip rendering. */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'gas', 'tolls', 'tire_purchase', 'parts', 'tools',
  'insurance', 'marketing', 'supplies', 'rent_storage',
  'software', 'other',
];

/** Display labels (kept here, not in a translation file, because the
 *  app is English-only for v1). */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  gas:           'Gas',
  tolls:         'Tolls',
  tire_purchase: 'Tire Purchase',
  parts:         'Parts',
  tools:         'Tools',
  insurance:     'Insurance',
  marketing:     'Marketing',
  supplies:      'Supplies',
  rent_storage:  'Rent / Storage',
  software:      'Software',
  other:         'Other',
};

/** Display labels for the lifecycle type. */
export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  recurring:  'Recurring',
  one_time:   'One-time',
  job_linked: 'Job-linked',
  inventory:  'Inventory purchase',
};

// ─────────────────────────────────────────────────────────────────────
//  Inventory
// ─────────────────────────────────────────────────────────────────────

export interface ReservedSlot {
  /** Stable id for this reservation row (uid() at creation). */
  id: string;
  /** Quantity reserved against this slot (≥ 1). */
  qty: number;
  /** Optional free-text label ("5 PM Smith job", "Insurance hold"). */
  label?: string;
  /** ISO timestamp when the reservation was created. */
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  /** Tire-vertical primary key (tire size, e.g. "225/65R17"). Always
   *  present on tire items. Empty string on mechanic / detailing items
   *  (those use their own primary descriptor fields below). */
  size: string;
  qty: number;
  cost: number;
  notes?: string;
  condition?: string;
  brand?: string;
  model?: string;
  /** Phase 3 — operator-marked reservations against this item's
   *  qty. availableQty = max(0, qty − sum(reservations[].qty)).
   *  v1: no jobId link, no auto-release, free-text label only. */
  reservations?: ReservedSlot[];
  /** Phase 3 — supplier / purchase source as free text. Future
   *  iterations may add per-source analytics. */
  purchaseSource?: string;
  /** Per-item low-stock threshold. Falls back to a global default (1)
   *  when undefined so legacy items keep current behavior. The
   *  inventory list highlights any item whose qty <= reorderPoint. */
  reorderPoint?: number;
  _isNew?: boolean;

  // ─── Mechanic-specific optional fields (Phase 2.1 + 2.2) ──────────
  // Declared on the shared InventoryItem type so the same Firestore
  // collection holds tire / mechanic / detailing stock without a
  // schema migration. Mechanic UI writes the partNumber / partName /
  // supplier / unitCost / retailPrice block; tire UI ignores them.
  // `unitCost` is the mechanic-side analogue of `cost`; on save the
  // mechanic UI mirrors unitCost → cost so the existing deduction
  // engine continues to read `cost` without modification.
  partNumber?: string;
  partName?: string;
  supplier?: string;
  unitCost?: number;
  retailPrice?: number;
  subcategory?: string;
  laborHoursDefault?: number;
  compatibleVehicles?: ReadonlyArray<string>;
  warrantyDays?: number;
  locationBin?: string;

  // ─── Shared mechanic + detailing optional field ──────────────────
  // `category` is config-driven via vertical.inventoryFields[].options;
  // mechanic seeds 10 categories, detailing seeds its own. Same field,
  // different option lists per vertical.
  category?: string;

  // ─── Detailing-specific optional fields ──────────────────────────
  chemicalName?: string;
  dilutionRatio?: string;
}

export interface InventoryDeduction {
  id: string;
  size: string;
  qty: number;
  cost: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Mechanic parts (Phase 2.2 Sub-Project A)
// ─────────────────────────────────────────────────────────────────────

export interface JobPartLine {
  /** Display name. For inventory-bound lines this mirrors
   *  InventoryItem.partName at save time; for unbound lines it's
   *  free-text. */
  name: string;
  qty: number;
  /** Per-unit price charged to the customer. */
  unitPrice: number;
  /** Per-unit cost basis. Auto-filled from InventoryItem.unitCost when
   *  bound; entered by the tech (or left 0) for bought_for_job /
   *  special_order. */
  unitCost: number;
  source: 'inventory' | 'bought_for_job' | 'special_order';
  /** When source === 'inventory', the InventoryItem.id to deduct. */
  inventoryItemId?: string;
  /** Free-text supplier when source is bought_for_job / special_order. */
  supplier?: string;
  /** Carry-through for warranty annotation on the invoice. */
  warrantyDays?: number;
}

export interface PartsMarginSnapshot {
  revenue: number;
  costBasis: number;
  margin: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Time tracking (Phase 2.4)
// ─────────────────────────────────────────────────────────────────────

export interface TimeSession {
  /** ISO timestamp when work began. */
  startAt: string;
  /** ISO timestamp when work ended. Open (currently-active) session
   *  has endAt undefined. */
  endAt?: string;
  /** Auth uid of whoever clocked. Owner/admin clocking on behalf of
   *  a tech stamps their own uid, not the tech's. */
  byUid: string;
  /** Optional free-text note ("paused for parts pickup", etc.). */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Job
// ─────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  date: string;
  service: string;
  vehicleType: string;
  area: string;
  /**
   * Legacy free-text payment label. Kept for backwards compatibility
   * with existing Firestore documents and UI components reading it.
   * NEW code should write `paymentMethod` (the typed union) instead.
   */
  payment: string;
  /**
   * Canonical typed payment method. Optional so legacy jobs that only
   * have `payment: string` remain readable. Adopting code should set
   * both fields on save until a future migration drops `payment`.
   */
  paymentMethod?: PaymentMethod;
  status: JobStatus;
  source: string;
  customerName: string;
  customerPhone: string;
  /** Customer email — optional; populated by operator when needed
   *  for invoice-send email path. Empty / undefined → mailto: pending
   *  actions render disabled. */
  customerEmail?: string;
  tireSize: string;
  qty: number | string;
  revenue: number | string;
  tireCost: number | string;
  materialCost: number | string;
  miscCost?: number | string;
  miles: number | string;
  note: string;
  emergency: boolean;
  lateNight: boolean;
  highway: boolean;
  weekend: boolean;
  tireSource: TireSource;
  tireBrand?: string;
  tireModel?: string;
  tireVendor?: string;
  tirePurchasePrice?: number | string;
  tireCondition?: 'New' | 'Used' | '';
  tireReceiptUrl?: string;
  tireNotes?: string;
  /** Multi-photo upload — before / after / damage / inspection
   *  shots attached to a job. Each entry is a Firebase Storage
   *  download URL. Captured client-side via PhotoCapture and
   *  compressed to ~200-500KB JPEGs before upload to keep field
   *  bandwidth usage low. Up to 12 photos per job. */
  photos?: string[];
  inventoryDeductions?: InventoryDeduction[] | string | null;
  inventoryUsed?: unknown;
  paymentStatus: PaymentStatus;
  /** ISO timestamp of when the job was marked Paid. Stamped by handleMarkPaid. */
  paidAt?: string;
  invoiceGenerated: boolean;
  invoiceGeneratedAt?: string | null;
  invoiceNumber?: string | null;
  invoiceSent: boolean;
  invoiceSentAt?: string | null;
  reviewRequested: boolean;
  reviewRequestedAt?: string | null;
  lastEditedAt?: string | null;
  city?: string;
  state?: string;
  fullLocationLabel?: string;
  /** SP2-additive customer/vehicle linkage fields. Stamped by saveJob's
   *  upsertCustomerFromJob hook. SP3 reconciliation backfills them for
   *  pre-SP1 jobs. */
  customerId?: string;
  vehicleId?: string;
  phoneKey?: string;
  /** SP2-additive location fields used by AddressAutofillInput. The
   *  legacy `city` field remains the canonical city write; addressLine
   *  + zipCode are net-new. */
  addressLine?: string;
  zipCode?: string;
  /** SP2-additive fleet identifier. Optional; non-empty values tag the
   *  customer record as a fleet customer via _buildCustomerPatch. */
  companyName?: string;
  /** Auth uid of the user who created the job. Used for technician
   *  attribution on invoices and job cards, plus the role-based
   *  Dashboard filter (technicians see only their own jobs). */
  createdByUid?: string;
  /** ISO timestamp of when the job was first saved. Set once on
   *  initial save; never overwritten. Used to distinguish actual
   *  job-creation time from `date` (the service date, which can be
   *  any day). */
  createdAt?: string;

  // ─── Mechanic-specific job fields (Phase 2.1) ────────────────────
  // Declared optional so tire jobs are unaffected. The Add Job form
  // binding for these lands in task D.5 — until then they remain
  // unwritten on tire saves and read as undefined.
  laborHours?: number | string;
  partsCost?: number | string;
  diagnosticCode?: string;
  vehicleMakeModel?: string;
  mileage?: number | string;
  diagnosticFee?: number | string;

  // ─── Detailing-specific job field (Phase 2.1; populated in 2.3) ──
  vehicleSize?: string;

  // ─── Mechanic parts (Phase 2.2 Sub-Project A) ────────────────────
  /** Structured parts on this job. Sum of (qty × unitPrice) mirrors
   *  to `partsCost` on save for legacy reader compat. */
  parts?: ReadonlyArray<JobPartLine>;
  /** Inventory deductions made by this mechanic-job save. Same shape
   *  as the existing tire `inventoryDeductions`; populated only by
   *  the mechanic save branch. */
  partsInventoryDeductions?: InventoryDeduction[] | null;
  /** Per-job margin snapshot. Populated only when every part line
   *  has unitCost > 0 (a single zero invalidates the whole snapshot). */
  partsMarginSnapshot?: PartsMarginSnapshot;

  // ─── Multi-user (Phase 2.2 Sub-Project B) ────────────────────────
  /** The technician this job is assigned to. Set by owner/admin via
   *  the AddJob assignment picker. Undefined = unassigned (legacy
   *  jobs or owner/admin jobs that bypassed the picker). Technician
   *  saves auto-stamp this to the creator's uid. */
  assignedToUid?: string;

  // ─── Detailing (Phase 2.3) ───────────────────────────────────────
  /** Optional add-on service ids selected on AddJob. Each id resolves
   *  to a service in the active vertical's catalog at invoice render
   *  time. Tire / mechanic jobs leave this undefined. */
  detailingAddons?: ReadonlyArray<string>;

  // ─── Time tracking (Phase 2.4) ───────────────────────────────────
  /** Clock-in/out sessions for this job. Most-recent session with
   *  endAt undefined is the active one. Total time = sum of
   *  (endAt - startAt) for closed sessions + (now - startAt) for the
   *  open session if any. */
  timeSessions?: ReadonlyArray<TimeSession>;
}

// ─────────────────────────────────────────────────────────────────────
//  Settings
// ─────────────────────────────────────────────────────────────────────

export interface Settings {
  businessName: string;
  /**
   * Which business vertical this is — see BusinessTypeKey in
   * src/config/businessTypes/types.ts.
   * Drives the service catalog, job fields, inventory shape, pricing
   * model, and copy via the BUSINESS_TYPE_REGISTRY.
   *
   * OPTIONAL and ADDITIVE: every business that existed before the
   * multi-vertical work has no value here. An absent value is
   * resolved as 'tire' by resolveVerticalKey() in verticalContext.ts,
   * so all existing businesses are correctly treated as tire shops
   * with zero migration.
   *
   * Phase 2.1 renamed 'carwash' to 'detailing' to match product
   * nomenclature; safe rename because no production business has
   * ever had businessType: 'carwash' written.
   */
  businessType?: 'tire' | 'mechanic' | 'detailing';
  owner1Name: string;
  owner2Name: string;
  owner1Active: boolean;
  owner2Active: boolean;
  profitSplit1: number;
  profitSplit2: number;
  weeklyGoal: number;
  /**
   * Day of week the work week starts on. 0=Sunday, 1=Monday, ...
   * 6=Saturday. Defaults to 1 (Monday) when undefined — the most
   * common operational pattern. Used by Dashboard "This Week's
   * Profit" and Payouts "Week's Earnings" calculations.
   *
   * Editable in Settings → Business (owner/admin only).
   */
  workWeekStartDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Weekly completed-jobs goal for individual technicians. Drives
   * the per-technician progress ring on the Dashboard. Defaults to
   * 5 when undefined — a reasonable starting target. Owners can
   * raise/lower this in Settings → Business.
   *
   * Distinct from `weeklyGoal` (which is the company-wide DOLLAR
   * goal). This is jobs, not money — keeps the technician dashboard
   * non-financial when role permissions don't allow $$ visibility.
   */
  technicianWeeklyJobsGoal?: number;
  taxRate: number;
  costPerMile: number;
  defaultTargetProfit: number;
  invoiceTaxRate: number;
  servicePricing: Record<string, ServicePricing>;
  vehiclePricing: Record<string, VehiclePricing>;
  expenses: Expense[];
  freeMilesIncluded?: number;
  tireRepairTargetProfit?: number;
  tireReplacementTargetProfit?: number;

  // ─── Mechanic-related (Phase 2.2 Sub-Project A) ──────────────────
  /** Hourly labor rate. Mechanic uses this; falls back to
   *  mechanic.pricingModel.defaultLaborRate when undefined. */
  laborRate?: number;
  /** Threshold below which inventory rows show the ⚠ LOW badge. */
  lowStockThreshold?: number;
  /** Multiplier applied to unitCost when auto-suggesting retailPrice
   *  in the inventory add/edit sheet. Default 1.5. */
  partsMarkupDefault?: number;
  /** Free-text warranty policy printed at the bottom of mechanic
   *  invoices when set. */
  warrantyPolicy?: string;
  /**
   * Onboarding completion mirrors. The same fields live on the Brand
   * type (since they're written to businesses/{bid}/settings/main),
   * but App.tsx also mirrors them onto the in-memory Settings object
   * so the existing-customer trial migration + shouldLockApp() can
   * read them without taking a dependency on BrandContext.
   */
  onboardingComplete?: boolean;
  onboardingCompletedAt?: string | null;
  /**
   * Subscription tier for this business. Single value ('pro') with
   * the platform's one-plan model. Drives feature gating in
   * MembershipContext and `isProEntitled` checks. New accounts are
   * stamped 'pro' on signup; legacy 'core' docs are treated as
   * pre-migration and surfaced for cleanup at the call site.
   */
  plan?: Plan;
  /**
   * Stripe-aligned subscription state. 'trialing' during the
   * 14-day free trial, 'active' once paying, 'past_due' on failed
   * renewal, 'canceled' after explicit cancel, 'inactive' for
   * pre-Stripe accounts.
   */
  subscriptionStatus?: SubscriptionStatus;
  /** When the free trial began. Stamped on signup (Onboarding finish). */
  trialStartedAt?: Timestamp | Date | string;
  /** When the free trial ends. Cloud Function reads this to flip
   *  subscriptionStatus → past_due / canceled if no payment by then. */
  trialEndsAt?: Timestamp | Date | string;
  /**
   * Plan-determined member cap. Pro accounts default to 5 seats on
   * signup. Cloud Function may raise this for enterprise customers
   * in the future. UI uses this to disable invite-new-member when
   * at capacity.
   */
  maxUsers?: number;
  /**
   * ─── Billing Exemption (VIP / founder / lifetime accounts) ─────────
   *
   * When `billingExempt === true`, this account bypasses ALL Stripe
   * checks and is treated as Pro indefinitely. The exemption layer is
   * tenant-scoped so individual VIP accounts can be granted lifetime
   * access without affecting Stripe billing for every other business.
   *
   * Resolution rules (implemented in `src/lib/planAccess.ts`):
   *   - billingExempt === true → resolved plan is always 'pro'
   *   - Stripe webhook events MUST NOT downgrade exempt accounts; the
   *     `stripeSync.ts` mirror checks `billingExempt` before writing
   *     `subscriptionStatus` / `plan` changes from Stripe.
   *   - Firestore security rules block client-side modification of
   *     exemption fields (see firestore.rules `exemptionFieldsUnchanged`
   *     helper — only Cloud Functions with Admin SDK may write these).
   *
   * To grant lifetime access (NOT client-callable):
   *   Use the Firebase Admin SDK from a Cloud Function or the
   *   Firebase Console directly. Set on `businesses/{id}/settings/main`:
   *     billingExempt: true
   *     subscriptionOverride: 'lifetime'
   *     exemptionGrantedAt: <ISO timestamp>
   *     exemptionGrantedBy: <granter uid or 'admin'>
   *     exemptionReason: <free-form audit string>
   *
   * Currently only the Wheel Rush founder account has this set.
   * Reusable for any future VIP / founder / promotional grant via
   * Admin SDK — never via client code.
   */
  /** Stripe customer id (cus_…). Written by the webhook handler on
   *  the first paid invoice / subscription event for this business.
   *  Used by webhook lookups to find the business doc when only the
   *  Stripe-side identity is available. Never written by the client. */
  stripeCustomerId?: string;
  /** Stripe subscription id (sub_…). Written alongside
   *  stripeCustomerId by the webhook. Drives "Manage subscription"
   *  link generation and webhook routing. Never written by the
   *  client.
   *
   *  As of 2026-05-28 this is ALSO the canonical "Stripe is in the
   *  loop" signal for UI surfaces (TrialCountdownBanner copy, the
   *  cancel/manage CTA in SubscriptionSection). stripeSync.ts mirror
   *  writes it on every snapshot; admin-granted accounts (Wheel
   *  Rush) and the existing-customer migration both leave it unset,
   *  so falsy reliably means "no Stripe subscription on file."
   *  Cleared to null if the mirror finds no active sub. */
  stripeSubscriptionId?: string | null;

  /** Master kill-switch for Stripe billing on this account. When true,
   *  every plan check resolves to Pro regardless of Stripe state. */
  billingExempt?: boolean;
  /** Categorization of the exemption type. 'lifetime' is the default
   *  for founder accounts; 'beta', 'comp', and 'internal' reserved for
   *  future grant types. Free-form string union to keep the schema
   *  flexible without a code change for each new grant category. */
  subscriptionOverride?: 'lifetime' | 'beta' | 'comp' | 'internal';
  /** ISO timestamp of when the exemption was granted. Set by
   *  `setLifetimeAccess()`. Never overwritten by the mirror. */
  exemptionGrantedAt?: string;
  /** Auth uid of the person/system that granted the exemption.
   *  Audit trail for support tickets / billing inquiries. */
  exemptionGrantedBy?: string;
  /** Free-text reason for the exemption (e.g. "Founder account",
   *  "Beta tester comp through 2027-01-01"). Surfaced in the hidden
   *  Settings panel for owner visibility. */
  exemptionReason?: string;

  // ───────────────────────────────────────────────────────────────
  // FOUNDING MEMBER — early-access growth phase
  // ───────────────────────────────────────────────────────────────
  /**
   * Founding Member program (early-access growth phase).
   *
   * During the early-access phase the app runs with `growthMode`
   * enabled (see `src/lib/growthMode.ts`). New signups are stamped
   * `foundingMember: true` and use the product free of charge while
   * Stripe billing enforcement is bypassed.
   *
   * The Stripe architecture underneath is fully preserved — when
   * `growthMode` is later turned off, NEW signups go through the
   * normal Stripe checkout flow, and EXISTING Founding Members get
   * their locked founder discount applied at that point.
   *
   * IMPORTANT — honest framing: Founding Members receive a fixed-term
   * founder discount (`founderDiscountPercent` off, for
   * `founderDiscountTermMonths` months) that is applied WHEN paid
   * billing begins. They are NOT charged during early access, and
   * they are NOT comped forever. The UI copy reflects this exactly:
   * "free during early access, then your founder discount applies."
   *
   * These fields are stamped at signup (Onboarding finish) and are
   * audit data — the billing bypass itself is driven by `growthMode`
   * + `isBillingExempt`, NOT by reading these fields, so turning
   * growthMode off cleanly re-enables enforcement.
   */
  /** True when this account joined during the Founding Member phase. */
  foundingMember?: boolean;
  /** Founder discount percentage locked at signup (e.g. 69 = 69% off).
   *  Applied as a Stripe coupon when paid billing begins. */
  founderDiscountPercent?: number;
  /** How many months the founder discount lasts once billing starts.
   *  After this term the account moves to standard pricing. */
  founderDiscountTermMonths?: number;
  /** True while billing is deferred for this account (early-access
   *  phase). Informational/audit — enforcement is driven by
   *  growthMode, not this flag. */
  billingDeferred?: boolean;
  /** True once the founder rate is locked for this account. Set at
   *  signup; never cleared, so the discount survives reactivation. */
  founderPricingLocked?: boolean;
  /** ISO timestamp of when this account joined as a Founding Member. */
  foundingJoinedAt?: string;

  // ───────────────────────────────────────────────────────────────
  // REFERRAL SYSTEM
  // ───────────────────────────────────────────────────────────────
  /**
   * Unique short referral code for this business. Generated on first
   * write of the Settings doc (via referral.ts ensureReferralCode).
   * Used in `?ref=CODE` URL params on signup. Human-readable, 6-7
   * uppercase alphanumerics. Collision-checked before commit.
   *
   * Examples: 'MSOS7F3', 'WRUSH24', 'ROAD89X'.
   */
  referralCode?: string;
  /**
   * Number of free-month credits this business has been awarded for
   * successful referrals. Each credit = 1 paid month covered by a
   * Stripe Customer Balance adjustment. Incremented by the
   * `onSubscriptionFirstPayment` Cloud Function ONLY. Client cannot
   * write this field (locked in firestore.rules).
   */
  referralCreditsMonths?: number;
  /**
   * Total count of referrals that converted to a paid subscription.
   * Audit counter — never decremented. If a fraudulent referral is
   * revoked via admin, `referralCreditsMonths` is debited but this
   * counter stays so we have a true historical count.
   */
  totalSuccessfulReferrals?: number;
  /**
   * If this business was referred by another business, stores the
   * referrer's businessId. Set during signup from the URL `ref=`
   * parameter. NEVER set by the user after signup — locked in
   * firestore.rules after initial create.
   */
  referredBy?: string;
  /**
   * The referral code that brought this business in. Stored for
   * audit even though `referredBy` is the canonical link.
   */
  referredByCode?: string;
  /**
   * Document id of the corresponding `referrals/{id}` doc that
   * tracks this business's signup. Allows fast lookup of referral
   * state from the business doc.
   */
  referralDocId?: string;

  /**
   * Owner-set flag: whether technicians on this business are allowed to
   * manually override the system-suggested revenue on jobs they log.
   * Pricing settings themselves remain owner-only either way.
   */
  allowTechnicianPriceOverride?: boolean;
  /**
   * Multi-tire job pricing configuration. When present, the pricing
   * engine applies tier-based pricing for jobs with multiple tires
   * (e.g. a 4-tire install uses different rates than a single tire).
   *
   * Sub-fields:
   *   - `replacementMultipliers`: per-quantity revenue multiplier for
   *     replacement jobs. Named tiers (`one`, `two`, `three`, `four`)
   *     match the utility resolver in `utils.ts` — quantities ≥4
   *     fall back to the `four` tier.
   *   - `installationByQuantity`: per-quantity flat install labor
   *     price for customer-supplied tire installations. Same named
   *     tier scheme; `four` covers any qty ≥4.
   *
   * Both sub-fields are required when `multiTirePricing` is set so
   * callers can chain `mt.replacementMultipliers.two` after a single
   * `if (!mt) return` guard without per-property optional chaining.
   * Individual tier values are optional — partial configs fall through
   * to `|| 0` / `|| 1` defaults in the resolver.
   *
   * Read by `replacementMultiplier()` and `installationPriceFor()` in
   * `src/lib/utils.ts`.
   */
  multiTirePricing?: {
    replacementMultipliers: {
      one?: number;
      two?: number;
      three?: number;
      four?: number;
    };
    installationByQuantity: {
      one?: number;
      two?: number;
      three?: number;
      four?: number;
    };
  };
  /**
   * Bag of feature flags toggled by the owner during onboarding and
   * by Cloud Functions on plan changes. Keys here gate experimental or
   * plan-locked features without requiring a schema migration each
   * time a flag is added or retired. Read by Onboarding + defaults.
   *
   * Known keys (non-exhaustive):
   *   - `analyticsDashboard` — unlock the analytics tab
   *   - `multiUserBeta`      — early access to team management
   *   - `aiQuoting`          — AI-assisted price suggestions
   *   - `teamAccess`         — team management UI unlocked
   *   - `technicianRoles`    — role-based access on technician accounts
   *   - `advancedReports`    — advanced analytics dashboard
   */
  featureFlags?: Record<string, boolean>;

  // ─── Customer Directory (SP1 schema — UI lands in SP3) ──────────
  /**
   * When true, every saveJob calls upsertCustomerFromJob to mirror
   * the job into the businesses/{bid}/customers/{cid} entity.
   * Default semantics: undefined === true. Read sites MUST
   * nullish-coalesce: `settings.autoSaveCustomersFromJobs ?? true`.
   * Spec §"Auto-Save Customers Setting (Phase 17)".
   */
  autoSaveCustomersFromJobs?: boolean;

  // ─── Communications (SP1 schema — UI lands in SP4) ──────────────
  /** Communication provider — v1 always 'twilio' (read-only label). */
  communicationProvider?: 'twilio';
  /** Per-business Twilio connect status. Default false. */
  twilioConnected?: boolean;
  /** Voice webhook customer-lookup gate. Default true. */
  incomingCallLookupEnabled?: boolean;
  /** SMS webhook logging gate. Default true. */
  incomingSMSLoggingEnabled?: boolean;
  /** SP7 future-ready flag. Default false. v1 reads only. */
  missedCallAutoTextEnabled?: boolean;
  /** sendSMS callable master switch. Default true. */
  outboundSMSEnabled?: boolean;
  /** Outbound SMS provider. v1 default 'native' (device handoff);
   *  'twilio' enables in-app outbound. Read pattern:
   *  `settings.outboundCommunicationProvider ?? 'native'`.
   *  Spec line 2202 + line 2488. */
  outboundCommunicationProvider?: 'native' | 'twilio';

  // ─── Review Automation (SP4A) ────────────────────────────────────
  /** Master switch. When false, the trigger refuses to enqueue and
   *  the Settings → Review Automation section renders muted UI.
   *  Default false — ships OFF, operator opts in.
   *  Spec §"Settings schema additions". */
  reviewAutomationEnabled?: boolean;
  /** Operator-editable SMS body. 7-placeholder template — see
   *  src/lib/reviewTemplate.ts for the supported variables. Default
   *  DEFAULT_REVIEW_TEMPLATE in src/lib/defaults.ts. */
  reviewSmsTemplate?: string;
  /** Minutes between completedAt and sendAfterAt. The drainer runs
   *  every 1 minute so the effective floor is ~1min even for value 0.
   *  Allowed values: 0 | 5 | 15 | 60. */
  reviewDelayMinutes?: 0 | 5 | 15 | 60;
  /** Google Business Profile review URL. Required for the trigger to
   *  enqueue — guard #5 in onJobCompletedReviewRequest. Default ''. */
  googleReviewLink?: string;
  /** Operator's primary service area (e.g. "South Florida"). Used as
   *  the third fallback for {city} when job.city + job.area are both
   *  empty — see renderTemplate() consumers. Optional. */
  serviceArea?: string;

  // ─── Missed Call Recovery (SP4B) ─────────────────────────────────
  /** Operator-provided Twilio number that receives inbound calls.
   *  E.164 format. Routing key for the twilioVoiceStatus webhook.
   *  Default ''. Operator hand-configures the Twilio Console status
   *  callback URL to point at the webhook. */
  twilioPhoneNumber?: string;
  /** Operator-provided Twilio Phone Number SID (PNxxx). Optional
   *  debug field — surfaced in Settings for operator reference only.
   *  Not consumed by any code path. */
  twilioPhoneNumberSid?: string;
  /** Operator-editable SMS body sent on missed-call auto-text.
   *  7-placeholder template — see src/lib/reviewTemplate.ts. Default
   *  DEFAULT_MISSED_CALL_TEMPLATE in src/lib/defaults.ts. */
  missedCallTemplate?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Review Automation (SP4A)
//
//  Two collections under businesses/{bid}/...:
//    - reviewRequests/{requestId}    queue entries (one per trigger fire)
//    - communicationEvents/{eventId} unified audit log; SP4B extends
//
//  Doc-id pattern for reviewRequests: req-{jobId}-{completedDateISO}
//  Re-saving the same job same day = same id = no duplicate (idempotent).
// ─────────────────────────────────────────────────────────────────────

export type ReviewRequestStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';
// Note: 'scheduled' is a UI-only filter (status === 'pending' AND
// sendAfterAt > now). The stored status never takes that value.

export interface ReviewRequest {
  id: string;
  // ─── Source refs ─────────────────────────────────────────────────
  jobId: string;
  customerId: string;
  phoneE164: string;
  // ─── Rendered content ────────────────────────────────────────────
  templateUsed: string;       // raw template at enqueue time (audit)
  templateRendered: string;   // final SMS body that ships
  // ─── Scheduling ──────────────────────────────────────────────────
  sendAfterAt: Timestamp;
  status: ReviewRequestStatus;
  retryCount: number;
  // ─── Outcome ─────────────────────────────────────────────────────
  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;
  // ─── Future-ready (addition #8) ──────────────────────────────────
  twilioMessageSid?: string;
  deliveryStatus?: string;    // Twilio lifecycle: queued|sending|sent|delivered|undelivered|failed
  carrierResponse?: string;   // raw carrier error code/message
  // ─── Flags ───────────────────────────────────────────────────────
  isTest?: boolean;
  isManual?: boolean;
  invokedByUid?: string;      // 'system:reviewAutomation' or real uid
}

export type CommunicationEventType =
  | 'review_request_sent'             // SP4A
  | 'review_request_failed'           // SP4A
  | 'review_request_skipped'          // SP4A (reserved)
  | 'missed_call_received'            // SP4B — webhook acknowledges receipt
  | 'missed_call_auto_text_sent'      // SP4B — drainer success on missed_call_response
  | 'missed_call_auto_text_failed'    // SP4B — drainer failure on missed_call_response
  | 'outbound_sms_sent'               // SP4B — drainer success on manual_lead_reply
  | 'outbound_sms_failed';            // SP4B — drainer failure on manual_lead_reply
  // SP4C will add 'inbound_sms_received'.

export interface CommunicationEvent {
  id: string;
  type: CommunicationEventType;
  channel: 'sms' | 'call' | 'email';
  direction: 'outbound' | 'inbound';
  customerId: string;
  jobId?: string;
  reviewRequestId?: string;
  leadId?: string;                  // SP4B addition — back-ref to Lead
  content?: string;                 // rendered SMS body for sent events
  status: 'sent' | 'failed' | 'queued' | 'skipped';
  providerMessageId?: string;       // Twilio MessageSid
  deliveryStatus?: string;
  carrierResponse?: string;
  sentAt: Timestamp;
  createdByUid: string;             // 'system:reviewAutomation' | uid
}

// ─────────────────────────────────────────────────────────────────────
//  Missed Call Recovery (SP4B)
//
//  Two collections under businesses/{bid}/...:
//    - leads/{leadId}              — Lead queue; workflow state machine
//    - outboundSms/{smsId}         — outbound SMS queue (sibling of SP4A
//                                    reviewRequests; separate drainer)
//
//  Doc id pattern for leads: lead-{phoneDigits}-{dateISO}
//  Same caller + same day = same id = silent dedup
// ─────────────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'New'
  | 'Contacted'
  | 'Quoted'
  | 'Booked'
  | 'Closed'
  | 'Lost';

export type LeadSource = 'missed_call' | 'inbound_sms' | 'manual';

export type CallStatus = 'no-answer' | 'busy' | 'failed' | 'voicemail';

export interface Lead {
  id: string;
  customerId: string;
  phoneE164: string;
  source: LeadSource;
  status: LeadStatus;
  wasNewCustomer: boolean;

  // ── First-touch metadata ─────────────────────────────────────────
  callSid?: string;
  callStatus?: CallStatus;
  receivedAt: Timestamp;

  // ── Auto-text outcome ────────────────────────────────────────────
  autoTextSent: boolean;
  autoTextSentAt?: Timestamp;
  outboundSmsId?: string;

  // ── Operator workflow ────────────────────────────────────────────
  notes?: string;
  assignedToUid?: string;
  jobId?: string;
  closedAt?: Timestamp;
  closedReason?: string;

  // ── Audit ────────────────────────────────────────────────────────
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastEditedByUid: string;
}

export type OutboundSmsKind = 'missed_call_response' | 'manual_lead_reply';

export type OutboundSmsStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface OutboundSms {
  id: string;
  kind: OutboundSmsKind;
  // Source refs — leadId always present for SP4B
  leadId: string;
  customerId: string;
  phoneE164: string;
  // Rendered content
  templateUsed: string;
  templateRendered: string;
  // Scheduling
  sendAfterAt: Timestamp;
  status: OutboundSmsStatus;
  retryCount: number;
  // Outcome
  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;
  // Twilio outcome / future-ready
  twilioMessageSid?: string;
  deliveryStatus?: string;
  carrierResponse?: string;
  // Flags
  isTest?: boolean;
  isManual?: boolean;
  invokedByUid: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Quote engine
// ─────────────────────────────────────────────────────────────────────

export interface QuoteForm {
  service: string;
  vehicleType: string;
  miles?: number | string;
  tireCost?: number | string;
  materialCost?: number | string;
  miscCost?: number | string;
  qty?: number | string;
  revenue?: number | string;
  emergency?: boolean;
  lateNight?: boolean;
  highway?: boolean;
  weekend?: boolean;

  // ─── Mechanic-quote inputs (optional) ───────────────────────────
  // Used by the labor_parts quote engine. AddJob populates these
  // from DynamicJobField bindings as the technician fills the form,
  // so the live suggested price updates as soon as hours / parts /
  // diagnostic are entered. Absent / undefined for tire quotes.
  laborHours?: number | string;
  partsCost?: number | string;
  diagnosticFee?: number | string;

  // ─── Detailing-quote input (Phase 2.3) ──────────────────────────
  vehicleSize?: string;
  /** Detailing add-on service ids selected on the quote form. Each
   *  resolves to a service in settings.servicePricing at calc time. */
  detailingAddons?: ReadonlyArray<string>;
}

export interface QuoteResult {
  suggested: number;
  premium: number;
  directCosts: number;
  targetProfit: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Toasts
// ─────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'warn' | 'error' | 'info';

export interface ToastItem {
  id: string;
  msg: string;
  type: ToastType;
  ts: number;
  /** Optional inline action button. When set, ToastHost renders a
   *  button labeled `action.label` next to the message; tapping
   *  calls `action.onTap()` and dismisses the toast. */
  action?: {
    label: string;
    onTap: () => void;
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Notifications (Phase 2.2 Sub-Project D)
// ─────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────
//  Display label helpers — kept here so payment-method UIs across the
//  app render consistently. The canonical store value is the lowercase
//  PaymentMethod above; this is the human label for picker/badge UI.
// ─────────────────────────────────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  zelle: 'Zelle',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  check: 'Check',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  other: 'Other',
};

// ─────────────────────────────────────────────────────────────────────
// REFERRAL SYSTEM TYPES
//
// Top-level `referrals/{referralId}` collection tracks every referral
// signup. Lifecycle:
//
//   pending    → New business signed up via ref code, no Stripe sub yet
//   trialing   → Stripe sub created, in 14-day free trial
//   converted  → First successful PAID invoice processed (post-trial)
//   rewarded   → Credit applied to referrer's Stripe balance
//   canceled   → Referred business canceled before first paid payment
//   fraudulent → Flagged by anti-fraud heuristics, no reward granted
//
// All writes happen server-side via Cloud Functions or Admin SDK.
// Firestore rules block client writes entirely.
// ─────────────────────────────────────────────────────────────────────

export type ReferralStatus =
  | 'pending'
  | 'trialing'
  | 'converted'
  | 'rewarded'
  | 'canceled'
  | 'fraudulent';

export interface ReferralDoc {
  /** Document id — random ULID-like string. */
  id: string;
  /** Business id of the referrer (the one who shared their link). */
  referrerBusinessId: string;
  /** Business id of the new account that signed up via the link. */
  referredBusinessId: string;
  /** Auth uid of the new account. Used for tying back to the
   *  Stripe customer doc at /customers/{uid}. */
  referredUid: string;
  /** Email of the new account at signup time. Used for fraud
   *  velocity checks and human audit. */
  referredEmail: string;
  /** The exact code that was used (denormalized for audit even
   *  though we have referrerBusinessId). */
  referralCode: string;
  /** Lifecycle state. See ReferralStatus union. */
  status: ReferralStatus;

  /** ISO timestamps. */
  createdAt: string;
  /** When the new account started a Stripe trial. */
  trialingAt?: string;
  /** When the new account's first paid invoice succeeded. */
  convertedAt?: string;
  /** When the referrer's credit was applied. */
  rewardedAt?: string;
  /** When the referral was canceled (subscription canceled before
   *  first paid invoice). */
  canceledAt?: string;

  /** Stripe IDs — populated by the Cloud Function as the lifecycle
   *  progresses. */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeBalanceTransactionId?: string;
  /** ISO timestamp of the first successful paid invoice from Stripe. */
  firstSuccessfulPaymentAt?: string;
  /** Dollar amount of the credit applied (typically the referrer's
   *  current monthly plan price). Stored for audit. */
  creditAmountUsd?: number;

  /** Anti-fraud flags raised during evaluation. Empty array = clean.
   *  Cloud Function refuses to reward referrals with any flags
   *  unless an admin manually approves via the admin tool. */
  fraudFlags?: string[];
  /** Free-text admin notes — added via admin tools. */
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Customer + Vehicle entities (SP1 — Customer Intelligence v3.2)
//  Defined in src/lib/customerEntity.ts; re-exported here for
//  ergonomic imports — `import type { Customer } from '@/types';`
// ─────────────────────────────────────────────────────────────────────
export type { Customer, Vehicle } from '@/lib/customerEntity';
