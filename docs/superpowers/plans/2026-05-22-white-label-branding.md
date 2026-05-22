# White-Label Branding — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-22-white-label-branding-design.md`

**Goal:** Wire the dead `tagline` field + add a live Brand Preview.

---

### Task 1: `BrandPreview` component + test

**Files:** Create `src/components/settings/BrandPreview.tsx`,
`tests/components/BrandPreview.test.tsx`

- [ ] `BrandPreview({ businessName, tagline, logoUrl, primaryColor })`
  — pure props. Renders an app-header mockup + an invoice-header
  mockup. Colors via `normalizeHex(primaryColor, '#f4b400')`.
  Tagline line renders only when non-empty.
- [ ] Vitest test: name shown; tagline shown when set, absent when
  empty; primary color reflected.
- [ ] `npx vitest run` → green.

### Task 2: BrandSection — tagline input + preview

**Files:** Modify `src/components/settings/BrandSection.tsx`

- [ ] Add a "Tagline" `<input>` bound to `draft.tagline` via the
  `set` helper, near the Business Name field.
- [ ] Mount `<BrandPreview … />` at the top of the form, fed from
  `draft` (businessName, tagline, logoUrl, primaryColor).
- [ ] `npx tsc --noEmit` → clean.

### Task 3: Header — show tagline

**Files:** Modify `src/components/Header.tsx`

- [ ] Subtitle: `brand.tagline?.trim()` when present, else the
  existing `[vertical.displayName, brand.serviceArea]` fallback.
- [ ] `npx tsc --noEmit` → clean.

### Task 4: Invoice — tagline line

**Files:** Modify `src/lib/invoice.ts`

- [ ] Under the business name in the PDF header, draw
  `brand.tagline` when `isPro` and non-empty (small, muted).
- [ ] `npm run build` → clean.

### Task 5: Verify + ship

- [ ] `npm run build` clean; `npm test` (43 logic) green;
  `npm run test:ui` (19 component) green.
- [ ] Commit + push.
