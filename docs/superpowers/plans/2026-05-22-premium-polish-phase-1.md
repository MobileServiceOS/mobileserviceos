# Premium Polish Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish-only pass across Dashboard, Quick Quote, and History. Reorder Dashboard sections around operational priority, collapse the Quick Quote's "Details" line behind a toggle, tighten History card density. CSS + JSX. No new fields, routes, or persistence.

> Spec: `docs/superpowers/specs/2026-05-22-premium-polish-phase-1-design.md`

---

## File Structure

- **Modify `src/pages/Dashboard.tsx`** — promote Pending Payments above Quick Actions; refine the existing Today block into the operational panel (add low-stock + active-jobs stats); compress vertical padding.
- **Modify `src/pages/History.tsx`** — `HistoryJobCard` density refinements (padding, date format, tire pill, payment pill).
- **Modify `src/lib/utils.ts`** — add `fmtDateShort(date)` (returns e.g. "May 22" instead of "May 22, 2026").
- **Modify `src/styles/app.css`** — `.operational-panel` styles, `.qq-details-toggle`, refined `.job-card` density.

Notes for the engineer:
- `lowStock` is already computed in `Dashboard.tsx` (around line 330). Re-use.
- "Active jobs count" = `safeJobs.filter((j) => j.status === 'Pending').length`. Compute once via `useMemo`.
- The existing `fmtDate` helper in `@/lib/utils` returns the long form; add a sibling `fmtDateShort` that drops the year.

---

## Task A: Dashboard — section reorder + Today operational panel

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add CSS for the operational panel + tighten section spacing**

In `src/styles/app.css`, find the `.section-label` rule block. Immediately after the `.section-label.with-action ...` related rules, add:

```css

/* ── Operational Today panel (Dashboard) ─────────────────────── */
.op-panel {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.op-stat {
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 10px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: left;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
.op-stat:hover { background: var(--s3); border-color: var(--border2); }
.op-stat:disabled { cursor: default; opacity: .8; }
.op-stat-label {
  font-size: 9px; font-weight: 800; letter-spacing: 1px;
  text-transform: uppercase; color: var(--t3);
}
.op-stat-value {
  font-size: 18px; font-weight: 800; color: var(--t1);
  margin-top: 4px; line-height: 1;
}
.op-stat-value.amber { color: var(--amber); }
.op-stat-value.red { color: var(--red); }
.op-stat-value.green { color: var(--green); }
@media (max-width: 380px) {
  .op-panel { grid-template-columns: repeat(2, 1fr); }
}
```

- [ ] **Step 2: Compute the new operational stats inside `Dashboard.tsx`**

In `Dashboard.tsx`, find the `lowStock` computation (around line 330: `const lowStock = list.filter(...)` or wherever — locate via `grep -n lowStock`). Immediately after that line, add:

```ts
  // Phase 1 polish — operational Today panel needs an active-jobs
  // count alongside the existing today-revenue / pending-payment
  // figures. Computed once via useMemo so the panel doesn't churn
  // on every keystroke in Quick Quote.
  const activeJobsCount = useMemo(
    () => visibleJobs.filter((j) => j.status === 'Pending').length,
    [visibleJobs],
  );
```

