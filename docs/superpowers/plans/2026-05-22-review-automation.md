# Review Automation — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-22-review-automation-design.md`

**Goal:** One-tap review-request prompt via an action-toast after a
job is marked paid, gated by a per-business setting.

**Architecture:** Pure helper `shouldPromptReview` decides; the
single `handleMarkPaid` chokepoint shows an action-toast vs a plain
toast; `onTap` reuses existing `handleSendReview`. Additive `Brand`
field, no migration.

**Tech:** React + TypeScript, existing toast + review modules.

---

### Task 1: `Brand.autoReviewPrompt` field

**Files:** Modify `src/types/index.ts`

- [ ] Add to the `Brand` interface, next to `reviewUrl`:
  ```ts
  /** When false, suppress the post-payment review-request prompt.
   *  undefined / true → prompt on (default). */
  autoReviewPrompt?: boolean;
  ```
- [ ] `npx tsc --noEmit` → clean.

### Task 2: `shouldPromptReview` helper + test

**Files:** Modify `src/lib/review.ts`; Create
`tests/shouldPromptReview.test.ts`

- [ ] Add the pure helper:
  ```ts
  import type { Job, Brand } from '@/types';

  /** Decide whether Mark Paid should surface the review-request
   *  action-toast. All three conditions must hold. */
  export function shouldPromptReview(job: Job, brand: Brand): boolean {
    if (brand.autoReviewPrompt === false) return false;
    if (!(brand.reviewUrl || '').trim()) return false;
    if (job.reviewRequested) return false;
    return true;
  }
  ```
- [ ] Write `tests/shouldPromptReview.test.ts` (tsx `check()` style):
  happy path → true; `autoReviewPrompt:false` → false;
  `autoReviewPrompt:undefined` → true; empty `reviewUrl` → false;
  whitespace `reviewUrl` → false; `reviewRequested:true` → false.
- [ ] `npx tsx tests/shouldPromptReview.test.ts` → all pass.

### Task 3: Wire `handleMarkPaid`

**Files:** Modify `src/App.tsx`

- [ ] Import `shouldPromptReview`; import `addActionToast` if not
  already imported.
- [ ] In `handleMarkPaid`, after the successful `fbSetFast`, replace
  the bare `addToast('Marked as paid', 'success')` with:
  ```ts
  if (shouldPromptReview(j, brand)) {
    addActionToast(
      'Marked as paid.',
      { label: 'Send review', onTap: () => { void handleSendReview(j); } },
      'success',
    );
  } else {
    addToast('Marked as paid', 'success');
  }
  ```
- [ ] Add `brand` and `handleSendReview` to `handleMarkPaid`'s
  dependency array. (`handleSendReview` is declared earlier in the
  file, so the reference resolves.)
- [ ] `npx tsc --noEmit` → clean.

### Task 4: Settings toggle

**Files:** Modify `src/components/settings/BrandSection.tsx`

- [ ] Below the Review URL field, add a toggle bound to
  `draft.autoReviewPrompt` via the `set` helper. `checked` is
  `draft.autoReviewPrompt !== false` (undefined → on). Label:
  "Auto-prompt for a review after payment". Match the existing
  checkbox pattern in the file.
- [ ] `npm run build` → clean.

### Task 5: Verify + ship

- [ ] `npm run build` clean, `npm test` 41 logic suites green,
  `npm run test:ui` 18 component suites green.
- [ ] Commit + push.
