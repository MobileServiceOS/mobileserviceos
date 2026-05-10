import type { Job, Settings, InventoryItem, InventoryDeduction, PaymentStatus, QuoteForm, QuoteResult } from '@/types';
import { DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING, TIRE_MATERIAL_SERVICES, SERVICE_ICONS } from '@/lib/defaults';

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function r2(n: number | string | null | undefined): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export function money(n: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function fmtDate(d: string): string {
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d || '';
  }
}

export function haptic(ms = 10): void {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* noop */
  }
}

export function isValidHex(h: unknown): boolean {
  return typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h);
}

export function applyBrandColors(primary: string, accent: string): void {
  const root = document.documentElement;
  const p = isValidHex(primary) ? primary : '#c8a44a';
  const a = isValidHex(accent) ? accent : '#e5c770';
  root.style.setProperty('--brand-primary', p);
  root.style.setProperty('--brand-accent', a);
  const pR = parseInt(p.slice(1, 3), 16),
    pG = parseInt(p.slice(3, 5), 16),
    pB = parseInt(p.slice(5, 7), 16);
  root.style.setProperty('--brand-primary-dim', `rgba(${pR},${pG},${pB},.12)`);
  root.style.setProperty('--brand-primary-glow', `rgba(${pR},${pG},${pB},.25)`);
  const aR = parseInt(a.slice(1, 3), 16),
    aG = parseInt(a.slice(3, 5), 16),
    aB = parseInt(a.slice(5, 7), 16);
  root.style.setProperty('--brand-accent-dim', `rgba(${aR},${aG},${aB},.12)`);
  root.style.setProperty('--brand-accent-glow', `rgba(${aR},${aG},${aB},.3)`);
}