(If `visibleJobs` isn't the correct variable in this file — use whichever already exists for the role-scoped job list. Check the existing `safeJobs` / `jobs` usage just above the `lowStock` block.)

- [ ] **Step 3: Render the operational panel + reorder Pending Payments**

Find the existing "Today block" rendering in `Dashboard.tsx` (look for the comment `{/* ─── 2b. Today block …`). Replace its contents with the new 4-stat operational panel. The panel sits where the Today block sat — between the hero and the section-label group.

The new block replaces ONLY the inner stat rendering — keep any wrapping `<div>` if it has a useful className like `card`.

Insertion: an array of 4 stats — `{label, value, valueClass, onClick}` — rendered as buttons:

```tsx
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
            <span className={'op-stat-value' + (pendingPayments.length > 0 ? ' red' : '')}>
              {pendingPayments.length}
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
          <span className={'op-stat-value' + (lowStock > 0 ? ' amber' : '')}>
            {lowStock}
          </span>
        </button>
      </div>
```

(Variable names — `pendingPayments`, `todayJobs`, `showCompanyData`, `lowStock` — already exist in this file. If any are named slightly differently, use the actual identifiers.)

- [ ] **Step 4: Move the Pending Payments section above Quick Actions**

Find the existing Pending Payments block (around the section labeled `{/* ─── 4. Pending Payments`) and the Quick Actions block (`{/* ─── 3. Quick actions row`). Swap their order: Pending Payments now renders FIRST.

The swap is JSX-level — keep both blocks' content identical, only their position changes. Numbering in the section comments may be left as-is for now (will renumber as part of a later cleanup pass).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expect clean.

```bash
git add src/pages/Dashboard.tsx src/styles/app.css
git commit -m "feat(dashboard): operational Today panel + Pending Payments promoted above Quick Actions"
```

---

## Task B: Quick Quote — Details collapse

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: CSS for the details toggle**

In `src/styles/app.css`, near the existing `.qq-meta { … }` rule, add:

```css

/* ── Quick Quote — details toggle (Phase 1 polish) ───────────── */
.qq-details-toggle {
  background: transparent;
  border: none;
  color: var(--t3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .3px;
  padding: 6px 0;
  cursor: pointer;
  text-align: center;
  width: 100%;
}
.qq-details-toggle:hover { color: var(--t2); }
```

- [ ] **Step 2: Local state for the toggle**

In `Dashboard.tsx`, near the existing `const [qqMode, setQqMode] = …` and the `qqCustom` state, add:

```ts
  const [qqDetailsOpen, setQqDetailsOpen] = useState(false);
```

- [ ] **Step 3: Wrap the existing `qq-meta` line in the toggle**

Find the existing `<div className="qq-meta">…</div>` in the Quick Quote render block. Replace its standalone render with the toggle + conditional render:

```tsx
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
```

Position: directly below the `qq-pricing-row` (where the tiles live) and ABOVE the `Start Job at …` CTA. The existing `qq-meta` between them was the only thing here; this swap preserves vertical order.

- [ ] **Step 4: Typecheck + commit**

```bash
git add src/pages/Dashboard.tsx src/styles/app.css
git commit -m "feat(dashboard): collapse Quick Quote internals behind a Details toggle"
```

---

## Task C: History — `HistoryJobCard` density polish

**Files:**
- Modify: `src/pages/History.tsx`
- Modify: `src/lib/utils.ts`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add `fmtDateShort` to `src/lib/utils.ts`**

Find the existing `fmtDate` export. Below it, add:

```ts
/**
 * Short date for dense lists: "May 22" (year dropped). Useful in
 * History rows where the calendar context is obvious from grouping.
 * Full date stays available via `fmtDate` for detail views.
 */
export function fmtDateShort(date: string): string {
  if (!date) return '';
  try {
    return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    });
  } catch {
    return date;
  }
}
```

- [ ] **Step 2: CSS density polish**

In `src/styles/app.css`, find the `.job-card` rule. Update its padding:
- If currently `padding: 14px;` (or similar 14+), change to `padding: 10px 12px;`.
- Find `.job-card-main` and tighten its `gap` if it's `>= 12px` to `10px`.

Also add (or update) `.job-icon` to:

```css
.job-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
  width: 32px; text-align: center;
}
```

(Adjust to suit the existing token names — the key is: visibly larger icon, controlled column width.)

- [ ] **Step 3: Tighten the inline-styled bits inside `HistoryJobCard`**

In `src/pages/History.tsx`, `HistoryJobCard` body:

1. Change the import line: extend the existing `from '@/lib/utils'` import to add `fmtDateShort` alongside `fmtDate`. Then replace the usage in the meta line:
   ```tsx
   {job.service} · {job.fullLocationLabel || job.area || '—'} · {fmtDateShort(job.date)}
   ```
2. Tire size pill — change `fontSize: 9` to `fontSize: 10` and `background: 'rgba(200,164,74,.1)'` to `background: 'rgba(200,164,74,.06)'` (the lighter background quiets the pill).
3. Payment pill on the right side — locate the `<span className={'pill ' + paymentPillClass(ps)} style={{ marginTop: 4 }}>{ps}</span>` and add `padding: '3px 7px'` and `fontSize: 10` to its style, plus reduce `marginTop` to 3.
4. Profit line — change its fontSize from 11 to 10 and color stays the same.

These changes are all in `src/pages/History.tsx` `HistoryJobCard` body. Surrounding code (Mark Paid footer, the long-press handlers, etc.) is unchanged.

- [ ] **Step 4: Typecheck + commit**

```bash
git add src/pages/History.tsx src/lib/utils.ts src/styles/app.css
git commit -m "feat(history): tighter card density + short date format"
```

---

## Task D: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`.

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual verification (on deploy)**

- **Dashboard**: the operational Today panel sits above Quick Actions and shows Active jobs · Pending pay (or Today for tech) · Today's revenue (or job count) · Low stock. Each chip taps to the right destination. Pending Payments renders just above Quick Actions.
- **Quick Quote**: the section is visibly less crowded. A small `Details ▾` link sits between the price tiles and the Start Job CTA. Tapping it expands the "Direct cost · target profit" line. Closes on tap again.
- **History**: cards are visibly denser; date reads as "May 22" instead of "May 22, 2026"; payment pills are smaller; service icons are larger and clearer.
- No regressions in Quick Quote behavior (Suggested / Premium / Custom still work; Start Job still routes correctly).
- No regressions in History (search, filter chips, group-by-date / group-by-stage, Mark Paid still work).

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes

- This phase ships visible polish only — no data model changes.
- Each task leaves the build green.
- Next: Phase 2 (Add Job smart-forms) follows immediately on completion.
