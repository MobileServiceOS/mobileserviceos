// src/config/jobs/index.ts
// ═══════════════════════════════════════════════════════════════════
//  Job-lifecycle registry entry point. Resolves the effective
//  lifecycle for a given BusinessTypeConfig by merging the universal
//  stage baseline with the vertical's LifecycleExtensions.
//
//  Pure function — see spec §14.1. Memoize at the caller via
//  useActiveLifecycle() (src/lib/useActiveLifecycle.ts).
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from '@/config/businessTypes/registry';
import type {
  JobLifecycleStage,
  ResolvedLifecycle,
  StageSpec,
  SubStageSpec,
} from './lifecycle';
import { UNIVERSAL_STAGES } from './universal-stages';

export function resolveLifecycle(vertical: BusinessTypeConfig): ResolvedLifecycle {
  const ext = vertical.lifecycle;
  const applicable: ReadonlySet<JobLifecycleStage> | null =
    ext?.applicableStages ? new Set(ext.applicableStages) : null;

  // 1. Filter universal stages to those applicable for this vertical.
  // 2. Apply per-stage overrides via shallow merge (deep enough for
  //    our needs — every overridable property is primitive or a
  //    flat array; we never need to merge nested objects).
  const stages: StageSpec[] = UNIVERSAL_STAGES
    .filter((s) => !applicable || applicable.has(s.id))
    .map((base) => {
      const override = ext?.stageOverrides?.[base.id];
      if (!override) return base;
      return {
        ...base,
        ...override,
        id: base.id, // id is never overridable; keep universal
      };
    });

  // Build stageById Map for O(1) lookups by consumers.
  const stageById = new Map<JobLifecycleStage, StageSpec>();
  for (const s of stages) stageById.set(s.id, s);

  // Bucket substages by parent. Substages whose parentStage is NOT
  // in the resolved stages (vertical config error) emit a console
  // warning and get dropped. Substages with duplicate ids also
  // warn; first occurrence wins.
  const substagesByParent = new Map<JobLifecycleStage, SubStageSpec[]>();
  const seenIds = new Set<string>();
  for (const sub of ext?.substages ?? []) {
    if (seenIds.has(sub.id)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[job-lifecycle] duplicate substage id "${sub.id}" in vertical "${vertical.key}" — skipping`,
      );
      continue;
    }
    if (!stageById.has(sub.parentStage)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[job-lifecycle] substage "${sub.id}" refers to parent stage "${sub.parentStage}" which is not active for vertical "${vertical.key}" — skipping`,
      );
      continue;
    }
    seenIds.add(sub.id);
    const bucket = substagesByParent.get(sub.parentStage) ?? [];
    bucket.push(sub);
    substagesByParent.set(sub.parentStage, bucket);
  }

  return {
    stages,
    substagesByParent,
    stageById,
  };
}

// Re-export the type contracts + universal data so consumers can
// `import { ... } from '@/config/jobs'` without knowing the file
// layout under the hood.
export type {
  JobLifecycleStage,
  StageSpec,
  SubStageSpec,
  StageNotificationSpec,
  LifecycleExtensions,
  ResolvedLifecycle,
  LifecycleTransition,
  TransitionRetentionPolicy,
  LegacyMirrorContext,
} from './lifecycle';
export { UNIVERSAL_STAGES } from './universal-stages';
