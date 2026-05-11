import type {
  Job,
  Settings,
  QuoteForm,
  QuoteResult,
  InventoryItem,
  InventoryDeduction,
  PaymentStatus,
} from '@/types';
import {
  DEFAULT_SERVICE_PRICING,
  DEFAULT_VEHICLE_PRICING,
  SERVICE_ICONS,
} from '@/lib/defaults';

export const r2 = (n: number): number => Math.round(n * 100) / 100;

export const money = (n: number | string | null | undefined): string => {
  const v = Number(n || 0);
  return '$' + Math.round(v).toLocaleString();
};

export const moneyFull = (n: number | string | null | undefined): string => {
  const v = Number(n || 0);
  return '$' + v.toFixed(2);
};

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function fmtDate(d: string): string {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getWeekStart(d: string): string {
  const dt = new Date(d + 'T12:00:00');
  const day = dt.getDay();
  dt.setDate(dt.getDate() - (day >= 5 ? day - 5 : day + 2));
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function getMonth(d: string): string {
  return (d || '').slice(0, 7);
}

// ============================================================
// PRICING ENGINE — single source of truth
// ============================================================
//
// All travel cost calculations follow the spec:
//   travelCost = max(0, miles - freeMilesIncluded) * costPerMile
//
// Direct cost = tireCost + materialCost + travelCost
// Actual profit = revenue - directCost
//
// suggestedPrice = directCost + targetProfit, rounded up to nearest $5
//   so a customer paying suggestedPrice yields exactly targetProfit profit.

export function travelCost(j: Pick<Job, 'miles'>, s: Settings): number {
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, Number(j.miles || 0) - freeMiles);
  return r2(chargeable * Number(s.costPerMile || 0.65));
}

export function jobDirectCost(j: Job, s: Settings): number {
  return r2(
    travelCost(j, s) +
      Number(j.tireCost || 0) +
      Number(j.materialCost || j.miscCost || 0)
  );
}

export function jobGrossProfit(j: Job, s: Settings): number {
  return r2(Number(j.revenue || 0) - jobDirectCost(j, s));
}

export function monthlyFixed(s: Settings): number {
  return r2(
    (s.expenses || []).filter((e) => e.active).reduce((t, e) => t + Number(e.amount || 0), 0)
  );
}

export interface WeekSummary {
  revenue: number;
  tireCosts: number;
  miscCosts: number;
  travelCosts: number;
  directCosts: number;
  grossProfit: number;
}

export function weekSummary(wj: Job[], s: Settings): WeekSummary {
  const jobs = Array.isArray(wj) ? wj : [];
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const perMile = Number(s.costPerMile || 0.65);
  const rev = r2(jobs.reduce((t, j) => t + Number(j.revenue || 0), 0));
  const tc = r2(jobs.reduce((t, j) => t + Number(j.tireCost || 0), 0));
  const mc = r2(jobs.reduce((t, j) => t + Number(j.materialCost || j.miscCost || 0), 0));
  const trav = r2(
    jobs.reduce((t, j) => t + Math.max(0, Number(j.miles || 0) - freeMiles) * perMile, 0)
  );
  const dc = r2(tc + mc + trav);
  const gp = r2(rev - dc);
  return {
    revenue: rev,
    tireCosts: tc,
    miscCosts: mc,
    travelCosts: trav,
    directCosts: dc,
    grossProfit: gp,
  };
}

export interface MonthSummary extends WeekSummary {
  fixed: number;
  net: number;
}

export function monthSummary(mj: Job[], s: Settings): MonthSummary {
  const ws = weekSummary(mj, s);
  const fix = monthlyFixed(s);
  return { ...ws, fixed: fix, net: r2(ws.grossProfit - fix) };
}

/**
 * Resolve the replacement multiplier for a given quantity.
 * Quantities >4 fall back to the 4-tire multiplier.
 */
function replacementMultiplier(settings: Settings, qty: number): number {
  const mt = settings.multiTirePricing;
  if (!mt) return 1;
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  if (q === 1) return 1;
  if (q === 2) return Number(mt.replacementMultipliers.two || 1);
  if (q === 3) return Number(mt.replacementMultipliers.three || 1);
  return Number(mt.replacementMultipliers.four || 1);
}

/**
 * Resolve the flat installation price for a given quantity.
 * Quantities >4 fall back to the 4-tire price. Returns 0 if no settings.
 */
function installationPriceFor(settings: Settings, qty: number): number {
  const mt = settings.multiTirePricing;
  if (!mt) return 0;
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  if (q === 1) return Number(mt.installationByQuantity.one || 0);
  if (q === 2) return Number(mt.installationByQuantity.two || 0);
  if (q === 3) return Number(mt.installationByQuantity.three || 0);
  return Number(mt.installationByQuantity.four || 0);
}

/**
 * Is this service the flat-rate installation service?
 * Installation is priced by a flat per-quantity price, not by costs+profit.
 */
function isInstallationService(service: string): boolean {
  return service === 'Tire Installation';
}

/**
 * Is this a replacement service (where target profit scales with quantity)?
 */
function isReplacementService(service: string): boolean {
  return service === 'Tire Replacement';
}

export function calcQuote(form: QuoteForm, settings: Settings): QuoteResult {
  const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
  const vp = settings.vehiclePricing || DEFAULT_VEHICLE_PRICING;
  const sd = sp[form.service] || { basePrice: 100, minProfit: 80, enabled: true };
  const vd = vp[form.vehicleType] || { addOnProfit: 0 };
  const qty = Math.max(1, Math.floor(Number(form.qty) || 1));
  const tc = Number(form.tireCost || 0) * qty;
  const mc = Number(form.materialCost || form.miscCost || 0);
  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, Number(form.miles || 0) - freeMiles);
  const travel = chargeable * Number(settings.costPerMile || 0.65);

  // Surcharges apply to all pricing modes
  let surcharges = 0;
  if (form.emergency) surcharges += 30;
  if (form.lateNight) surcharges += 25;
  if (form.highway) surcharges += 20;
  if (form.weekend) surcharges += 15;

  // ── Installation path — flat per-quantity price (customer supplies tires) ──
  // The installation price IS the labor charge. No tire cost is added because
  // the customer brings the tires. Material cost is still added if present
  // (e.g. valve stems).
  if (isInstallationService(form.service)) {
    const flatLabor = installationPriceFor(settings, qty);
    const flatBase = flatLabor + mc + travel + surcharges + Number(vd.addOnProfit || 0);
    let sug = Math.ceil(flatBase / 5) * 5;
    sug = Math.max(sug, Number(sd.basePrice || 0));
    // Direct cost = material + travel (no tire cost). Target profit = flat
    // labor minus any direct labor cost (here, none beyond travel/material).
    const dc = mc + travel;
    const tp = sug - dc; // what the operator actually earns above direct cost
    return {
      suggested: sug,
      premium: Math.ceil((sug * 1.25) / 5) * 5,
      directCosts: r2(dc),
      targetProfit: r2(tp),
    };
  }

  // ── Replacement path — target profit scales with quantity ──
  const baseTargetProfit = Number(sd.minProfit || 0) + Number(vd.addOnProfit || 0);
  const multiplier = isReplacementService(form.service) ? replacementMultiplier(settings, qty) : 1;
  const tp = baseTargetProfit * multiplier;

  const dc = tc + mc + travel;
  let sug = Math.ceil((dc + tp + surcharges) / 5) * 5;
  sug = Math.max(sug, Number(sd.basePrice || 0));

  return {
    suggested: sug,
    premium: Math.ceil((sug * 1.25) / 5) * 5,
    directCosts: r2(dc),
    targetProfit: r2(tp),
  };
}

