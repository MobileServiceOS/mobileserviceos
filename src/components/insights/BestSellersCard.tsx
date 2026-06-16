import { useMemo, useState } from 'react';
import type { Job, InventoryItem } from '@/types';
import { money } from '@/lib/utils';
import { extractTireSize } from '@/lib/inventoryNotesParser';
import { SizeLink } from '@/components/SizeLink';
import {
  computeBestSellingTires,
  type BestSellerWindow,
  type BestSellerSort,
} from '@/lib/bestSellingTires';

// ─────────────────────────────────────────────────────────────────────
//  BestSellersCard — top tire sizes by quantity sold
//
//  Lives on the Insights page below the existing analytics. Pure read
//  over completed jobs — no AI, no Firestore, no server calls. Ranks
//  by total quantity sold across a selectable window (30d / 90d / all)
//  with a tie-break by revenue.
//
//  Operator value: helps decide what to keep in stock. The same
//  insight could be computed in head when you have 15 jobs; once you
//  have 150 a ranked card removes the guessing.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs: Job[];
  inventory: InventoryItem[];
}

export function BestSellersCard({ jobs, inventory }: Props) {
  // Default to the weekly view — "which tire is selling best this week".
  const [window, setWindow] = useState<BestSellerWindow>(7);
  // Default sort by JOBS (demand events) so a set-of-4 sale doesn't outrank
  // four single-tire jobs. "Sold" (tire units) stays one tap away.
  const [sortBy, setSortBy] = useState<BestSellerSort>('jobs');

  // Current in-stock qty per canonical size — same extractTireSize used to
  // key the best-seller rows, so a "215/55R17" row matches the inventory
  // item regardless of how the size was typed. Sums qty across items.
  const stockBySize = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of inventory ?? []) {
      const key = extractTireSize((it.size || '').trim());
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + (Number(it.qty) || 0));
    }
    return m;
  }, [inventory]);

  const rows = useMemo(
    () => computeBestSellingTires(jobs, { windowDays: window, sortBy, limit: 10, onHandBySize: stockBySize }),
    [jobs, window, sortBy, stockBySize],
  );

  const windowLabel: Record<BestSellerWindow, string> = {
    7: 'last 7 days',
    30: 'last 30 days',
    90: 'last 90 days',
    all: 'all time',
  };

  // Single pill helper — keeps the two control rows visually consistent
  // without inlining the same 12-line button style block twice.
  const pillStyle = (active: boolean) => ({
    background: active ? 'var(--brand-primary)' : 'transparent',
    color: active ? '#0a0a0a' : 'var(--t3)',
    border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border)'}`,
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 10px',
    cursor: 'pointer',
    letterSpacing: 0.3,
  }) as const;

  const labelStyle = {
    fontSize: 10,
    color: 'var(--t3)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: 700,
  } as const;

  return (
    <div>
      {/* Window — last N days */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={labelStyle}>Window</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['7', 'Week'],
            ['30', '30d'],
            ['90', '90d'],
            ['all', 'All'],
          ] as const).map(([w, label]) => {
            const val: BestSellerWindow = w === 'all' ? 'all' : (Number(w) as 7 | 30 | 90);
            return (
              <button key={w} onClick={() => setWindow(val)} style={pillStyle(window === val)}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort — quantity / size / revenue */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={labelStyle}>Sort</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['jobs', 'Jobs'],
            ['quantity', 'Sold'],
            ['size', 'Size'],
            ['revenue', '$'],
          ] as const).map(([val, label]) => (
            <button key={val} onClick={() => setSortBy(val)} style={pillStyle(sortBy === val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {rows.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--t3)', padding: '14px 0', textAlign: 'center', lineHeight: 1.5 }}>
              No completed tire jobs in the {windowLabel[window]}.{' '}
              Once you log a few jobs the ranking shows up here.
            </div>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.tireSize}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: i ? '1px solid var(--border2)' : 'none',
                }}
              >
                {/* Rank */}
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: i === 0
                    ? 'rgba(200,164,74,0.18)'
                    : 'var(--s2)',
                  color: i === 0 ? 'var(--brand-primary)' : 'var(--t3)',
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {i + 1}
                </div>

                {/* Size + count */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>
                    <SizeLink size={r.tireSize} variant="plain" style={{ fontSize: 13.5 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>
                    {r.jobCount} job{r.jobCount === 1 ? '' : 's'} · {money(r.avgPerTire)} avg/tire
                  </div>
                  {/* Current stock for this size — red when none left so a
                      hot seller you're out of jumps out. */}
                  {(() => {
                    const stock = stockBySize.get(r.tireSize) ?? 0;
                    return (
                      <div style={{ fontSize: 11, marginTop: 1, fontWeight: 700, color: stock > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                      </div>
                    );
                  })()}
                </div>

                {/* Qty + revenue */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-0.3px' }}>
                    {r.quantity}<span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}> sold</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 1, fontWeight: 600 }}>
                    {money(r.revenue)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
    </div>
  );
}
