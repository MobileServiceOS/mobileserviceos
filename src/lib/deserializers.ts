import type { Job, InventoryItem, Expense, ExpenseCategory, ExpenseType, ExpensePaymentMethod, InventoryDeduction, Settings, ServicePricing, JobStatus, PaymentStatus, PaymentMethod, TireSource, JobPartLine, PartsMarginSnapshot, ReservedSlot } from '@/types';
import { EXPENSE_CATEGORIES } from '@/types';
import { EMPTY_JOB, DEFAULT_SERVICE_PRICING } from '@/lib/defaults';

type RawDoc = Record<string, unknown> & { id: string };

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function asNumberOrString(v: unknown): number | string {
  if (typeof v === 'number' || typeof v === 'string') return v;
  return v == null ? '' : String(v);
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true';
  return fallback;
}

function tryParseJSON<T>(v: unknown): T | null {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function deserializeInventoryDeductions(v: unknown): InventoryDeduction[] | null {
  if (Array.isArray(v)) return v as InventoryDeduction[];
  if (typeof v === 'string') {
    const parsed = tryParseJSON<InventoryDeduction[]>(v);
    if (Array.isArray(parsed)) return parsed;
  }
  return null;
}

function deserializeReservations(v: unknown): ReservedSlot[] | undefined {
  let arr: unknown;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = tryParseJSON<unknown>(v);
  else return undefined;
  if (!Array.isArray(arr)) return undefined;
  const out: ReservedSlot[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<ReservedSlot>;
    const id = typeof r.id === 'string' ? r.id : null;
    const qty = typeof r.qty === 'number' && Number.isFinite(r.qty) ? r.qty : NaN;
    const createdAt = typeof r.createdAt === 'string' ? r.createdAt : null;
    if (!id || !Number.isFinite(qty) || qty <= 0 || !createdAt) continue;
    const slot: ReservedSlot = { id, qty, createdAt };
    if (typeof r.label === 'string' && r.label) slot.label = r.label;
    out.push(slot);
  }
  return out.length ? out : undefined;
}

const VALID_STATUSES: JobStatus[] = ['Completed', 'Pending', 'Cancelled'];
const VALID_PAYMENT_STATUSES: PaymentStatus[] = ['Paid', 'Pending Payment', 'Partial Payment', 'Cancelled'];
const VALID_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'apple_pay', 'google_pay', 'other'];
const VALID_TIRE_SOURCES: TireSource[] = ['Inventory', 'Bought for this job', 'Customer supplied'];

function asEnum<T extends string>(v: unknown, valid: readonly T[], fallback: T): T {
  return valid.includes(v as T) ? (v as T) : fallback;
}

