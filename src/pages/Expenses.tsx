import { useMemo, useState } from 'react';
import type {
  Expense, ExpenseCategory, ExpenseType, ExpensePaymentMethod, Job, Settings,
} from '@/types';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_TYPE_LABELS,
} from '@/types';
import {
  money, uid, getWeekStart, fmtDateShort,
} from '@/lib/utils';
import { TODAY } from '@/lib/defaults';
import {
  monthlyRecurringTotal,
  weeklyRecurringFromMonthly,
  expenseTotalsInRange,
} from '@/lib/expenseCalc';

// ─────────────────────────────────────────────────────────────────────
//  Expenses — Phase-2 rebuild.
//
//  Drives the new expense ledger: categories + types + dates + vendors.
//  Replaces the previous "Recurring / History" two-tab layout with:
//
//    • Hero KPI strip (Today / This Week / This Month)
//    • Type-filter chips (All / Recurring / One-time / Job-linked /
//      Inventory). Recurring filter shows the live monthly accrual;
//      every other type bucket shows the date-windowed total.
//    • Category-filter chips (All + 11 categories).
//    • Date-range buttons (Today / Week / Month / All).
//    • Sorted list of matching expenses (recurring pinned to top with
//      no date; everything else sorted date-desc).
//    • Add / edit sheet supports every Phase-1 field.
//    • Category breakdown panel.
//
//  All math comes from the pure expenseCalc helpers (tested at 43/43)
//  so this file is presentation-only.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  expenses: Expense[];
  jobs: Job[];
  settings: Settings;
  onSave: (next: Expense[]) => void;
}

type TypeFilter = 'all' | ExpenseType;
type CategoryFilter = 'all' | ExpenseCategory;
type RangeFilter = 'today' | 'week' | 'month' | 'all';

