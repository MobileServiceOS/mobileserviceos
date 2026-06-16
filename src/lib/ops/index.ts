// src/lib/ops/index.ts
// ═══════════════════════════════════════════════════════════════════
//  AI ops layer — public surface.
//
//  Turns MSOS business data into recommendations and drafts via a
//  server-side Anthropic call, with a hard human-approval gate on any
//  money / send / irreversible action. See docs/ai-ops-layer.md.
// ═══════════════════════════════════════════════════════════════════

export * from '@/lib/ops/json';
export * from '@/lib/ops/approval';
export * from '@/lib/ops/houseStyle';
export * from '@/lib/ops/registry';
export { callAiOps, DEFAULT_OPS_MODEL } from '@/lib/ops/client';

export {
  gatherReorderContext,
  buildReorderPrompt,
  parseReorderResult,
  type ReorderContext,
  type ReorderContextItem,
  type ReorderRecommendation,
  type ReorderResult,
} from '@/lib/ops/loops/reorder';

export {
  gatherReviewContext,
  buildReviewPrompt,
  parseReviewResult,
  type ReviewInput,
  type ReviewContext,
  type ReviewDraft,
} from '@/lib/ops/loops/review';

export {
  gatherBriefContext,
  buildBriefPrompt,
  parseBriefResult,
  type BriefContext,
  type DailyBrief,
} from '@/lib/ops/loops/brief';
