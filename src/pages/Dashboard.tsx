import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings, InventoryItem, QuoteForm, TabId, Expense } from '@/types';
import { QuickExpenseSheet } from '@/components/QuickExpenseSheet';
import {
  calcQuote, clamp, fmtDate, fmtDateShort, getWeekStart,
  jobGrossProfit, money, normalizeTireSize, paymentPillClass,
  r2, resolvePaymentStatus, weekSummary,
} from '@/lib/utils';
import { ServiceIcon } from '@/components/ServiceIcon';
import { formatPhonePartial } from '@/lib/formatPhone';
import {
  expenseTotalsInRange,
  monthlyRecurringTotal,
  weeklyRecurringFromMonthly,
  businessNetProfit,
} from '@/lib/expenseCalc';
import { DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING, TODAY } from '@/lib/defaults';
import { useCountUp } from '@/lib/useCountUp';
import { useMembership } from '@/context/MembershipContext';
import { _auth } from '@/lib/firebase';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useScopedJobs } from '@/lib/useScopedJobs';
import { useSwipeAction } from '@/lib/useSwipeAction';

// ─────────────────────────────────────────────────────────────────────
//  Dashboard — hybrid premium + operational
//
//  Combines the visual polish of the redesigned hero (circular progress
//  ring, growth %, premium KPI cards) with the operational density of
//  the production dashboard (pending jobs, pending payments, low stock,
//  quick quote, recent jobs).
//
//  Role-aware:
//    OWNER / ADMIN — see company-wide profit, revenue, costs, goal %,
//                    growth vs last week, pending payments, low stock,
//                    lead sources, all jobs in recent feed
//    TECHNICIAN   — see their own jobs: ones they logged OR ones an
//                   owner dispatched to them (assigned-OR-created union,
//                   via useScopedJobs). Hero shows completed-jobs vs personal
//                   weekly goal, not company $$. Growth % is their own
//                   week-over-week. No pending payments. No company
//                   revenue/costs. Job-count framing throughout.
//
//  Defensive defaults: if membership is loading or role can't be
//  resolved, default to the technician (safer) view to avoid leaking
//  company financials. Owners and admins explicitly need a resolved
//  role to see financial data.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs: Job[];
  settings: Settings;
  inventory: InventoryItem[];
  setTab: (t: TabId) => void;
  /** Start a blank new job — resets the draft + clears edit context.
   *  Use this for every "log a new job" CTA; setTab('add') alone
   *  preloads the last-saved job into the form. */
  onNewJob: () => void;
  /** One-tap Quote → Job: carries the Quick Quote's service / vehicle /
   *  pricing / surcharges (+ optional phone & tire size) into a prefilled
   *  Add Job so the operator re-enters nothing already captured. */
  onQuoteToJob: (draft: Partial<Job>) => void;
  onViewJob: (j: Job) => void;
  onGenerateInvoice: (j: Job) => void;
  /** Optional invoice-send handler. Reserved for future per-job
   *  shortcut buttons; declared so the call-site type checks. */
  onSendInvoice?: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
  onEditJob: (j: Job) => void;
  /** Persist a single new expense from the quick-log sheet. Threaded
   *  from App.tsx's persistExpenses so the Dashboard can log without
   *  navigating to the Expenses page. */
  onLogExpense?: (e: Expense) => void;
}

// ────── Circular progress ring (SVG, no library) ────────────────────
//
// Renders a circular ring with track + filled arc and centered content.
// Stroke uses semantic colors: green ≥ 100%, gold 50-99%, amber 25-49%,
// dim < 25%. Standard SVG circumference math (2πr) maps the arc length
// to a 0..100 percentage.
function ProgressRing({
  pct, size = 132, stroke = 10, children,
}: {
  pct: number; size?: number; stroke?: number; children: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const safePct = clamp(pct, 0, 100);
  const dash = (safePct / 100) * circ;
  const color = safePct >= 100
    ? '#22c55e'
    : safePct >= 50
      ? 'var(--brand-primary)'
      : safePct >= 25
        ? '#eab308'
        : 'var(--t3)';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: 8,
      }}>
        {children}
      </div>
    </div>
  );
}

// One line of the weekly cost breakdown card. Renders nothing for
// zero-value buckets so the card stays compact on quiet weeks.
function CostRow({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', fontSize: 12, color: 'var(--t2)',
    }}>
      <span>{label}</span>
      <span className="num" style={{ fontWeight: 700, color: 'var(--t1)' }}>
        {money(value)}
      </span>
    </div>
  );
}

// Small sub-KPI cell rendered under the hero. Three of these sit
// side-by-side in a 1fr 1fr 1fr grid.
function SubKpi({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'cost' | 'success' }) {
  const valueColor = tone === 'cost' ? '#ef4444' : tone === 'success' ? '#22c55e' : 'var(--t1)';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 800,
        color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700,
        color: valueColor,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
    </div>
  );
}

