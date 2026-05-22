# Review Automation — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #6 from the product roadmap — one-tap review automation.

## Goal

After a job is marked paid, surface a one-tap prompt to send the
customer a Google review request SMS — at the moment it's most
likely to be acted on, with zero extra navigation.

## Constraint

The app has no backend (no Cloud Functions, no-Blaze). A browser
cannot fire an SMS without a user gesture (`sms:` URIs need a tap).
So "automation" is NOT auto-send — it is surfacing the existing
one-tap send at the right moment. This is a deliberate, accepted
limitation, not a gap.

## Architecture

**Trigger.** `handleMarkPaid` in `src/App.tsx` is the single
chokepoint for marking a job paid (every Mark Paid button across
JobDetailModal / History / Dashboard / JobSuccessPanel routes
through it). After the Firestore write succeeds, it decides whether
to prompt.

**The prompt.** Today `handleMarkPaid` ends with
`addToast('Marked as paid', 'success')`. When a review should be
prompted, that becomes an **action-toast** instead:

> Marked as paid · **[Send review]**

`addActionToast(message, { label, onTap }, level)` already exists
(used by `useActiveTimer`). The `onTap` calls the existing
`handleSendReview(job)` — which already builds the templated SMS via
`openReviewSMSFromJob` AND stamps `reviewRequested` /
`reviewRequestedAt`. No new send logic is introduced.

**Show conditions.** All three must hold, else the plain
`'Marked as paid'` toast fires exactly as today:

1. `brand.autoReviewPrompt !== false` — the new per-business
   setting; `undefined` is treated as on (default ON).
2. `brand.reviewUrl` is a non-empty string — no point prompting
   toward a dead end (`handleSendReview` warns + aborts without a
   URL).
3. `!job.reviewRequested` — never double-prompt the same job.

## Data model

One additive field on the `Brand` interface
(`src/types/index.ts`) — stored on the `settings/main` doc
alongside `reviewUrl`, since both are review configuration:

```ts
/** When false, suppress the post-payment review-request prompt.
 *  undefined / true → prompt is on (default). */
autoReviewPrompt?: boolean;
```

No migration. Existing brands have it `undefined` → treated as on.

## Components / files

| File | Change |
|---|---|
| `src/types/index.ts` | add `autoReviewPrompt?: boolean` to `Brand` |
| `src/lib/review.ts` | new pure helper `shouldPromptReview(job, brand): boolean` (the 3 conditions) |
| `src/App.tsx` | `handleMarkPaid` — `shouldPromptReview` gate → `addActionToast` vs `addToast` |
| `src/components/settings/BrandSection.tsx` | toggle "Auto-prompt for a review after payment" below the Review URL field |

## Testing

- Logic suite (`tests/shouldPromptReview.test.ts`, tsx runner):
  setting off → false; missing reviewUrl → false; already
  `reviewRequested` → false; happy path → true; `autoReviewPrompt`
  undefined → treated as true.

## Out of scope (deliberate)

- True auto-send — impossible client-side (see Constraint).
- Dashboard catch-up list of un-reviewed jobs — the chosen
  delivery model is in-the-moment only.
- Review template wording — the engine already interpolates
  service / city / business name; unchanged.

## Decisions locked during brainstorming

- Delivery model: **in-the-moment prompt** (action-toast after
  Mark Paid), not a dashboard list.
- Control: **per-business setting, default ON** — a toggle so an
  operator who finds it noisy can disable it.
