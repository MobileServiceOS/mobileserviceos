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

/**
 * Resolve the ISO date (YYYY-MM-DD) of the start of the week that
 * contains date `d`. The week-start day is configurable per business:
 *
 *   startDay = 0  → Sun..Sat
 *   startDay = 1  → Mon..Sun (default — most common operational pattern)
 *   startDay = 5  → Fri..Thu (legacy default before the setting existed)
 *   startDay = 6  → Sat..Fri
 *
 * When called WITHOUT a startDay arg, defaults to Monday to match the
 * standard ISO week. The callers in Dashboard/Payouts pass
 * `settings.workWeekStartDay` so each business uses its own setting;
 * the default kicks in only when settings haven't loaded yet.
 *
 * Uses noon-anchored Date construction to avoid DST/UTC midnight
 * surprises. Returns the result in America/New_York to match the
 * existing app convention (Wheel Rush operates in EST).
 */
export function getWeekStart(d: string, startDay: number = 1): string {
  const dt = new Date(d + 'T12:00:00');
  const day = dt.getDay();
  // Days to subtract to reach the most recent occurrence of startDay
  // (today inclusive). Always non-negative, in 0..6.
  const diff = (day - startDay + 7) % 7;
  dt.setDate(dt.getDate() - diff);
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

export function calcQuote(form: QuoteForm, settings: Settings): QuoteResult {
  const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
  const vp = settings.vehiclePricing || DEFAULT_VEHICLE_PRICING;
  const sd = sp[form.service] || { basePrice: 100, minProfit: 80, enabled: true };
  const vd = vp[form.vehicleType] || { addOnProfit: 0 };
  const tc = Number(form.tireCost || 0) * Number(form.qty || 1);
  const mc = Number(form.materialCost || form.miscCost || 0);
  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, Number(form.miles || 0) - freeMiles);
  const travel = chargeable * Number(settings.costPerMile || 0.65);
  const dc = tc + mc + travel;
  const tp = Number(sd.minProfit || 0) + Number(vd.addOnProfit || 0);
  let sug = Math.ceil((dc + tp) / 5) * 5;
  if (form.emergency) sug += 30;
  if (form.lateNight) sug += 25;
  if (form.highway) sug += 20;
  if (form.weekend) sug += 15;
  sug = Math.max(sug, Number(sd.basePrice || 0));
  return {
    suggested: sug,
    premium: Math.ceil((sug * 1.25) / 5) * 5,
    directCosts: r2(dc),
    targetProfit: tp,
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
