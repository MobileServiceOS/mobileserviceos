import { useMemo, useState } from 'react';
import type { Job } from '@/types';
import { money } from '@/lib/utils';
import {
  computeBestSellingTires,
  type BestSellerWindow,
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
}

export function BestSellersCard({ jobs }: Props) {
  const [window, setWindow] = useState<BestSellerWindow>(90);

  const rows = useMemo(
    () => computeBestSellingTires(jobs, { windowDays: window, limit: 10 }),
    [jobs, window],
  );

  const windowLabel: Record<BestSellerWindow, string> = {
    30: 'last 30 days',
    90: 'last 90 days',
    all: 'all time',
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Best Selling Tires
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['30', '90', 'all'] as const).map((w) => {
            const val: BestSellerWindow = w === 'all' ? 'all' : (Number(w) as 30 | 90);
            const active = window === val;
            return (
              <button
                key={w}
                onClick={() => setWindow(val)}
                style={{
                  background: active ? 'var(--brand-primary)' : 'transparent',
                  color: active ? '#0a0a0a' : 'var(--t3)',
                  border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border)'}`,
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  letterSpacing: 0.3,
                }}
              >
                {w === 'all' ? 'All' : `${w}d`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card card-anim">
        <div className="card-pad">
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
                    {r.tireSize}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>
                    {r.jobCount} job{r.jobCount === 1 ? '' : 's'} · {money(r.avgPerTire)} avg/tire
                  </div>
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
    </div>
  );
}
