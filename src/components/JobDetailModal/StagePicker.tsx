// src/components/JobDetailModal/StagePicker.tsx
// ═══════════════════════════════════════════════════════════════════
//  Stage picker for JobDetailModal. Renders the applicable stages
//  grouped by category (pre-service / in-field / post-service /
//  terminal). Each chip is role-gated via canTransitionToStage and
//  marked with "→" when in the current stage's recommendedNext set.
//  Tapping a stage with declared substages opens an inline secondary
//  row; tap "Skip" to leave substage undefined.
//
//  Out-of-flow taps are allowed silently — the transition writer
//  stamps outOfFlow: true and the History section surfaces a badge.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { Job, Role } from '@/types';
import type {
  JobLifecycleStage,
  ResolvedLifecycle,
  StageSpec,
  SubStageSpec,
} from '@/config/jobs/lifecycle';
import { deriveLifecycleStage, isRecommendedNext } from '@/lib/jobLifecycle';
import { canTransitionToStage } from '@/lib/jobPermissions';

interface Props {
  job: Job;
  resolved: ResolvedLifecycle;
  role: Role | null;
  onTransition: (toStage: JobLifecycleStage, toSubstage?: string) => void;
}

const CATEGORY_LABELS: Record<StageSpec['category'], string> = {
  pre_service: 'Pre-service',
  in_field: 'In-field',
  post_service: 'Post-service',
  terminal: 'Terminal',
};

export function StagePicker({ job, resolved, role, onTransition }: Props) {
  const currentStage = job.lifecycleStage ?? deriveLifecycleStage(job);

  const [pendingStage, setPendingStage] = useState<JobLifecycleStage | null>(null);

  const grouped = useMemo(() => {
    const groups: Record<StageSpec['category'], StageSpec[]> = {
      pre_service: [], in_field: [], post_service: [], terminal: [],
    };
    for (const s of resolved.stages) groups[s.category].push(s);
    return groups;
  }, [resolved]);

  const handleStageTap = (stage: JobLifecycleStage): void => {
    const subs = resolved.substagesByParent.get(stage);
    if (subs && subs.length > 0) {
      setPendingStage(stage);
      return;
    }
    onTransition(stage);
  };

  const handleSubstagePick = (sub: SubStageSpec | null): void => {
    if (pendingStage) {
      onTransition(pendingStage, sub?.id);
      setPendingStage(null);
    }
  };

  const pendingSubs = pendingStage
    ? (resolved.substagesByParent.get(pendingStage) ?? [])
    : [];

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <div className="form-group-title">Stage</div>
      {(['pre_service', 'in_field', 'post_service', 'terminal'] as const).map((cat) => {
        const stages = grouped[cat];
        if (stages.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 10, color: 'var(--t3)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
            }}>
              {CATEGORY_LABELS[cat]}
            </div>
            <div className="chip-grid">
              {stages.map((s) => {
                const isCurrent = s.id === currentStage;
                const isRecommended = isRecommendedNext(currentStage, s.id, resolved);
                const allowed = canTransitionToStage(role, s.id);
                const label = (isRecommended && !isCurrent ? '→ ' : '')
                  + (s.shortLabel || s.label);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={'chip' + (isCurrent ? ' active' : '')}
                    style={{
                      opacity: allowed ? 1 : 0.4,
                      cursor: allowed && !isCurrent ? 'pointer' : 'not-allowed',
                    }}
                    onClick={() => { if (allowed && !isCurrent) handleStageTap(s.id); }}
                    disabled={!allowed}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {pendingStage && pendingSubs.length > 0 && (
        <div style={{
          marginTop: 8, padding: 10,
          background: 'var(--s2)', border: '1px solid var(--brand-primary)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 6 }}>
            Substage for {resolved.stageById.get(pendingStage)?.label}:
          </div>
          <div className="chip-grid">
            {pendingSubs.map((sub) => (
              <button
                key={sub.id}
                type="button"
                className="chip"
                onClick={() => handleSubstagePick(sub)}
              >
                {sub.label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => handleSubstagePick(null)}
              style={{ opacity: 0.7 }}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