// ============================================================
// Status helpers
// ============================================================

export function resolvePaymentStatus(j: Job): PaymentStatus {
  if (j.status === 'Cancelled') return 'Cancelled';
  if (j.status === 'Pending') return j.paymentStatus === 'Partial Payment' ? 'Partial Payment' : 'Pending Payment';
  return j.paymentStatus || 'Paid';
}

export function paymentPillClass(ps: PaymentStatus): string {
  if (ps === 'Paid') return 'green';
  if (ps === 'Pending Payment') return 'amber';
  if (ps === 'Partial Payment') return 'amber';
  return 'red';
}

// ============================================================
// Tire size normalization + inventory deduction planner
// ============================================================

export function normalizeTireSize(size: string): string {
  if (!size) return '';
  return size.trim().toUpperCase().replace(/\s+/g, '').replace(/[-_./]/g, '');
}

export interface DeductionPlan {
  deductions: InventoryDeduction[];
  shortfall: number;
}

export function planInventoryDeduction(
  size: string,
  qty: number,
  inv: InventoryItem[]
): DeductionPlan {
  const target = normalizeTireSize(size);
  if (!target || !qty) return { deductions: [], shortfall: qty };
  const matches = (inv || [])
    .filter((i) => normalizeTireSize(i.size) === target && Number(i.qty || 0) > 0)
    .sort((a, b) => Number(a.cost || 0) - Number(b.cost || 0)); // FIFO by cost — cheapest first
  let remaining = qty;
  const out: InventoryDeduction[] = [];
  for (const m of matches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(m.qty || 0));
    if (take > 0) {
      out.push({ id: m.id, size: m.size, qty: take, cost: Number(m.cost || 0) });
      remaining -= take;
    }
  }
  return { deductions: out, shortfall: Math.max(0, remaining) };
}

// ============================================================
// Helpers
// ============================================================

export function serviceIcon(s: string): string {
  return SERVICE_ICONS[s] || '🛞';
}

export function haptic(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(8); } catch { /* ignore */ }
  }
}

export function isValidHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v || '');
}

export function applyBrandColors(primary: string, accent: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isValidHex(primary)) {
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-primary-dim', primary + '22');
    root.style.setProperty('--brand-primary-glow', primary + '66');
  }
  if (isValidHex(accent)) {
    root.style.setProperty('--brand-accent', accent);
  }
}

export function sanitizeInvItem(i: InventoryItem): InventoryItem {
  const { _isNew, ...rest } = i;
  return {
    ...rest,
    size: (rest.size || '').trim(),
    qty: Number(rest.qty || 0),
    cost: Number(rest.cost || 0),
  };
}

export function friendlyAuthError(err: { code?: string; message?: string }): string {
  const c = err?.code || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found')
    return 'Wrong email or password.';
  if (c === 'auth/email-already-in-use') return 'Email is already registered.';
  if (c === 'auth/weak-password') return 'Password too weak — use 6+ characters.';
  if (c === 'auth/invalid-email') return 'That email looks invalid.';
  if (c === 'auth/too-many-requests') return 'Too many tries — wait a moment.';
  if (c === 'auth/network-request-failed') return 'Network error — check your connection.';
  if (c === 'auth/popup-closed-by-user') return 'Sign-in canceled.';
  if (c === 'auth/operation-not-allowed') return 'This sign-in method is not enabled in Firebase Console.';
  if (c === 'auth/unauthorized-domain') return 'This domain is not authorized in Firebase Console.';
  return err?.message || 'Sign-in failed.';
}