export function deserializeJob(raw: RawDoc): Job {
  const empty = EMPTY_JOB();
  return {
    id: asString(raw.id, empty.id),
    date: asString(raw.date, empty.date),
    service: asString(raw.service, empty.service),
    vehicleType: asString(raw.vehicleType, empty.vehicleType),
    area: asString(raw.area, empty.area),
    payment: asString(raw.payment, empty.payment),
    status: asEnum(raw.status, VALID_STATUSES, 'Completed'),
    source: asString(raw.source, empty.source),
    customerName: asString(raw.customerName, empty.customerName),
    customerPhone: asString(raw.customerPhone, empty.customerPhone),
    customerEmail: raw.customerEmail == null ? undefined : asString(raw.customerEmail),
    tireSize: asString(raw.tireSize, empty.tireSize),
    qty: asNumberOrString(raw.qty ?? empty.qty),
    revenue: asNumberOrString(raw.revenue ?? empty.revenue),
    tireCost: asNumberOrString(raw.tireCost ?? empty.tireCost),
    materialCost: asNumberOrString(raw.materialCost ?? empty.materialCost),
    miscCost: asNumberOrString(raw.miscCost ?? empty.miscCost ?? ''),
    miles: asNumberOrString(raw.miles ?? empty.miles),
    note: asString(raw.note, empty.note),
    emergency: asBool(raw.emergency),
    lateNight: asBool(raw.lateNight),
    highway: asBool(raw.highway),
    weekend: asBool(raw.weekend),
    tireSource: asEnum(raw.tireSource, VALID_TIRE_SOURCES, 'Inventory'),
    tireBrand: asString(raw.tireBrand, ''),
    tireModel: asString(raw.tireModel, ''),
    tireVendor: asString(raw.tireVendor, ''),
    tirePurchasePrice: asNumberOrString(raw.tirePurchasePrice ?? ''),
    tireCondition: ((): 'New' | 'Used' | '' => {
      const v = raw.tireCondition;
      return v === 'New' || v === 'Used' ? v : '';
    })(),
    tireReceiptUrl: asString(raw.tireReceiptUrl, ''),
    tireNotes: asString(raw.tireNotes, ''),
    photos: Array.isArray(raw.photos)
      ? (raw.photos as unknown[]).filter((p) => typeof p === 'string') as string[]
      : undefined,
    inventoryDeductions: deserializeInventoryDeductions(raw.inventoryDeductions),
    inventoryUsed: raw.inventoryUsed,
    paymentStatus: asEnum(raw.paymentStatus, VALID_PAYMENT_STATUSES, 'Paid'),
    // Payment timestamp + typed method. Both are read by
    // JobDetailModal (the "Paid via X · {timestamp}" block) and
    // invoice.ts (the PDF payment line). The deserializer was
    // stripping these silently before, so even when handleMarkPaid
    // (or backup-import) wrote them, the UI never saw them.
    paidAt: raw.paidAt == null ? undefined : asString(raw.paidAt),
    paymentMethod: raw.paymentMethod == null
      ? undefined
      : asEnum(raw.paymentMethod, VALID_PAYMENT_METHODS, 'other'),
    invoiceGenerated: asBool(raw.invoiceGenerated),
    invoiceGeneratedAt: raw.invoiceGeneratedAt == null ? null : asString(raw.invoiceGeneratedAt),
    invoiceNumber: raw.invoiceNumber == null ? null : asString(raw.invoiceNumber),
    invoiceSent: asBool(raw.invoiceSent),
    invoiceSentAt: raw.invoiceSentAt == null ? null : asString(raw.invoiceSentAt),
    reviewRequested: asBool(raw.reviewRequested),
    reviewRequestedAt: raw.reviewRequestedAt == null ? null : asString(raw.reviewRequestedAt),
    lastEditedAt: raw.lastEditedAt == null ? null : asString(raw.lastEditedAt),
    city: asString(raw.city, ''),
    state: asString(raw.state, ''),
    fullLocationLabel: asString(raw.fullLocationLabel, ''),

    // ─── Multi-user (Phase 2.2 Sub-Project B) + Phase 2.1 attribution ─
    createdByUid: raw.createdByUid == null ? undefined : asString(raw.createdByUid),
    createdAt: raw.createdAt == null ? undefined : asString(raw.createdAt),
    assignedToUid: raw.assignedToUid == null ? undefined : asString(raw.assignedToUid),

    // ─── Mechanic job fields (Phase 2.1 + 2.2) ─────────────────────
    laborHours: raw.laborHours == null ? undefined : asNumberOrString(raw.laborHours),
    partsCost: raw.partsCost == null ? undefined : asNumberOrString(raw.partsCost),
    diagnosticCode: raw.diagnosticCode == null ? undefined : asString(raw.diagnosticCode),
    vehicleMakeModel: raw.vehicleMakeModel == null ? undefined : asString(raw.vehicleMakeModel),
    mileage: raw.mileage == null ? undefined : asNumberOrString(raw.mileage),
    diagnosticFee: raw.diagnosticFee == null ? undefined : asNumberOrString(raw.diagnosticFee),

    // ─── Detailing job fields (Phase 2.1 + 2.3) ────────────────────
    vehicleSize: raw.vehicleSize == null ? undefined : asString(raw.vehicleSize),
    detailingAddons: Array.isArray(raw.detailingAddons)
      ? (raw.detailingAddons as unknown[]).map((v) => asString(v))
      : undefined,

    // ─── Time tracking (Phase 2.4) ──────────────────────────────────
    timeSessions: Array.isArray(raw.timeSessions)
      ? (raw.timeSessions as unknown[]).map((rs) => {
          const sess = rs as Record<string, unknown>;
          return {
            startAt: asString(sess.startAt),
            endAt: sess.endAt == null ? undefined : asString(sess.endAt),
            byUid: asString(sess.byUid),
            note: sess.note == null ? undefined : asString(sess.note),
          };
        })
      : undefined,

    // ─── Mechanic parts (Phase 2.2 Sub-Project A) ──────────────────
    // parts is structured; let it pass through as the array. Same
    // pattern as inventoryDeductions which already does this.
    parts: Array.isArray(raw.parts)
      ? (raw.parts as unknown as JobPartLine[])
      : undefined,
    partsInventoryDeductions: Array.isArray(raw.partsInventoryDeductions)
      ? (raw.partsInventoryDeductions as unknown as InventoryDeduction[])
      : null,
    partsMarginSnapshot: raw.partsMarginSnapshot && typeof raw.partsMarginSnapshot === 'object'
      ? (raw.partsMarginSnapshot as PartsMarginSnapshot)
      : undefined,
  };
}

