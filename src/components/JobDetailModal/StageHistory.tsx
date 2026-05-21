// src/components/JobDetailModal/StageHistory.tsx
// ═══════════════════════════════════════════════════════════════════
//  Collapsible transition timeline for JobDetailModal. Reads
//  job.transitions[] via the historyEntries() pure helper which
//  resolves stage labels + actor names. Empty-state when no
//  transitions yet. Newest-first.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import type { Job } from '@/types';
import type { ResolvedLifecycle } from '@/config/jobs/lifecycle';
import { historyEntries } from '@/lib/jobLifecycle';

interface Props {
  job: Job;
  resolved: ResolvedLifecycle;
  resolveName: (uid: string | undefined | null) => string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function StageHistory({ job, resolved, resolveName }: Props) {
  const [open, setOpen] = useState(false);
  const rows = historyEntries(job, resolved, resolveName);

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'transparent', border: 0, padding: 0,
          color: 'var(--t1)', cursor: 'pointer',
        }}
      >
        <span className="form-group-title" style={{ margin: 0 }}>
          {open ? '▾' : '▸'} History {rows.length > 0 ? `(${rows.length})` : ''}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {rows.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--t3)', padding: '8px 0' }}>
              No stage history yet — transitions are recorded as you advance the job.
            </div>
          ) : (
            rows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '8px 0',
                  borderTop: i === 0 ? 0 : '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <span style={{ color: 'var(--brand-primary)', fontSize: 10 }}>●</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.stageLabel}
                    {r.outOfFlow && (
                      <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 6 }}>
                        ⚠ skip
                      </span>
                    )}
                  </div>
                  {r.fromStageLabel && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                      from {r.fromStageLabel}
                    </div>
                  )}
                  {r.note && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontStyle: 'italic' }}>
                      {r.note}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--t3)' }}>
                  <div>by {r.actorLabel}</div>
                  <div>{formatTime(r.at)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