export function getWeekStart(d: string): string {
  const dt = new Date(d + 'T12:00:00');
  const day = dt.getDay();
  dt.setDate(dt.getDate() - (day >= 5 ? day - 5 : day + 2));
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function jobDirectCost(j: Job, s: Settings): number {
  return r2(
    Number(j.miles || 0) * Number(s.costPerMile || 0.65) +
      Number(j.tireCost || 0) +
      Number(j.materialCost || j.miscCost || 0)
  );
}

export function jobGrossProfit(j: Job, s: Settings): number {
  return r2(Number(j.revenue || 0) - jobDirectCost(j, s));
}

export function monthlyFixed(s: Settings): number {
  const exps = Array.isArray(s.expenses) ? s.expenses : [];
  return exps.filter((e) => e.active).reduce((t, e) => t + Number(e.amount || 0), 0);
}

export interface WeekSummary {
  revenue: number;
  directCosts: number;
  grossProfit: number;
  net: number;
  fixed: number;
}

export function weekSummary(wj: Job[], s: Settings): WeekSummary {
  const jobs = Array.isArray(wj) ? wj : [];
  const rev = r2(jobs.reduce((t, j) => t + Number(j.revenue || 0), 0));
  const dc = r2(jobs.reduce((t, j) => t + jobDirectCost(j, s), 0));
  const gp = r2(rev - dc);
  return { revenue: rev, directCosts: dc, grossProfit: gp, net: gp, fixed: 0 };
}

export interface MonthSummary {
  revenue: number;
  tireCosts: number;
  miscCosts: number;
  travelCosts: number;
  directCosts: number;
  grossProfit: number;
  fixed: number;
  net: number;
}

export function monthSummary(mj: Job[], s: Settings): MonthSummary {
  const jobs = Array.isArray(mj) ? mj : [];
  const rev = r2(jobs.reduce((t, j) => t + Number(j.revenue || 0), 0));
  const tc = r2(jobs.reduce((t, j) => t + Number(j.tireCost || 0), 0));
  const mc = r2(jobs.reduce((t, j) => t + Number(j.materialCost || j.miscCost || 0), 0));
  const trav = r2(jobs.reduce((t, j) => t + Number(j.miles || 0) * Number(s.costPerMile || 0.65), 0));
  const dc = r2(tc + mc + trav);
  const gp = r2(rev - dc);
  const fix = monthlyFixed(s);
  return {
    revenue: rev,
    tireCosts: tc,
    miscCosts: mc,
    travelCosts: trav,
    directCosts: dc,
    grossProfit: gp,
    fixed: fix,
    net: r2(gp - fix),
  };
}

export function normalizeTireSize(s: string): string {
  if (!s) return '';
  const m = String(s).match(/(\d{3})\s*[\/\-\s]+\s*(\d{2,3})\s*[\/\-\s]*\s*R?\s*(\d{2})/i);
  return m ? m[1] + '/' + m[2] + 'R' + m[3] : '';
}

export function isTireMaterialService(svc: string): boolean {
  return TIRE_MATERIAL_SERVICES.includes(svc);
}

export function sanitizeInvItem(i: Partial<InventoryItem>): InventoryItem {
  return {
    id: i.id || uid(),
    size: i.size || '',
    qty: Math.max(0, Number(i.qty || 0)),
    cost: Number(i.cost || 0),
    notes: i.notes || '',
    condition: i.condition || 'New',
    brand: i.brand || '',
    model: i.model || '',
  };
}

export interface DeductionPlan {
  deductions: InventoryDeduction[];
  shortfall: number;
}

export function planInventoryDeduction(size: string, qtyNeeded: number, inv: InventoryItem[]): DeductionPlan {
  const norm = normalizeTireSize(size);
  if (!norm || qtyNeeded <= 0) return { deductions: [], shortfall: qtyNeeded };
  const cands = (inv || [])
    .filter((i) => normalizeTireSize(i.size) === norm && Number(i.qty || 0) > 0)
    .sort(
      (a, b) =>
        (a.condition === 'New' ? 0 : 1) - (b.condition === 'New' ? 0 : 1) ||
        Number(b.qty) - Number(a.qty)
    );
  let rem = qtyNeeded;
  const deds: InventoryDeduction[] = [];
  for (const item of cands) {
    if (rem <= 0) break;
    const take = Math.min(rem, Number(item.qty || 0));
    deds.push({ id: item.id, size: item.size, qty: take, cost: Number(item.cost || 0) });
    rem -= take;
  }
  return { deductions: deds, shortfall: Math.max(0, rem) };
}

export function paymentPillClass(ps: string): string {
  switch (ps) {
    case 'Paid':
      return 'green';
    case 'Pending Payment':
      return 'gold';
    case 'Partial Payment':
      return 'orange';
    case 'Cancelled':
      return 'red';
    default:
      return 'green';
  }
}

export function resolvePaymentStatus(job: Job): PaymentStatus {
  if (job.paymentStatus) return job.paymentStatus;
  if (job.status === 'Cancelled') return 'Cancelled';
  return 'Paid';
}

export function serviceIcon(svc: string): string {
  return SERVICE_ICONS[svc] || '🛞';
}

export function calcQuote(form: QuoteForm, settings: Settings): QuoteResult {
  const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
  const vp = settings.vehiclePricing || DEFAULT_VEHICLE_PRICING;
  const sd = sp[form.service] || { basePrice: 100, minProfit: 80, enabled: true };
  const vd = vp[form.vehicleType] || { addOnProfit: 0 };
  const tc = Number(form.tireCost || 0) * Number(form.qty || 1);
  const mc = Number(form.materialCost || form.miscCost || 0);
  const miles = Number(form.miles || 0) * Number(settings.costPerMile || 0.65);
  const dc = tc + mc + miles;
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
    directCosts: dc,
    targetProfit: tp,
  };
}

export function friendlyAuthError(err: { code?: string; message?: string }): string {
  const c = err?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found for that email.',
    'auth/wrong-password': 'Incorrect password — try again or reset.',
    'auth/invalid-credential': "Email or password didn't match.",
    'auth/email-already-in-use': 'An account already exists for that email.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts — try again in a few minutes.',
    'auth/network-request-failed': 'Network issue — check your connection.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  };
  return map[c] || err?.message || 'Something went wrong. Please try again.';
}