export function deserializeInventoryItem(raw: RawDoc): InventoryItem {
  return {
    id: asString(raw.id),
    size: asString(raw.size),
    qty: asNumber(raw.qty),
    cost: asNumber(raw.cost),
    notes: asString(raw.notes, ''),
    condition: asString(raw.condition, 'New'),
    brand: asString(raw.brand, ''),
    model: asString(raw.model, ''),

    // Mechanic-specific (Phase 2.1 + 2.2). All optional; undefined when absent.
    partNumber: raw.partNumber == null ? undefined : asString(raw.partNumber),
    partName: raw.partName == null ? undefined : asString(raw.partName),
    supplier: raw.supplier == null ? undefined : asString(raw.supplier),
    unitCost: raw.unitCost == null ? undefined : asNumber(raw.unitCost),
    retailPrice: raw.retailPrice == null ? undefined : asNumber(raw.retailPrice),
    category: raw.category == null ? undefined : asString(raw.category),
    subcategory: raw.subcategory == null ? undefined : asString(raw.subcategory),
    laborHoursDefault: raw.laborHoursDefault == null ? undefined : asNumber(raw.laborHoursDefault),
    compatibleVehicles: Array.isArray(raw.compatibleVehicles)
      ? (raw.compatibleVehicles as unknown[]).map((v) => asString(v))
      : undefined,
    warrantyDays: raw.warrantyDays == null ? undefined : asNumber(raw.warrantyDays),
    locationBin: raw.locationBin == null ? undefined : asString(raw.locationBin),

    // Detailing-specific (Phase 2.3). The dynamic field system in
    // Inventory.tsx writes these via fbSet, but the deserializer
    // was stripping them on every read — detailing accounts saw
    // their chemical names and dilution ratios silently disappear
    // after a refresh. Same field-drop class as paidAt/paymentMethod
    // on Job (4ce4360).
    chemicalName: raw.chemicalName == null ? undefined : asString(raw.chemicalName),
    dilutionRatio: raw.dilutionRatio == null ? undefined : asString(raw.dilutionRatio),

    // Phase 3 — reservations (JSON-stringified by fbSet on write) and
    // free-text purchase source.
    reservations: deserializeReservations(raw.reservations),
    purchaseSource: raw.purchaseSource == null ? undefined : asString(raw.purchaseSource),
  };
}

function asExpenseCategory(v: unknown): ExpenseCategory | undefined {
  if (typeof v !== 'string') return undefined;
  return (EXPENSE_CATEGORIES as readonly string[]).includes(v)
    ? (v as ExpenseCategory)
    : undefined;
}

function asExpenseType(v: unknown): ExpenseType | undefined {
  if (v === 'recurring' || v === 'one_time' || v === 'job_linked' || v === 'inventory') {
    return v;
  }
  return undefined;
}

function asExpensePaymentMethod(v: unknown): ExpensePaymentMethod | undefined {
  const allowed: ExpensePaymentMethod[] = ['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'other'];
  if (typeof v === 'string' && (allowed as string[]).includes(v)) return v as ExpensePaymentMethod;
  return undefined;
}

export function deserializeExpense(raw: RawDoc): Expense {
  // Backward compat: legacy expense docs only had {id, name, amount,
  // active}. The new schema adds category / type / date / vendor /
  // paymentMethod / jobId / notes. Missing values default to the
  // legacy-equivalent semantics so existing accounts continue to
  // see their recurring fixed costs unchanged.
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    amount: asNumber(raw.amount),
    active: asBool(raw.active, true),
    category:      asExpenseCategory(raw.category) ?? 'other',
    type:          asExpenseType(raw.type) ?? 'recurring',
    date:          raw.date == null          ? undefined : asString(raw.date),
    notes:         raw.notes == null         ? undefined : asString(raw.notes),
    paymentMethod: asExpensePaymentMethod(raw.paymentMethod),
    vendor:        raw.vendor == null        ? undefined : asString(raw.vendor),
    jobId:         raw.jobId == null         ? undefined : asString(raw.jobId),
    createdAt:     raw.createdAt == null     ? undefined : asString(raw.createdAt),
  };
}