export function Expenses({ expenses, jobs, settings, onSave }: Props) {
  const safe = useMemo(() => (Array.isArray(expenses) ? expenses : []), [expenses]);

  // ─── Filter state ──────────────────────────────────────────────
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [catFilter, setCatFilter] = useState<CategoryFilter>('all');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('month');

  // ─── Add / edit sheet ──────────────────────────────────────────
  const [editing, setEditing] = useState<Expense | null>(null);
  const [adding, setAdding] = useState(false);

  // ─── Date math for the active range ────────────────────────────
  const weekStartDay = typeof settings.workWeekStartDay === 'number' ? settings.workWeekStartDay : 1;
  const today = TODAY();
  const thisWeekStart = getWeekStart(today, weekStartDay);
  const monthStart = today.slice(0, 7) + '-01';
  const monthEnd = today.slice(0, 7) + '-31';

  const activeRange = useMemo<{ start: string; end: string; label: string }>(() => {
    switch (rangeFilter) {
      case 'today': return { start: today,       end: today,       label: 'Today' };
      case 'week':  return { start: thisWeekStart, end: today,     label: 'This week' };
      case 'month': return { start: monthStart,  end: monthEnd,    label: 'This month' };
      case 'all':   return { start: '0000-00-00', end: '9999-99-99', label: 'All time' };
    }
  }, [rangeFilter, today, thisWeekStart, monthStart, monthEnd]);

  // ─── Hero KPI math ─────────────────────────────────────────────
  // Today / week / month buckets always shown regardless of filters,
  // so the operator always has the orientation numbers at the top.
  const todayTotals = useMemo(
    () => expenseTotalsInRange(safe, today, today),
    [safe, today],
  );
  const weekTotals = useMemo(
    () => expenseTotalsInRange(safe, thisWeekStart, today),
    [safe, thisWeekStart, today],
  );
  const monthTotals = useMemo(
    () => expenseTotalsInRange(safe, monthStart, monthEnd),
    [safe, monthStart, monthEnd],
  );
  const monthlyRecurring = useMemo(() => monthlyRecurringTotal(safe), [safe]);
  const weeklyRecurring = weeklyRecurringFromMonthly(monthlyRecurring);

  // ─── Active filter math ────────────────────────────────────────
  const rangeTotals = useMemo(
    () => expenseTotalsInRange(safe, activeRange.start, activeRange.end),
    [safe, activeRange.start, activeRange.end],
  );

  // ─── List rendering ────────────────────────────────────────────
  // Recurring pinned at top (no date), then date-desc. Pre-filtered
  // by typeFilter / catFilter / rangeFilter (the last only applies to
  // non-recurring rows since recurring rows have no date).
  const rows = useMemo(() => {
    return safe
      .filter((e) => {
        if (typeFilter !== 'all' && (e.type || 'recurring') !== typeFilter) return false;
        if (catFilter !== 'all' && (e.category || 'other') !== catFilter) return false;
        const type = e.type || 'recurring';
        if (type === 'recurring') return true; // recurring ignores date range
        if (!e.date) return false;
        return e.date >= activeRange.start && e.date <= activeRange.end;
      })
      .sort((a, b) => {
        const aRec = (a.type || 'recurring') === 'recurring' ? 1 : 0;
        const bRec = (b.type || 'recurring') === 'recurring' ? 1 : 0;
        if (aRec !== bRec) return bRec - aRec;       // recurring on top
        return (b.date || '').localeCompare(a.date || ''); // date desc
      });
  }, [safe, typeFilter, catFilter, activeRange.start, activeRange.end]);

  // ─── Persistence ───────────────────────────────────────────────
  const upsert = (next: Expense) => {
    const exists = safe.some((e) => e.id === next.id);
    const updated = exists ? safe.map((e) => e.id === next.id ? next : e) : [next, ...safe];
    onSave(updated);
    setEditing(null);
    setAdding(false);
  };
  const remove = (id: string) => {
    onSave(safe.filter((e) => e.id !== id));
    setEditing(null);
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="page page-enter">
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 14,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Expenses</div>
        <button className="btn xs primary" onClick={() => setAdding(true)}>
          ＋ Add expense
        </button>
      </div>

      {/* Hero KPI strip — Today / Week / Month + recurring accrual */}
      <div className="kpi-grid three" style={{ marginBottom: 10 }}>
        <div className="kpi">
          <div className="kpi-label">Today</div>
          <div className="kpi-value">{money(todayTotals.total)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">This week</div>
          <div className="kpi-value">{money(weekTotals.total + weeklyRecurring)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">This month</div>
          <div className="kpi-value">{money(monthTotals.total + monthlyRecurring)}</div>
        </div>
      </div>
      <div style={{
        fontSize: 10, color: 'var(--t3)', marginBottom: 16, lineHeight: 1.5,
      }}>
        Week / month totals include {money(monthlyRecurring)}/mo recurring fixed costs
        ({money(weeklyRecurring)} weekly).
      </div>

      {/* Type filter chips */}
      <div className="section-label">Type</div>
      <div className="chip-grid" style={{ marginBottom: 12 }}>
        <FilterChip active={typeFilter === 'all'}     onClick={() => setTypeFilter('all')}>All</FilterChip>
        <FilterChip active={typeFilter === 'recurring'}  onClick={() => setTypeFilter('recurring')}>Recurring</FilterChip>
        <FilterChip active={typeFilter === 'one_time'}   onClick={() => setTypeFilter('one_time')}>One-time</FilterChip>
        <FilterChip active={typeFilter === 'job_linked'} onClick={() => setTypeFilter('job_linked')}>Job-linked</FilterChip>
        <FilterChip active={typeFilter === 'inventory'}  onClick={() => setTypeFilter('inventory')}>Inventory</FilterChip>
      </div>

      {/* Category filter chips */}
      <div className="section-label">Category</div>
      <div className="chip-grid" style={{ marginBottom: 12 }}>
        <FilterChip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>All</FilterChip>
        {EXPENSE_CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            active={catFilter === c}
            onClick={() => setCatFilter(c)}
          >
            {EXPENSE_CATEGORY_LABELS[c]}
          </FilterChip>
        ))}
      </div>

      {/* Date range filter */}
      <div className="section-label">Range</div>
      <div className="chip-grid" style={{ marginBottom: 16 }}>
        <FilterChip active={rangeFilter === 'today'} onClick={() => setRangeFilter('today')}>Today</FilterChip>
        <FilterChip active={rangeFilter === 'week'}  onClick={() => setRangeFilter('week')}>This week</FilterChip>
        <FilterChip active={rangeFilter === 'month'} onClick={() => setRangeFilter('month')}>This month</FilterChip>
        <FilterChip active={rangeFilter === 'all'}   onClick={() => setRangeFilter('all')}>All time</FilterChip>
      </div>

      {/* Range total + category breakdown */}
      {rangeFilter !== 'all' && (
        <div className="card card-anim" style={{ marginBottom: 14 }}>
          <div className="card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>
                  {activeRange.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>
                  {money(rangeTotals.total)}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                {rangeTotals.count} expense{rangeTotals.count !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Category breakdown — only non-zero buckets */}
            {Object.entries(rangeTotals.byCategory)
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border2)' }}>
                {Object.entries(rangeTotals.byCategory)
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <div key={cat} style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 12, padding: '4px 0',
                    }}>
                      <span style={{ color: 'var(--t2)' }}>
                        {EXPENSE_CATEGORY_LABELS[cat as ExpenseCategory]}
                      </span>
                      <span style={{ fontWeight: 700 }}>{money(amt)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expense list */}
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No expenses match these filters</div>
          <div className="empty-state-sub">
            Try widening the range or category, or log a new expense.
          </div>
        </div>
      ) : (
        <div className="stack">
          {rows.map((e) => (
            <ExpenseRow
              key={e.id}
              expense={e}
              jobs={jobs}
              onEdit={() => setEditing(e)}
            />
          ))}
        </div>
      )}

      {/* Add / edit sheet */}
      {(adding || editing) && (
        <ExpenseSheet
          initial={editing || newExpense()}
          jobs={jobs}
          onCancel={() => { setAdding(false); setEditing(null); }}
          onSave={upsert}
          onDelete={editing ? () => remove(editing.id) : undefined}
        />
      )}
    </div>
  );
}