export function Dashboard({
  jobs: rawJobs, settings, inventory, setTab, onNewJob, onQuoteToJob,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onViewJob, onGenerateInvoice, onSendInvoice, onSendReview, onMarkPaid, onEditJob,
  onLogExpense,
}: Props) {
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  // Phase 2.2 Sub-Project B: scope jobs to what the current member is
  // allowed to see. Owner / admin: pass-through. Technician: union of
  // assigned + created. Every downstream computation reads `jobs`
  // which now points at the scoped result; no other code in this
  // function needs to change.
  const jobs = useScopedJobs(rawJobs);

  // Active vertical config — drives the per-vertical Stats section
  // (rendered between Quick Actions and Pending Payments). Tire's
  // dashboardMetrics is empty by design (the hero already covers
  // those numbers), so for tire the section short-circuits to null
  // and the page renders byte-identically to today.
  const vertical = useActiveVertical();
  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    const verticalServiceIds = new Set(vertical.services.map((s) => s.id));
    return Object.keys(sp).filter((k) => {
      if (!verticalServiceIds.has(k)) return false;
      const entry = sp[k];
      return entry && entry.enabled !== false;
    });
  }, [settings.servicePricing, vertical]);

  const [qqForm, setQqForm] = useState<QuoteForm>(() => ({
    service: enabledServices[0] || 'Flat Tire Repair',
    // Batch C (2026-06-05): match the new DEFAULT_VEHICLE_PRICING seed
    // top key. Existing tenants override via settings.vehiclePricing.
    vehicleType: 'Sedan',
    miles: '', tireCost: '', materialCost: '',
    qty: 1, revenue: '',
    emergency: false, lateNight: false, highway: false, weekend: false,
  }));

  useEffect(() => {
    if (enabledServices.length && !enabledServices.includes(qqForm.service)) {
      setQqForm((p) => ({ ...p, service: enabledServices[0] }));
    }
  }, [enabledServices, qqForm.service]);

  const [qqMode, setQqMode] = useState<'suggested' | 'premium' | 'custom'>('suggested');
  // Custom price the actor types directly — used when qqMode is
  // 'custom' (e.g. a price negotiated with the customer that the
  // pricing engine's Suggested / Premium don't capture).
  const [qqCustom, setQqCustom] = useState('');
  const [qqDetailsOpen, setQqDetailsOpen] = useState(false);
  // Optional intake captured on the quote so a one-tap Quote → Job carries
  // it. Phone is the high-value one: AddJob's CustomerLookupCard recognizes
  // a returning customer from it and backfills name / address.
  const [qqPhone, setQqPhone] = useState('');
  const [qqTireSize, setQqTireSize] = useState('');
  const qqChange = <K extends keyof QuoteForm>(k: K, v: QuoteForm[K]) => setQqForm((p) => ({ ...p, [k]: v }));

  // ─── Role resolution ─────────────────────────────────────────────
  const membership = useMembership();
  const myUid = _auth?.currentUser?.uid ?? null;
  const isTechnician = membership.role === 'technician';
  // Company financials (profit, costs) are owner/admin only. Driven
  // by the canViewProfit permission — the single app-wide gate, so
  // Dashboard stays consistent with JobDetailModal / History /
  // Customers / AddJob. A loading / unresolved role yields
  // canViewProfit false → the safer non-financial view.
  const showCompanyData = membership.permissions.canViewProfit;

  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const today = TODAY();

  // ─── Per-role job visibility ────────────────────────────────────
  // safeJobs is ALREADY scoped by useScopedJobs (line above): owners/admins
  // get the full list, technicians get the assigned-OR-created union. We
  // intentionally do NOT re-filter to createdByUid here — doing so dropped
  // jobs an owner dispatched to the tech (assignedToUid set, createdByUid
  // the owner's), so dispatched work never appeared on the tech's Home even
  // though the "Assigned Jobs" card is meant to show exactly that. The home
  // counts/goal therefore reflect the work the tech actually owns: jobs they
  // logged AND jobs assigned to them.
  const visibleJobs = safeJobs;

  // ─── Week math ──────────────────────────────────────────────────
  const weekStartDay = typeof settings.workWeekStartDay === 'number'
    ? settings.workWeekStartDay
    : 1;
  const thisWeek = getWeekStart(today, weekStartDay);

  // Previous week start = subtract 7 days from this week's anchor.
  const lastWeek = useMemo(() => {
    const dt = new Date(thisWeek + 'T12:00:00');
    dt.setDate(dt.getDate() - 7);
    return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }, [thisWeek]);

  // Previous week end = one day before this week's anchor. Needed so
  // businessNetProfit can deduct expenses dated within last week's
  // 7-day span when comparing growth vs. last week.
  const lastWeekEnd = useMemo(() => {
    const dt = new Date(thisWeek + 'T12:00:00');
    dt.setDate(dt.getDate() - 1);
    return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }, [thisWeek]);

  const completedJobs = useMemo(
    () => visibleJobs.filter((j) => j.status === 'Completed'),
    [visibleJobs],
  );
  const weekJobs = useMemo(
    () => completedJobs.filter((j) => getWeekStart(j.date, weekStartDay) === thisWeek),
    [completedJobs, thisWeek, weekStartDay],
  );
  const lastWeekJobs = useMemo(
    () => completedJobs.filter((j) => getWeekStart(j.date, weekStartDay) === lastWeek),
    [completedJobs, lastWeek, weekStartDay],
  );
  const todayJobs = useMemo(() => completedJobs.filter((j) => j.date === today), [completedJobs, today]);

  // Today's totals — revenue, costs, profit. Sits under the weekly
  // hero so the operator gets an instant "what did today actually
  // produce?" snapshot. For technicians, costs/profit are hidden;
  // only the count is shown.
  // Audit P1-4 (2026-05-31): the three useMemos below previously
  // depended on the entire `settings` object. Any unrelated settings
  // listener update (expenses, brand, servicePricing, etc.) would
  // invalidate the totals — even though `weekSummary` only reads
  // settings.freeMilesIncluded and settings.costPerMile. Narrowing
  // the deps to those two fields stops the cascade. weekSummary's
  // implementation is verified in src/lib/utils.ts:192-217.
  const todayTotals = useMemo(
    () => weekSummary(todayJobs, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayJobs, settings.freeMilesIncluded, settings.costPerMile],
  );
  const todayCosts = r2(Math.max(0, (todayTotals.revenue || 0) - (todayTotals.grossProfit || 0)));

  const totals = useMemo(
    () => weekSummary(weekJobs, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekJobs, settings.freeMilesIncluded, settings.costPerMile],
  );
  const lastWeekTotals = useMemo(
    () => weekSummary(lastWeekJobs, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastWeekJobs, settings.freeMilesIncluded, settings.costPerMile],
  );
  const avgProfit = weekJobs.length ? r2(totals.grossProfit / weekJobs.length) : 0;
  // avgRevenue is the tech-safe version of avgProfit — surfaces an
  // average that doesn't expose company-level profit math. Used in
  // the third SubKpi cell when showCompanyData is false.
  const avgRevenue = weekJobs.length ? r2(totals.revenue / weekJobs.length) : 0;

  // Costs = revenue - profit. Visible to owner/admin only.
  const weekCosts = r2(Math.max(0, (totals.revenue || 0) - (totals.grossProfit || 0)));

  // Business net profit — jobs gross profit MINUS expenses dated in
  // the week (one-time, job-linked, prorated recurring). This is the
  // number that DROPS when an operator logs a $50 expense; the hero
  // ring + growth pill drive off this value so adding an expense
  // immediately reflects in the headline "This Week's Profit". The
  // gross-profit-only path (totals.grossProfit) is still used for
  // costs math and for the legacy expense breakdown card below.
  const weekNetProfit = useMemo(
    () => businessNetProfit({
      jobsProfitSum: totals.grossProfit,
      expenses: settings.expenses || [],
      startISO: thisWeek,
      endISO: today,
    }),
    [totals.grossProfit, settings.expenses, thisWeek, today],
  );
  // Same computation for the previous full week so the growth pill
  // compares like-with-like (last week net vs this week net).
  const lastWeekNetProfit = useMemo(
    () => businessNetProfit({
      jobsProfitSum: lastWeekTotals.grossProfit,
      expenses: settings.expenses || [],
      startISO: lastWeek,
      endISO: lastWeekEnd,
    }),
    [lastWeekTotals.grossProfit, settings.expenses, lastWeek, lastWeekEnd],
  );

  // ─── Growth % vs previous week ──────────────────────────────────
  // Owner/admin: NET-profit-based growth (jobs gross MINUS week's
  // expenses). Technician: jobs-count growth. Apples-to-apples both
  // sides — last week's net vs this week's net so the comparison
  // doesn't lie just because the operator logged a big one-time
  // expense this week.
  const growth = useMemo(() => {
    if (showCompanyData) {
      const prev = lastWeekNetProfit || 0;
      const curr = weekNetProfit || 0;
      if (prev === 0 && curr === 0) return { label: '—', positive: null as boolean | null };
      if (prev === 0) return { label: 'New', positive: true };
      const delta = ((curr - prev) / prev) * 100;
      return { label: `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`, positive: delta >= 0 };
    }
    const prev = lastWeekJobs.length;
    const curr = weekJobs.length;
    if (prev === 0 && curr === 0) return { label: '—', positive: null as boolean | null };
    if (prev === 0) return { label: 'New', positive: true };
    const delta = ((curr - prev) / prev) * 100;
    return { label: `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`, positive: delta >= 0 };
  }, [showCompanyData, weekNetProfit, lastWeekNetProfit, weekJobs.length, lastWeekJobs.length]);

  // ─── Progress ring percentage ───────────────────────────────────
  // Owner/admin: NET profit / weekly $ goal. So when an operator
  // logs an expense, the ring drops — matches the operator mental
  // model of "money left after costs." Technician: jobs / weekly
  // jobs goal (technicianWeeklyJobsGoal, default 5).
  const technicianGoal = Number(settings.technicianWeeklyJobsGoal || 5);
  const progressPct = showCompanyData
    ? clamp((weekNetProfit / (settings.weeklyGoal || 1)) * 100, 0, 100)
    : clamp((weekJobs.length / Math.max(1, technicianGoal)) * 100, 0, 100);

  const remainingToGoal = showCompanyData
    ? Math.max(0, (settings.weeklyGoal || 0) - weekNetProfit)
    : Math.max(0, technicianGoal - weekJobs.length);

  // ─── Pending / payments / sources / low stock ────────────────────
  const pendingJobs = useMemo(
    () => visibleJobs.filter((j) => j.status === 'Pending'),
    [visibleJobs],
  );
  const pendingTotal = pendingJobs.reduce((s, j) => s + Number(j.revenue || 0), 0);

  const pendingPaymentJobs = useMemo(
    () => visibleJobs.filter((j) => resolvePaymentStatus(j) === 'Pending Payment'),
    [visibleJobs],
  );
  const pendingPaymentTotal = pendingPaymentJobs.reduce((s, j) => s + Number(j.revenue || 0), 0);

  const sources = useMemo(() => {
    const m: Record<string, number> = {};
    visibleJobs.forEach((j) => { const s = j.source || 'Other'; m[s] = (m[s] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [visibleJobs]);
  const maxSrc = sources.length ? sources[0][1] : 1;

  const recentCompleted = useMemo(
    () => [...completedJobs]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''))
      .slice(0, 5),
    [completedJobs],
  );

  const lowStock = useMemo(() => {
    // Tire-size low-stock alert is a tire-vertical concept (FIFO tire
    // inventory keyed by size). Mechanic parts + detailing chemicals
    // have their own inventory shape with no size key, so this would
    // always compute an empty result there — skip the work entirely.
    if (!vertical.features.inventoryDeduction) return [];
    const inv = Array.isArray(inventory) ? inventory : [];
    const top5Tires = (() => {
      const c: Record<string, number> = {};
      visibleJobs.forEach((j) => { if (j.tireSize) c[j.tireSize] = (c[j.tireSize] || 0) + Number(j.qty || 1); });
      return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([size, sold]) => ({ size, sold }));
    })();
    const byN: Record<string, number> = {};
    inv.forEach((i) => { const n = normalizeTireSize(i.size); if (n) byN[n] = (byN[n] || 0) + Number(i.qty || 0); });
    const alerts: { size: string; onHand: number; soldCount: number }[] = [];
    top5Tires.forEach((t) => {
      const n = normalizeTireSize(t.size);
      if (!n) return;
      if ((byN[n] || 0) <= 1) alerts.push({ size: t.size, onHand: byN[n] || 0, soldCount: t.sold });
    });
    return alerts.slice(0, 3);
  }, [visibleJobs, inventory, vertical.features.inventoryDeduction]);

  // Phase 1 polish — operational Today panel needs an active-jobs
  // count alongside the existing today-revenue / pending-payment
  // figures. Computed once via useMemo so the panel doesn't churn
  // on every keystroke in Quick Quote.
  const activeJobsCount = useMemo(
    () => visibleJobs.filter((j) => j.status === 'Pending').length,
    [visibleJobs],
  );

  // ─── Today counter (Phase-3 spec) ───────────────────────────────
  // Counts ALL jobs whose date === today, regardless of status,
  // then splits into completed / pending. Cancelled jobs are tracked
  // separately and EXCLUDED from the "Jobs Today" headline so a
  // cancelled job never inflates the completed-today number.
  const todayCreated   = useMemo(() => visibleJobs.filter((j) => j.date === today), [visibleJobs, today]);
  const todayCompleted = useMemo(() => todayCreated.filter((j) => j.status === 'Completed'), [todayCreated]);
  const todayPending   = useMemo(() => todayCreated.filter((j) => j.status === 'Pending'),   [todayCreated]);
  const todayActiveCount = todayCompleted.length + todayPending.length;

  // ─── Week expense breakdown (owner-only Phase-3 cost card) ──────
  // Spec calls for clearly-labeled buckets: Job Costs / One-Time /
  // Recurring / Inventory / Total. Job Costs come from the existing
  // weekSummary.directCosts (tire/material/parts/travel). The other
  // three flow from the new expense ledger via expenseCalc.
  const weekExpenses = useMemo(
    () => expenseTotalsInRange(settings.expenses || [], thisWeek, today),
    [settings.expenses, thisWeek, today],
  );
  const weeklyRecurringExpense = useMemo(
    () => weeklyRecurringFromMonthly(monthlyRecurringTotal(settings.expenses || [])),
    [settings.expenses],
  );
  const weekTotalExpenses = r2(
    weekCosts                                  // existing job-level COGS
    + weekExpenses.byType.one_time
    + weekExpenses.byType.job_linked
    + weekExpenses.byType.inventory
    + weeklyRecurringExpense
  );
  // (weekNetProfit is now declared earlier — see the block above the
  // growth/ring calculations. It's the canonical net-profit figure
  // that flows into both the hero number AND the breakdown card.)

  // The Quick Quote "Tire $" field is a PER-UNIT cost paired with a Qty
  // field; calcQuote now expects a TOTAL tireCost (the same convention as a
  // saved job), so multiply here. Result is identical to before — only the
  // multiplication moved from inside the engine to the call site, so the
  // estimator stays in sync with AddJob and the saved breakdown.
  const quote = useMemo(() => calcQuote(
    { ...qqForm, tireCost: Number(qqForm.tireCost || 0) * Number(qqForm.qty || 1) },
    settings,
  ), [qqForm, settings]);

  // Count-up animation target: NET profit for owner (jobs gross minus
  // the week's expenses — so adding a $50 expense visibly drops the
  // hero number), jobs count for tech.
  const heroAnimTarget = showCompanyData ? weekNetProfit : weekJobs.length;
  const heroValue = useCountUp(heroAnimTarget);

  // The price the actor has selected — one of the engine's two
  // figures, or a hand-typed amount. Drives the CTA label and the
  // revenue the started job is prefilled with.
  const qqRevenue =
    qqMode === 'custom'
      ? Number(qqCustom) || 0
      : qqMode === 'premium'
        ? quote.premium
        : quote.suggested;

  // Build a prefilled Job draft from the quote and hand it to App. The
  // Quick Quote's "Tire $" is PER-UNIT (paired with Qty), but a saved Job
  // stores the TOTAL tire cost — so multiply, and mark the source "Bought
  // for this job" so AddJob's mirror keeps the carried total (the default
  // Inventory source would otherwise recompute it from stock on save).
  // Only do that when a cost was actually entered; otherwise leave the
  // default Inventory source so the operator picks from stock.
  const handleQuoteToJob = () => {
    const perUnit = Number(qqForm.tireCost || 0);
    const qty = Number(qqForm.qty || 1) || 1;
    const carryTireCost = perUnit > 0 && vertical.features.inventoryDeduction;
    const draft: Partial<Job> = {
      service: qqForm.service,
      vehicleType: qqForm.vehicleType,
      miles: qqForm.miles,
      qty: qqForm.qty,
      materialCost: qqForm.materialCost,
      emergency: !!qqForm.emergency,
      lateNight: !!qqForm.lateNight,
      highway: !!qqForm.highway,
      weekend: !!qqForm.weekend,
      revenue: qqRevenue,
      customerPhone: qqPhone.trim(),
      tireSize: qqTireSize.trim(),
    };
    if (carryTireCost) {
      draft.tireSource = 'Bought for this job';
      draft.tirePurchasePrice = perUnit;
      draft.tireCost = Math.round(perUnit * qty * 100) / 100;
    }
    onQuoteToJob(draft);
  };

  // Development-only role-resolution log (spec: defensive check).
  useEffect(() => {
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[dashboard] role resolution:', {
        role: membership.role,
        showCompanyData,
        isTechnician,
        myUid,
      });
    }
  }, [membership.role, showCompanyData, isTechnician, myUid]);

  return (
    <div className="page page-enter dashboard-page">
      {/* ─── 1. Pending alert strip ───────────────────────────────── */}
      {pendingJobs.length > 0 && (
        <div className="pending-banner card-anim" onClick={() => setTab('history')}>
          <div>
            <div className="pending-banner-title">
              {pendingJobs.length} {isTechnician ? 'Assigned' : 'Pending'} Job{pendingJobs.length > 1 ? 's' : ''}
            </div>
            <div className="pending-banner-sub">
              {showCompanyData
                ? `${money(pendingTotal)} awaiting completion`
                : `${pendingJobs.length} to complete`}
            </div>
          </div>
          <span style={{ fontSize: 18 }}>→</span>
        </div>
      )}

      {/* ─── 2. Hero KPI card — circular ring + role-aware content ──
            Ring shrunk from 132 → 104 (stroke 10 → 8) on 2026-05-26 as
            part of the operational-density pass. Goal: surface more
            operational data above the fold on iPhone SE / 13 mini
            without compromising the ring's visual identity. The card
            padding also dropped from 20/18 → 14/14 for the same reason. */}
      <div className="card-anim" style={{
        background: 'linear-gradient(155deg, var(--s2) 0%, var(--s1) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '14px 14px',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ProgressRing pct={progressPct} size={104} stroke={8}>
            <div style={{
              fontSize: 9, fontWeight: 800,
              color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1,
              marginBottom: 2,
            }}>
              {showCompanyData ? "This Week" : "Your Week"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', lineHeight: 1 }}>
              {Math.round(progressPct)}%
            </div>
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>
              {showCompanyData ? 'of goal' : `${weekJobs.length}/${technicianGoal} jobs`}
            </div>
          </ProgressRing>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 800,
              color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.5,
              marginBottom: 6,
            }}>
              {showCompanyData ? "This Week's Profit" : "Your Earnings"}
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--t1)', lineHeight: 1.05, marginBottom: 4 }}>
              {showCompanyData
                ? <><span style={{ fontSize: 18, color: 'var(--t3)', marginRight: 2 }}>$</span>{Math.floor(heroValue).toLocaleString()}</>
                : <>{Math.floor(heroValue)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t3)' }}>job{Math.floor(heroValue) !== 1 ? 's' : ''}</span></>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 12, fontWeight: 700,
                background: growth.positive === null
                  ? 'var(--s3)'
                  : growth.positive
                    ? 'rgba(34,197,94,.15)'
                    : 'rgba(239,68,68,.15)',
                color: growth.positive === null
                  ? 'var(--t3)'
                  : growth.positive ? '#22c55e' : '#ef4444',
              }}>
                {growth.positive === null ? '' : growth.positive ? '↑' : '↓'} {growth.label}
              </span>
              <span style={{ color: 'var(--t3)' }}>vs last week</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
              {showCompanyData
                ? (remainingToGoal > 0
                    ? `${money(remainingToGoal)} to ${money(settings.weeklyGoal || 0)} goal`
                    : '🎯 Goal hit')
                : (remainingToGoal > 0
                    ? `${remainingToGoal} more to hit weekly goal`
                    : '🎯 Weekly goal hit')}
            </div>
          </div>
        </div>

        {/* Sub-metrics — three small cells beneath the ring/copy. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8, marginTop: 16,
          paddingTop: 14, borderTop: '1px solid var(--border)',
        }}>
          {showCompanyData ? (
            <>
              <SubKpi label="Revenue" value={money(totals.revenue)} tone="neutral" />
              <SubKpi label="Costs" value={money(weekCosts)} tone="cost" />
              <SubKpi label="Avg / Job" value={money(avgProfit)} tone="neutral" />
            </>
          ) : (
            <>
              <SubKpi label="Today" value={`${todayJobs.length}`} tone="neutral" />
              <SubKpi label="Pending" value={`${pendingJobs.length}`} tone="neutral" />
              <SubKpi label="Avg / Job" value={money(avgRevenue)} tone="neutral" />
            </>
          )}
        </div>
      </div>

      {/* ── Today operational panel ─────────────────────────────
          4 ultra-compact stats. Each is a button that routes to
          the relevant operational screen. Replaces the old Today
          block (same data, denser layout + low-stock and active
          jobs added). */}
      <div className="op-panel">
        <button
          type="button"
          className="op-stat"
          onClick={() => setTab('history')}
          aria-label="Active jobs"
        >
          <span className="op-stat-label">Active jobs</span>
          <span className={'op-stat-value' + (activeJobsCount > 0 ? ' amber' : '')}>
            {activeJobsCount}
          </span>
        </button>
        {showCompanyData ? (
          <button
            type="button"
            className="op-stat"
            onClick={() => setTab('history')}
            aria-label="Pending payments"
          >
            <span className="op-stat-label">Pending pay</span>
            <span className={'op-stat-value' + (pendingPaymentJobs.length > 0 ? ' red' : '')}>
              {pendingPaymentJobs.length}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="op-stat"
            onClick={() => setTab('history')}
            aria-label="Today's jobs"
          >
            <span className="op-stat-label">Today</span>
            <span className="op-stat-value green">
              {todayJobs.length}
            </span>
          </button>
        )}
        <button
          type="button"
          className="op-stat"
          onClick={() => setTab('history')}
          aria-label="Today's revenue"
          disabled={!showCompanyData}
        >
          <span className="op-stat-label">{showCompanyData ? "Today's revenue" : 'Today'}</span>
          <span className="op-stat-value green">
            {showCompanyData
              ? money(todayJobs.reduce((s, j) => s + Number(j.revenue || 0), 0))
              : `${todayJobs.length} job${todayJobs.length === 1 ? '' : 's'}`}
          </span>
        </button>
        <button
          type="button"
          className="op-stat"
          onClick={() => setTab('inventory')}
          aria-label="Low stock"
        >
          <span className="op-stat-label">Low stock</span>
          <span className={'op-stat-value' + (lowStock.length > 0 ? ' amber' : '')}>
            {lowStock.length}
          </span>
        </button>
      </div>

      {/* ── Today counter (Phase-3 spec) ──────────────────────────
          Tells the operator at-a-glance how many jobs were created
          today, how many completed, how many still pending. Cancelled
          jobs are deliberately excluded from the headline so they
          can't inflate "today's work" numbers. Tappable rows route
          to Jobs filtered to today's date — though History doesn't
          currently support deep-linking a date filter, so for now
          they go to the Jobs tab and the operator can scan. */}
      <div className="section-label">Today</div>
      <button
        type="button"
        onClick={() => setTab('history')}
        className="card card-anim press-scale"
        style={{
          width: '100%', textAlign: 'left', background: 'var(--s2)',
          border: '1px solid var(--border)', borderRadius: 12,
          padding: '12px 14px', marginBottom: 14, cursor: 'pointer',
        }}
        aria-label="Jobs today"
      >
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8, alignItems: 'center',
        }}>
          <div>
            <div className="op-stat-label">Jobs today</div>
            <div className="op-stat-value">{todayActiveCount}</div>
          </div>
          <div>
            <div className="op-stat-label">Completed</div>
            <div className="op-stat-value green">{todayCompleted.length}</div>
          </div>
          <div>
            <div className="op-stat-label">Pending</div>
            <div className={'op-stat-value' + (todayPending.length > 0 ? ' amber' : '')}>
              {todayPending.length}
            </div>
          </div>
        </div>
        {showCompanyData && todayCompleted.length > 0 && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: '1px solid var(--border2)',
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, color: 'var(--t3)',
          }}>
            <span>Today's revenue · <span style={{ color: 'var(--t2)', fontWeight: 700 }}>{money(todayTotals.revenue)}</span></span>
            <span>Profit · <span style={{ color: 'var(--t2)', fontWeight: 700 }}>{money(todayTotals.grossProfit)}</span></span>
          </div>
        )}
      </button>

      {/* ── Week cost breakdown (Phase-3 spec) — owner-only ───────
          Splits the previously-vague "Costs" SubKpi into the five
          buckets the spec calls out. Tappable → Expenses page. */}
      {showCompanyData && (weekTotalExpenses > 0 || (settings.expenses || []).length > 0) && (
        <>
          <div className="section-label">This Week's Costs</div>
          <button
            type="button"
            onClick={() => setTab('expenses')}
            className="card card-anim press-scale"
            style={{
              width: '100%', textAlign: 'left', background: 'var(--s2)',
              border: '1px solid var(--border)', borderRadius: 12,
              padding: '12px 14px', marginBottom: 14, cursor: 'pointer',
            }}
            aria-label="View expenses"
          >
            <CostRow label="Job costs (parts / tire / material / travel)" value={weekCosts} />
            <CostRow label="One-time expenses" value={weekExpenses.byType.one_time} />
            <CostRow label="Job-linked expenses" value={weekExpenses.byType.job_linked} />
            <CostRow label="Inventory purchases" value={weekExpenses.byType.inventory} />
            <CostRow label="Recurring (weekly prorated)" value={weeklyRecurringExpense} />
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border2)',
              fontSize: 13, fontWeight: 800,
            }}>
              <span>Total expenses</span>
              <span style={{ color: '#ef4444' }}>{money(weekTotalExpenses)}</span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginTop: 6, fontSize: 13, fontWeight: 800,
            }}>
              <span>Business net profit (this week)</span>
              <span style={{ color: weekNetProfit >= 0 ? '#22c55e' : '#ef4444' }}>
                {money(weekNetProfit)}
              </span>
            </div>
            <div style={{
              fontSize: 10, color: 'var(--t3)', marginTop: 8, lineHeight: 1.5,
            }}>
              Job profit (this week) is {money(totals.grossProfit)} — Net is after
              one-time + recurring expenses. Inventory purchases aren't
              double-counted since their per-unit cost already flows
              into job profit.
            </div>
          </button>
        </>
      )}

      {/* ─── 4. Pending Payments — owner/admin only ──────────────── */}
      {showCompanyData && pendingPaymentJobs.length > 0 && (
        <>
          <div className="section-label">Pending Payments</div>
          <div className="card card-anim">
            <div className="card-pad" style={{ paddingBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>Total Due</span>
                <span className="num" style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>{money(pendingPaymentTotal)}</span>
              </div>
              {pendingPaymentJobs.slice(0, 5).map((j) => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border2)', gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {j.customerName || j.service}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{j.service} · {fmtDate(j.date)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span className="num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>{money(j.revenue)}</span>
                    <button className="btn xs success" onClick={() => onMarkPaid(j)}>Paid</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── 3. Quick actions row ────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, marginBottom: 14,
      }}>
        <button
          className="press-scale"
          onClick={onNewJob}
          style={{
            padding: '14px 12px',
            background: 'var(--brand-primary)',
            color: '#000',
            border: 'none', borderRadius: 12,
            fontSize: 14, fontWeight: 800,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          ＋ Log Job
        </button>
        <button
          className="press-scale"
          onClick={() => showCompanyData && onLogExpense ? setQuickExpenseOpen(true) : setTab('history')}
          style={{
            padding: '14px 12px',
            background: 'var(--s2)',
            color: 'var(--t1)',
            border: '1px solid var(--border)', borderRadius: 12,
            fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {showCompanyData && onLogExpense
            ? '＋ Expense'
            : `📋 ${isTechnician ? 'Assigned' : 'All Jobs'}`}
        </button>
      </div>

      {/* ─── 3b. Vertical Stats — rendered when the active business
              type declares dashboardMetrics. Tire's array is empty,
              so this section short-circuits to null for tire and the
              page renders byte-identically to today. Mechanic shows
              Labor revenue / Parts revenue / Avg RO / Diagnostics /
              Labor hours / Parts margin. Detailing shows nothing
              until Phase 2.3. ─────────────────────────────────── */}
      {vertical.dashboardMetrics.length > 0 && (
        <>
          <div className="section-label">{vertical.shortName} Stats</div>
          <div
            className="card card-anim"
            style={{
              display: 'grid',
              // Two cards per row on phones; auto-fits more on wider
              // viewports. Matches the existing SubKpi grid density.
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              padding: '14px 16px',
              marginBottom: 14,
            }}
          >
            {vertical.dashboardMetrics.map((m) => {
              const value = m.compute(visibleJobs, settings);
              const display =
                m.format === 'currency'
                  ? money(value)
                  : m.format === 'percent'
                    ? `${Math.round(value * 100)}%`
                    : `${Math.round(value * 100) / 100}`;
              return (
                <SubKpi
                  key={m.id}
                  label={m.label}
                  value={display}
                  tone="neutral"
                />
              );
            })}
          </div>
        </>
      )}

      {/* ─── 5. Low Stock — owner/admin only ─────────────────────── */}
      {showCompanyData && lowStock.length > 0 && (
        <div
          className="card card-anim"
          style={{
            borderColor: 'rgba(245,158,11,.25)',
            // Subtle amber wash — flags this as an attention card
            // without the loudness of a solid fill.
            background: 'linear-gradient(165deg, rgba(245,158,11,.07) 0%, var(--s1) 60%)',
          }}
        >
          <div className="card-pad">
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              ⚠ Low Stock Alert
            </div>
            {lowStock.map((ls) => (
              <div key={ls.size} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: 'var(--t2)' }}>
                <span style={{ fontWeight: 700 }}>{ls.size}</span>
                <span>{ls.onHand} left (sold {ls.soldCount})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 6. Quick Quote ─────────────────────────────────────── */}
      <div className="section-label with-action">
        <span>Quick Quote</span>
        <span className="section-label-hint">One tap turns this quote into a job — nothing re-entered</span>
      </div>
      <div className="quote-box card-anim">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Service</label>
            <select value={qqForm.service} onChange={(e) => qqChange('service', e.target.value)}>
              {enabledServices.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Vehicle</label>
            <select value={qqForm.vehicleType} onChange={(e) => qqChange('vehicleType', e.target.value)}>
              {Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        {/* "Tire $" only renders for tire — mechanic/detailing pricing
            engines never read qqForm.tireCost. Grid column count
            adapts so the row doesn't leave a gap. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: vertical.features.inventoryDeduction ? '1fr 1fr 1fr' : '1fr 1fr',
          gap: 10, marginBottom: 12,
        }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Miles</label>
            <input type="number" inputMode="decimal" value={qqForm.miles} onChange={(e) => qqChange('miles', e.target.value)} placeholder="0" />
          </div>
          {vertical.features.inventoryDeduction && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Tire $</label>
              <input type="number" inputMode="decimal" value={qqForm.tireCost} onChange={(e) => qqChange('tireCost', e.target.value)} placeholder="0" />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Qty</label>
            <input type="number" inputMode="numeric" value={qqForm.qty} onChange={(e) => qqChange('qty', e.target.value)} placeholder="1" />
          </div>
        </div>
        {/* Conditions chips are vertical-aware — detailing omits
            Highway (matches AddJob, commit cd87447). Fallback to all
            4 if a config doesn't declare conditions. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {(vertical.conditions ?? [
            { key: 'emergency' as const, label: '🚨 Emergency' },
            { key: 'lateNight' as const, label: '🌙 Late' },
            { key: 'highway' as const,   label: '🛣 Hwy' },
            { key: 'weekend' as const,   label: '📅 Wknd' },
          ]).map(({ key: k, label: l }) => (
            <button key={k} className={'chip sm' + (qqForm[k] ? ' active' : '')} onClick={() => qqChange(k, !qqForm[k])}>{l}</button>
          ))}
        </div>
        <div className="qq-pricing-row">
          <div className={'qq-price-tile' + (qqMode === 'suggested' ? ' active' : '')}
            onClick={() => setQqMode('suggested')} role="button">
            <div className="qq-price-tile-label">Suggested</div>
            <div className="qq-price-tile-amount">{money(quote.suggested)}</div>
          </div>
          <div className={'qq-price-tile premium' + (qqMode === 'premium' ? ' active' : '')}
            onClick={() => setQqMode('premium')} role="button">
            <div className="qq-price-tile-label">Premium</div>
            <div className="qq-price-tile-amount">{money(quote.premium)}</div>
          </div>
          {/* Custom — the actor types their own price (e.g. one
              negotiated on the spot). Selecting the tile, focusing
              the input, or typing all switch qqMode to 'custom'. */}
          <div className={'qq-price-tile custom' + (qqMode === 'custom' ? ' active' : '')}
            onClick={() => setQqMode('custom')} role="button">
            <div className="qq-price-tile-label">Custom</div>
            <div className="qq-price-tile-amount">
              <div className="qq-custom-input-wrap">
                <span className="qq-custom-prefix">$</span>
                <input
                  className="qq-custom-input"
                  type="number"
                  inputMode="decimal"
                  value={qqCustom}
                  placeholder="0"
                  aria-label="Custom quote price"
                  onFocus={() => setQqMode('custom')}
                  onChange={(e) => { setQqCustom(e.target.value); setQqMode('custom'); }}
                />
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="qq-details-toggle"
          onClick={() => setQqDetailsOpen((v) => !v)}
          aria-expanded={qqDetailsOpen}
        >
          {qqDetailsOpen ? 'Hide details ▴' : 'Details ▾'}
        </button>
        {qqDetailsOpen && (
          <div className="qq-meta">Direct cost {money(quote.directCosts)} · target profit {money(quote.targetProfit)}</div>
        )}

        {/* One-tap Quote → Job. Optional phone + tire size are captured
            here so they carry too — phone unlocks returning-customer
            auto-fill in Add Job. Everything else (service / vehicle /
            miles / qty / surcharges / tire cost / chosen price) carries
            automatically, so the operator re-enters nothing. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: vertical.features.inventoryDeduction ? '1fr 1fr' : '1fr',
            gap: 10, marginTop: 12,
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Phone (optional)</label>
            <input
              type="tel"
              inputMode="tel"
              value={qqPhone}
              onChange={(e) => setQqPhone(formatPhonePartial(e.target.value))}
              placeholder="(555) 123-4567"
            />
          </div>
          {vertical.features.inventoryDeduction && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Tire size (optional)</label>
              <input
                type="text"
                value={qqTireSize}
                onChange={(e) => setQqTireSize(e.target.value)}
                placeholder="e.g. 225/45R17"
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="cta-btn press-scale"
          style={{ marginTop: 12, width: '100%' }}
          onClick={handleQuoteToJob}
        >
          Create Job · {money(qqRevenue)} →
        </button>
      </div>

      {/* ─── 7. Lead Sources — owner/admin only ──────────────────── */}
      {showCompanyData && sources.length > 0 && (
        <>
          <div className="section-label">Lead Sources</div>
          <div className="card card-anim">
            <div className="card-pad">
              {sources.slice(0, 5).map(([name, count]) => (
                <div key={name} className="source-bar">
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', width: 80, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                  <div className="source-bar-track"><div className="source-bar-fill" style={{ width: (count / maxSrc) * 100 + '%' }} /></div>
                  <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', width: 30, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── 8. Recent Completed Jobs ────────────────────────────── */}
      {recentCompleted.length > 0 && (
        <>
          <div className="section-label">
            {isTechnician ? 'Your Recent Jobs' : 'Recent Completed Jobs'}
          </div>
          <div className="stack">
            {recentCompleted.map((j) => (
              <RecentJobCard
                key={j.id}
                job={j}
                settings={settings}
                showCompanyData={showCompanyData}
                onView={() => onViewJob(j)}
                onMarkPaid={() => onMarkPaid(j)}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 28, marginBottom: 4 }}>
        <button className="cta-btn press-scale" onClick={onNewJob}>
          ＋ Log New Job
        </button>
      </div>

      {/* Quick-log expense sheet (Phase 4). Mounted at the page root
          so the overlay covers everything. onLogExpense is the
          owner-only persist callback threaded from App.tsx — gated
          to canViewProfit roles in the Quick Actions button. */}
      {quickExpenseOpen && onLogExpense && (
        <QuickExpenseSheet
          onSave={(e) => { onLogExpense(e); setQuickExpenseOpen(false); }}
          onClose={() => setQuickExpenseOpen(false)}
          onOpenFullExpenses={() => setTab('expenses')}
        />
      )}
    </div>
  );
}

// ─── RecentJobCard ─────────────────────────────────────────────────
// Compact recent-job card used on the Dashboard's Recent Completed
// Jobs strip. Mirrors the visual shape of the prior inline render
// (compressed on 2026-05-27 to a single-row layout) and adds
// swipe-to-mark-paid via useSwipeAction so the gesture matches
// History's HistoryJobCard. Tap = view modal (full action set).
// Swipe right past 100px = mark paid.
function RecentJobCard({
  job, settings, showCompanyData, onView, onMarkPaid,
}: {
  job: Job;
  settings: Settings;
  showCompanyData: boolean;
  onView: () => void;
  onMarkPaid: () => void;
}) {
  const pr = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  const canSwipe = ps !== 'Paid' && ps !== 'Cancelled';
  const swipe = useSwipeAction({ enabled: canSwipe, onCommit: onMarkPaid });

  return (
    <div className="job-card card-anim" style={{ position: 'relative', overflow: 'hidden' }}>
      {canSwipe && swipe.reveal && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, var(--green) 0%, #16a34a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
            paddingLeft: 18, color: '#fff', fontWeight: 800,
            fontSize: 14, letterSpacing: 0.2,
            pointerEvents: 'none',
          }}
        >
          {swipe.committed ? '✓ Release to mark paid' : '→ Swipe to mark paid'}
        </div>
      )}
      <div
        {...swipe.bind}
        style={{
          transform: `translateX(${swipe.swipeX}px)`,
          transition: swipe.swipeX === 0 ? 'transform .18s ease' : 'none',
          position: 'relative',
          zIndex: 1,
          background: 'var(--s1)',
        }}
      >
        <div className="job-card-main" onClick={onView}>
          <div className="job-icon"><ServiceIcon name={job.service} /></div>
          <div className="job-main">
            <div className="job-title">{job.customerName || job.service}</div>
            <div className="job-meta">
              {job.fullLocationLabel || job.area || job.service}
              {job.tireSize ? ' · ' + job.tireSize : ''}
              {' · ' + fmtDateShort(job.date)}
            </div>
          </div>
          <div className="job-right">
            {/* Revenue is owner/admin-only — techs see profit + pill only. */}
            {showCompanyData && (
              <div className="value green">{money(job.revenue)}</div>
            )}
            <div style={{ fontSize: 11, color: pr >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              {money(pr)} profit
            </div>
            <span className={'pill ' + paymentPillClass(ps)} style={{ marginTop: 4 }}>{ps}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