export function deserializeOperationalSettings(raw: RawDoc): Partial<Settings> {
  const out: Partial<Settings> & Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (k === 'id') continue;
    const v = raw[k];
    if (k === 'servicePricing' || k === 'vehiclePricing') {
      if (typeof v === 'string') {
        const parsed = tryParseJSON<Record<string, unknown>>(v);
        if (parsed && typeof parsed === 'object') {
          out[k] = parsed as never;
          continue;
        }
      } else if (v && typeof v === 'object') {
        out[k] = v as never;
        continue;
      }
      continue;
    }
    out[k] = v;
  }
  return out as Partial<Settings>;
}

/**
 * Merge any newly-added default services into the user's stored
 * servicePricing map. Returns `{ map, added }` where `added` is the
 * list of service names that were missing and got default-seeded.
 *
 * Used on settings load so existing accounts pick up new services
 * (e.g. "Spare Change" added in 2026-05) without losing any of their
 * own price customizations on existing services. The user's stored
 * entries always win — we only ADD missing keys, never overwrite.
 *
 * The caller is expected to persist the merged map back to Firestore
 * when `added.length > 0`, so the backfill is sticky (no repeated
 * merge on every load). If persistence fails, the next load just
 * re-merges harmlessly.
 *
 * Returns the original reference (no copy) if nothing was added, so
 * callers can compare `result.map === input` as a no-change check.
 */
export function mergeMissingDefaultServices(
  current: Record<string, ServicePricing> | undefined | null,
  /**
   * The catalog whose services should be backfilled. Pass the active
   * vertical's catalog (e.g. `servicePricingFromVertical(vertical)`)
   * so mechanic accounts don't get tire services injected.
   *
   * Defaults to the tire catalog for back-compat with existing
   * callers that haven't migrated to the vertical-aware path yet.
   * The default will be removed in a future phase once every caller
   * passes its catalog explicitly.
   */
  catalog: Record<string, ServicePricing> = DEFAULT_SERVICE_PRICING,
): { map: Record<string, ServicePricing>; added: string[] } {
  const userMap = current && typeof current === 'object' ? current : {};
  const added: string[] = [];
  let merged: Record<string, ServicePricing> | null = null;

  for (const key of Object.keys(catalog)) {
    if (!(key in userMap)) {
      if (!merged) merged = { ...userMap };
      merged[key] = { ...catalog[key] };
      added.push(key);
    }
  }

  if (!merged) return { map: userMap as Record<string, ServicePricing>, added: [] };
  return { map: merged, added };
}

/**
 * Inverse of mergeMissingDefaultServices: removes services from the
 * user's saved servicePricing map that are NOT present in the current
 * DEFAULT_SERVICE_PRICING catalog. Used to clean up accounts that
 * received a service via a past backfill but the service has since
 * been retired from the catalog.
 *
 * Returns a new map (only if changes occurred) and the list of removed
 * service names. If nothing was removed, the original map is returned
 * by reference so callers can cheaply detect "no-op" via identity.
 */
export function stripRetiredServices(
  current: Record<string, ServicePricing> | undefined | null,
  /**
   * The catalog whose services are considered "active." Anything in
   * the user's saved map NOT in this catalog is treated as retired
   * and removed. Pass the active vertical's catalog so a mechanic
   * account's mechanic services aren't stripped out as "retired
   * tire services."
   *
   * Defaults to the tire catalog for back-compat with existing
   * callers; the default will be removed once every caller passes
   * its catalog explicitly.
   */
  catalog: Record<string, ServicePricing> = DEFAULT_SERVICE_PRICING,
): { map: Record<string, ServicePricing>; removed: string[] } {
  const userMap = current && typeof current === 'object' ? current : {};
  const removed: string[] = [];
  let stripped: Record<string, ServicePricing> | null = null;

  for (const key of Object.keys(userMap)) {
    if (!(key in catalog)) {
      if (!stripped) stripped = { ...userMap };
      delete stripped[key];
      removed.push(key);
    }
  }

  if (!stripped) return { map: userMap as Record<string, ServicePricing>, removed: [] };
  return { map: stripped, removed };
}

