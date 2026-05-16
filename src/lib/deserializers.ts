import type { Job, InventoryItem, Expense, InventoryDeduction, Settings, ServicePricing, JobStatus, PaymentStatus, TireSource } from '@/types';
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

const VALID_STATUSES: JobStatus[] = ['Completed', 'Pending', 'Cancelled'];
const VALID_PAYMENT_STATUSES: PaymentStatus[] = ['Paid', 'Pending Payment', 'Partial Payment', 'Cancelled'];
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
    inventoryDeductions: deserializeInventoryDeductions(raw.inventoryDeductions),
    inventoryUsed: raw.inventoryUsed,
    paymentStatus: asEnum(raw.paymentStatus, VALID_PAYMENT_STATUSES, 'Paid'),
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
  };
}

export function deserializeExpense(raw: RawDoc): Expense {
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    amount: asNumber(raw.amount),
    active: asBool(raw.active, true),
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
): { map: Record<string, ServicePricing>; added: string[] } {
  const userMap = current && typeof current === 'object' ? current : {};
  const added: string[] = [];
  let merged: Record<string, ServicePricing> | null = null;

  for (const key of Object.keys(DEFAULT_SERVICE_PRICING)) {
    if (!(key in userMap)) {
      if (!merged) merged = { ...userMap };
      merged[key] = { ...DEFAULT_SERVICE_PRICING[key] };
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
): { map: Record<string, ServicePricing>; removed: string[] } {
  const userMap = current && typeof current === 'object' ? current : {};
  const removed: string[] = [];
  let stripped: Record<string, ServicePricing> | null = null;

  for (const key of Object.keys(userMap)) {
    if (!(key in DEFAULT_SERVICE_PRICING)) {
      if (!stripped) stripped = { ...userMap };
      delete stripped[key];
      removed.push(key);
    }
  }

  if (!stripped) return { map: userMap as Record<string, ServicePricing>, removed: [] };
  return { map: stripped, removed };
}
