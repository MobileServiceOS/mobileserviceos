// src/lib/customerEntity.ts
// ═══════════════════════════════════════════════════════════════════
//  Customer + Vehicle entities.
//
//  Customer doc path: businesses/{bid}/customers/{customerId}
//  Vehicle  doc path: businesses/{bid}/customers/{customerId}/vehicles/{vehicleId}
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Data Model" (Customer table, Vehicle table)
//
//  This file lands TYPES only in SP1 Task 2. The transactional
//  upsertCustomerFromJob helper is added in Task 4.
//
//  All rollup fields are OPTIONAL — legacy docs and the first-create
//  case both lack them, and read sites MUST nullish-coalesce.
// ═══════════════════════════════════════════════════════════════════

/** Top-level Customer doc. */
export interface Customer {
  /** Doc ID: `p_<11-digit phoneKey>` or `n_<slug>`. */
  id: string;
  /** Display name. Migrated from Job.customerName on first upsert. */
  name: string;
  /** Lowercased name for global-search prefix queries (v2). */
  nameLower?: string;

  /** Reserved for future fleet workflow features. Default 'individual'. */
  kind?: 'individual' | 'fleet';
  /** Business / fleet name. Informational when kind==='individual'. */
  companyName?: string;
  companyLower?: string;

  /** E.164 form (e.g. '+13058977030'). Only written when phone is valid. */
  phoneE164?: string;
  /** Digits-only form (e.g. '13058977030'). Indexed. Primary lookup field. */
  phoneKey?: string;

  email?: string;
  addressLine?: string;
  city?: string;
  cityLower?: string;
  state?: string;
  zipCode?: string;

  /** EXISTING free-text operator note (preserved from CustomerMeta). */
  note?: string;
  /** EXISTING tag list (preserved from CustomerMeta). */
  tags?: string[];

  // ─── v3.2 Quick Notes (refinement #2) — schema-only in SP1 ──────
  gateCode?: string;
  apartmentNumber?: string;
  wheelLockKeyLocation?: string;
  tpmsNotes?: string;
  preferredPaymentMethod?: string;
  parkingInstructions?: string;
  preferredContactMethod?: 'phone' | 'sms' | 'email';
  generalNotes?: string;

  // ─── Lifecycle timestamps ───────────────────────────────────────
  firstJobAt?: string;   // ISO from client; Timestamp from server
  lastJobAt?: string;
  lastJobId?: string;

  // ─── Rollups ────────────────────────────────────────────────────
  jobCount?: number;
  lifetimeRevenue?: number;
  averageTicket?: number;
  vipTier?: 'Standard' | 'Gold' | 'Platinum';
  customerStatus?: 'Active' | 'Inactive' | 'Fleet' | 'VIP' | 'Archived';
  /** Written by SP3 referral surface — schema-only here. */
  referralCount?: number;
  /** Written by SP3 photo gallery — schema-only here. */
  photoCount?: number;

  // ─── Audit ──────────────────────────────────────────────────────
  createdByUid?: string;
  createdAt?: string;     // ISO from client
  updatedAt?: string;
  lastEditedByUid?: string;
  lastEditedAt?: string;
  /** Set by SP3 Call/Text buttons. Allowlisted in identity-upsert rule
   *  (firestore.rules Task 7) so SP3 writes don't require schema churn. */
  lastContactedAt?: string;

  // ─── Idempotency ────────────────────────────────────────────────
  /** Bounded list of jobIds already absorbed by upsertCustomerFromJob.
   *  FIFO eviction at ~500 entries (see customerEntity.ts Task 4). */
  processedJobIds?: string[];

  // ─── Soft-delete (SP3 surface) ──────────────────────────────────
  deletedAt?: string;
}

/** Vehicle subdoc under a Customer. */
export interface Vehicle {
  id: string;
  // Universal core
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  color?: string;
  vin?: string;
  licensePlate?: string;
  /** Lowercased "make model" for global-search prefix queries. */
  makeModelLower?: string;

  // Legacy compatibility
  vehicleMakeModel?: string;
  vehicleType?: string;
  vehicleSize?: string;

  // Tire-vertical top-level fields (v3 — were under .tire in v2)
  tireSize?: string;
  alternateTireSize?: string;
  tireBrand?: string;
  tireCondition?: string;
  tpmsNotes?: string;
  wheelLockNotes?: string;
  serviceNotes?: string;

  // Rollups
  lastServicedAt?: string;
  lastServiceDate?: string;
  lastJobId?: string;
  serviceCount?: number;

  createdAt?: string;
  updatedAt?: string;
  processedJobIds?: string[];
}