// ─── Helpers / sub-components ───────────────────────────────────────

function newExpense(): Expense {
  return {
    id: uid(),
    name: '',
    amount: 0,
    active: true,
    category: 'other',
    type: 'one_time',
    date: TODAY(),
    createdAt: new Date().toISOString(),
  };
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={'chip' + (active ? ' active' : '')}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ExpenseRow({
  expense, jobs, onEdit,
}: { expense: Expense; jobs: Job[]; onEdit: () => void }) {
  const type = expense.type || 'recurring';
  const cat  = expense.category || 'other';
  const job  = expense.jobId
    ? jobs.find((j) => j.id === expense.jobId)
    : undefined;
  return (
    <div
      className="card card-anim"
      onClick={onEdit}
      style={{ cursor: 'pointer' }}
    >
      <div className="card-pad" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {expense.name || EXPENSE_CATEGORY_LABELS[cat]}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                background: 'var(--s3)', padding: '1px 6px', borderRadius: 4,
                fontWeight: 700, color: 'var(--t2)',
              }}>
                {EXPENSE_CATEGORY_LABELS[cat]}
              </span>
              <span>·</span>
              <span>{EXPENSE_TYPE_LABELS[type]}</span>
              {expense.date && type !== 'recurring' && (
                <>
                  <span>·</span>
                  <span>{fmtDateShort(expense.date)}</span>
                </>
              )}
              {expense.vendor && (
                <>
                  <span>·</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                    {expense.vendor}
                  </span>
                </>
              )}
              {job && (
                <>
                  <span>·</span>
                  <span>{job.customerName || job.service}</span>
                </>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--t1)' }}>
              {money(expense.amount)}
            </div>
            {type === 'recurring' && (
              <div style={{ fontSize: 10, color: expense.active ? 'var(--t3)' : '#ef4444', marginTop: 2 }}>
                {expense.active ? '/mo' : 'inactive'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Add / edit sheet ───────────────────────────────────────────────

function ExpenseSheet({
  initial, jobs, onSave, onCancel, onDelete,
}: {
  initial: Expense;
  jobs: Job[];
  onSave: (e: Expense) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Expense>(initial);
  const set = <K extends keyof Expense>(k: K, v: Expense[K]) => setDraft({ ...draft, [k]: v });
  const type = draft.type || 'one_time';

  const canSave = Number(draft.amount || 0) > 0;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)', zIndex: 9000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card-anim"
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--s1)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
          maxHeight: '85vh', overflowY: 'auto',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--t3)',
          borderRadius: 4, margin: '2px auto 14px', opacity: 0.5,
        }} />
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
          {onDelete ? 'Edit expense' : 'Add expense'}
        </div>

        <div className="field">
          <label>Type</label>
          <div className="chip-grid">
            <button type="button" className={'chip' + (type === 'one_time'   ? ' active' : '')} onClick={() => set('type', 'one_time')}>One-time</button>
            <button type="button" className={'chip' + (type === 'recurring'  ? ' active' : '')} onClick={() => set('type', 'recurring')}>Recurring</button>
            <button type="button" className={'chip' + (type === 'job_linked' ? ' active' : '')} onClick={() => set('type', 'job_linked')}>Job-linked</button>
            <button type="button" className={'chip' + (type === 'inventory'  ? ' active' : '')} onClick={() => set('type', 'inventory')}>Inventory</button>
          </div>
        </div>

        <div className="field">
          <label>Category</label>
          <div className="chip-grid">
            {EXPENSE_CATEGORIES.map((c) => (
              <button
                key={c} type="button"
                className={'chip' + (draft.category === c ? ' active' : '')}
                onClick={() => set('category', c)}
              >
                {EXPENSE_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>{type === 'recurring' ? 'Monthly $' : 'Amount $'}</label>
            <input
              type="number" inputMode="decimal"
              value={draft.amount || ''}
              onChange={(e) => set('amount', Number(e.target.value))}
              placeholder="0"
              autoFocus
            />
          </div>
          {type !== 'recurring' && (
            <div className="field">
              <label>Date</label>
              <input
                type="date"
                value={draft.date || TODAY()}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="field">
          <label>Name / label (optional)</label>
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={
              draft.category
                ? EXPENSE_CATEGORY_LABELS[draft.category]
                : 'e.g. Insurance'
            }
          />
        </div>

        <div className="field">
          <label>Vendor (optional)</label>
          <input
            value={draft.vendor || ''}
            onChange={(e) => set('vendor', e.target.value)}
            placeholder="Shell, Discount Tire, Geico…"
          />
        </div>

        <div className="field">
          <label>Payment method (optional)</label>
          <div className="chip-grid">
            {(['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'other'] as ExpensePaymentMethod[]).map((m) => (
              <button
                key={m} type="button"
                className={'chip' + (draft.paymentMethod === m ? ' active' : '')}
                onClick={() => set('paymentMethod', draft.paymentMethod === m ? undefined : m)}
              >
                {m === 'cashapp' ? 'Cash App' : (m.charAt(0).toUpperCase() + m.slice(1))}
              </button>
            ))}
          </div>
        </div>

        {type === 'job_linked' && (
          <div className="field">
            <label>Linked job</label>
            <select
              value={draft.jobId || ''}
              onChange={(e) => set('jobId', e.target.value || undefined)}
            >
              <option value="">Select a job…</option>
              {jobs.slice(0, 50).map((j) => (
                <option key={j.id} value={j.id}>
                  {fmtDateShort(j.date)} · {j.customerName || j.service}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
              Job-linked expenses reduce business net profit but do not
              automatically reduce that job's per-job profit.
            </div>
          </div>
        )}

        {type === 'recurring' && (
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              Active (counts toward monthly fixed costs)
            </label>
          </div>
        )}

        <div className="field">
          <label>Notes (optional)</label>
          <textarea
            value={draft.notes || ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Receipt #, mileage, anything else worth remembering"
            rows={2}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            type="button" className="btn secondary"
            onClick={onCancel}
            style={{ flex: 1 }}
          >Cancel</button>
          <button
            type="button" className="btn primary"
            onClick={() => canSave && onSave({
              ...draft,
              // Defensive normalization: name defaults from category;
              // recurring expenses strip date (no semantic meaning).
              name: (draft.name || '').trim() || EXPENSE_CATEGORY_LABELS[draft.category || 'other'],
              date: type === 'recurring' ? undefined : (draft.date || TODAY()),
            })}
            disabled={!canSave}
            style={{ flex: 2 }}
          >Save</button>
        </div>

        {onDelete && (
          <button
            type="button" className="btn ghost"
            onClick={() => {
              if (window.confirm('Delete this expense?')) onDelete();
            }}
            style={{ width: '100%', marginTop: 10, color: '#ef4444', fontSize: 12 }}
          >Delete expense</button>
        )}
      </div>
    </div>
  );
}
