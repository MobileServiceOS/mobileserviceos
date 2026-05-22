# White-Label Branding — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #15 from the product roadmap — white-label branding engine.

## Goal

Branding is ~80% built (logo, primary/accent colors, business name,
invoice footer, per-vertical services). Close the two real gaps:
the dead `tagline` field, and the lack of a brand preview.

## Part 1 — Wire the `tagline` field

`brand.tagline: string` already exists in the type (default `''`)
but is editable nowhere and displayed nowhere. Make it real:

- **Editable** — a "Tagline" text input in `BrandSection`, near
  Business Name.
- **Header** — the subtitle shows `brand.tagline` when non-empty;
  otherwise the current fallback (`vertical.displayName ·
  brand.serviceArea`). The operator's chosen line wins when set.
- **Invoice** — a tagline line beneath the business name on the
  PDF, Pro-gated (consistent with logo / reviewUrl / invoiceFooter
  being Pro white-label features).

No type change — `tagline` is already declared.

## Part 2 — Live Brand Preview

A new `src/components/settings/BrandPreview.tsx` — a pure-props
component mounted at the TOP of the Brand settings form. Renders
from the live `draft` values so it updates as the operator
edits, before they save:

- **App-header mockup** — logo + business name + tagline, accented
  with the draft primary color.
- **Invoice-header mockup** — a primary-color band + logo + name +
  tagline; a mini of the real invoice top.

Colors render through `normalizeHex(value, fallback)` so a
mid-edit invalid hex can never break the preview.

## Files

| File | Change |
|---|---|
| `src/components/settings/BrandPreview.tsx` | **new** — live composed preview, pure props |
| `src/components/settings/BrandSection.tsx` | tagline input + mount `BrandPreview` |
| `src/components/Header.tsx` | subtitle shows `tagline` when set |
| `src/lib/invoice.ts` | tagline line on the PDF (Pro-gated) |

## Testing

`tests/components/BrandPreview.test.tsx` (vitest) — renders the
business name + tagline; hides the tagline line when empty;
applies the primary-color prop. Pure-props component, clean to
test like `ServicePicker`.

## Out of scope

- Own domain — infrastructure, "later" per the roadmap.
- Full theme propagation — the other brainstorming option, not
  chosen.

## Decisions locked during brainstorming

- Scope: **complete + preview the brand** (wire `tagline`, add a
  live preview), not full theme propagation.
