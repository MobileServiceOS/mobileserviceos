# Mobile Service OS

White-label PWA for mobile tire & roadside-assistance businesses. Built with **Vite + React 18 + TypeScript + Firebase**.

Production: <https://mobileserviceos.github.io/mobileserviceos/>

## Stack

- **Vite 5** — fast dev server, production bundler
- **React 18** + **TypeScript 5** strict mode
- **Firebase 10** (Auth + Firestore w/ persistent local cache + Storage)
- **jsPDF** — invoice generation
- **PWA** — service worker, offline shell, install prompt

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173/mobileserviceos/
```

## Build & deploy

```bash
npm run build          # tsc -b && vite build → dist/
npm run preview        # serve dist locally
```

Pushes to `main` automatically deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Firebase setup checklist

The Firebase web config (`apiKey`, `authDomain`, etc.) is committed in `.env.production` and baked as a fallback into `src/lib/firebase.ts`. Web API keys are public-by-design — security comes from the auth domain allowlist + Firestore rules below, not from hiding the key. **You still need to do these one-time steps in the Firebase Console:**

### 1. Enable sign-in providers

[Firebase Console → Authentication → Sign-in method](https://console.firebase.google.com/project/mobile-service-os/authentication/providers)

- ✅ Enable **Email/Password**
- ✅ Enable **Google** (set support email)

> If you skip this you'll get `auth/operation-not-allowed` on every sign-in attempt.

### 2. Authorize the deployed domain

[Firebase Console → Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/mobile-service-os/authentication/settings)

Add:
- `mobileserviceos.github.io`
- `localhost` (already present by default — needed for `npm run dev`)

> If you skip this you'll get `auth/unauthorized-domain` on Google sign-in.

### 3. Deploy Firestore + Storage rules

```bash
npm install -g firebase-tools
firebase login
firebase use mobile-service-os
npm run deploy:rules
```

### 4. (Optional) Override config via repo secrets

For private white-label deploys that point at a different Firebase project, set these in **GitHub repo Settings → Secrets and variables → Actions**:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

The workflow injects them only if `VITE_FIREBASE_API_KEY` is set; otherwise `.env.production` drives the build.

## Project structure

```
public/
  icons/            — full PWA icon set (16 → 1024px, maskable, monochrome, rounded)
  manifest.webmanifest
  sw.js             — service worker (network-first navigation, no index.html pre-cache)
  404.html          — GitHub Pages SPA fallback
  .nojekyll
src/
  App.tsx           — auth gating, 8-tab routing, all Firestore wiring
  main.tsx          — Vite entry, ErrorBoundary, SW registration
  components/       — Header, ToastHost, JobDetailModal, JobSuccessPanel, InstallBanner, ErrorBoundary
  context/
    BrandContext.tsx — multi-tenant brand & business-id provider
  lib/
    firebase.ts     — modular SDK init, scopedCol, fbSet/Listen/Delete, uploadLogo
    deserializers.ts — type-safe converters from raw Firestore docs to typed app objects
    invoice.ts      — jsPDF invoice generator
    review.ts       — review-request SMS builder
    toast.ts        — toast singleton
    utils.ts        — pure helpers (money, dates, pricing, deductions)
    defaults.ts     — DEFAULT_BRAND/SERVICE_PRICING/SETTINGS, EMPTY_JOB
    useCountUp.ts   — count-up animation hook
    pwa.ts          — install prompt setup
  pages/            — AuthScreen, Dashboard, AddJob, History, Customers, Payouts, Expenses, Inventory, Settings
  styles/app.css
  types/index.ts
.github/workflows/deploy.yml
.env.production       — Firebase config for production build (committed)
firestore.rules
storage.rules
firebase.json
vite.config.ts
tsconfig.json
```

## Inventory intelligence

Two rules drive the Best Seller list, the Reorder Now engine, and the
inventory stock flags (`src/lib/bestSellingTires.ts`,
`src/lib/inventoryIntel.ts`):

- **Demand is measured in JOBS, not tire units.** One job is one demand
  event regardless of how many tires it moved — a set-of-4 job counts the
  same as a single-tire job. Best Sellers default to a **Jobs** sort
  (Sold / Size / $ still available); Reorder Now ranks by jobs with
  tie-break **out-of-stock → revenue → units**.
  Unit counts stay visible ("N sold"); they just don't drive ranking. This
  surfaces hot-but-out-of-stock sizes that unit-based top-N used to hide.
  Both the Best Sellers screen and the Inventory Intelligence / Reorder Now
  panel carry a **Week / 30d / 90d / All** window selector, and job counts
  are computed **per window** (a size hot in 30d but quiet over 90d ranks
  accordingly in each). The Reorder Now panel defaults to the **90d** view.

- **On-hand is aggregated PER SIZE.** A size can exist as several entries
  (true duplicates, or a New + Used split). On-hand, low/out flags, and
  reorder reads **sum qty across every entry** of a size, grouped by a
  normalized size key (`sizeKey` collapses `205/55R16` / `205/55/16` /
  case/space, R vs slash). Aggregation happens at **read time**, so future
  duplicates aggregate automatically. The Inventory screen's
  **Consolidate** button additionally runs a one-time, idempotent cleanup
  (`src/lib/inventoryConsolidate.ts`) that collapses the stored records to
  one row per size — quantities and reservations are summed into a single
  surviving record (no qty is dropped; safe to re-run).

Tested by `tests/inventoryIntel.test.ts`, `tests/bestSellingTires.test.ts`
(tsx) and `tests/inventoryConsolidate.spec.ts` /
`tests/inventoryAcceptance.spec.ts` (vitest).

## AI Ops layer

`More → AI Ops` (owner/admin) turns business data into recommendations and
drafts with a hard human-approval gate on anything that sends or spends. Three
loops ship today — **daily brief**, **reorder recommendations**, and a
**Google review reply** drafter (house style: no emoji, no dashes, always
"mobile tire repair service", references Broward + Miami Dade) — and the pattern
is reusable for more.

Every Anthropic call runs server-side in the `aiOps` Cloud Function
(`functions/src/aiOps.ts`), which holds the `ANTHROPIC_API_KEY` secret; the key
never reaches the client. Model output is always safe-parsed before render, and
side-effecting actions route through a fail-closed approval gate. Reorder/brief
reuse the inventory intelligence above (no reinvented ranking).

Full guide — how it works, adding a loop, secret + model config — in
[`docs/ai-ops-layer.md`](docs/ai-ops-layer.md). Tested by `tests/ops/*.spec.ts`.

## Internal linking (SizeLink)

Every tire size shown in the app is a tappable link to its stock, via one
shared component — `src/components/SizeLink.tsx`. It's wired through a React
context (`SizeLinkProvider` in `App.tsx`) so it works inside pages, lazy
routes, and modals without prop-drilling, and degrades to plain text when no
provider is mounted. Tapping a size focuses the **Inventory** tab on it.

Surfaces: History job cards, Best Sellers (Insights), Reorder Now /
Inventory Intelligence rows, Job Detail, Customer profile service history,
Quick Quote (shows on-hand under the size field), and the Dashboard **Low
Stock Alert** cards (whole card is tappable, via the `useSizeLinkNav` hook).

The **buy decision happens on one screen**: arriving via a SizeLink pins a
focus banner at the top of Inventory showing **on-hand · jobs/90d · sold
(90d)** plus a **Reorder** action that records restocked units
(`src/lib/inventoryRestock.ts` — adds to the size's entry, or creates one if
it was never stocked). Tested by `tests/components/SizeLink.test.tsx` and
`tests/inventoryRestock.spec.ts`.

**Reverse link:** the focus banner's **"View N jobs →"** button opens
**History filtered to that size** (`filterHistoryJobs` in
`src/lib/historyFilter.ts`, via History's `focusSize` prop), closing the
size ↔ stock ↔ jobs loop. Tested by `tests/historyFilter.spec.ts`.

## Responsive layout (mobile-first)

Phone is the default and the source of truth — `.page` is capped at
`min(760px, 100%)` and the layout is built/tuned at phone width first.
Tablet and desktop **scale up** via media queries in `src/styles/app.css`
(they never change phone rendering):

- **≥768px (tablet):** content widens to `min(900px, 100%)`.
- **≥1200px (desktop):** content widens to `1160px`; the bottom nav floats
  into a centered pill instead of stretching edge-to-edge.
- **≥1024px:** the `.cols-lg` utility splits independent cards into two
  columns (used on Insights) so wide screens aren't wasted; it collapses
  back to one column below 1024px.

`src/lib/useBreakpoint.ts` exposes the same breakpoints to JS (`mobile` /
`tablet` / `desktop`, mobile-default) and stamps `data-bp` on `<main>`.
Tested in `tests/components/useBreakpoint.test.tsx` at all three widths.

**Loading states:** lazy routes (Insights, Payments, …) and the Jobs/History
screen show `src/components/Skeleton.tsx` placeholders while loading instead
of a blank screen (`tests/components/Skeleton.test.tsx`).

## Branding & service area

- **Tagline** defaults to **"We rush. You roll."** (`DEFAULT_BRAND.tagline`).
  `resolveBrandDefaults` (in `src/lib/defaults.ts`) coalesces a blank stored
  tagline to the default, so it renders under the business name on the app
  **header** and on **invoices** (Pro) without each business having to set
  it. A business can still type its own tagline in Settings.
- **Service cities** use a chip multiselect with autocomplete
  (`src/components/settings/ServiceCitiesField.tsx`): typing suggests cities
  for the business's state (defaults to FL); Enter/comma/selection adds a
  chip; manual entry works for cities not in the suggestion DB (e.g.
  "West Park", "Brickell"). Saved values are normalized by
  `normalizeServiceCities` — title-cased, trimmed, deduped
  case-insensitively, so "Miami gardens" and "Miami Gardens" never both
  persist. The field is pre-populated with the real service area (23 South
  Florida cities, `DEFAULT_SERVICE_CITIES`). Tested in
  `tests/serviceCitiesAndTagline.spec.ts` and
  `tests/components/ServiceCitiesField.test.tsx`.

## Invoice & Estimate documents

One generator (`src/lib/invoice.ts` → `generateInvoicePDF`) produces both
documents from a job, matching the Wheel Rush branded template (orange
accent + navy bars + logo, contact line, PREPARED FOR / VEHICLE / TIRE SIZE
/ SERVICE TYPE block, TOTAL DUE bar, notes, navy footer). Two axes:

- **mode** — `invoice` → **INVOICE**, `quote` → **ESTIMATE** (adds a
  "Valid Until" date).
- **breakdown** — `total` (**Type A**, one price) or `itemized` (**Type B**,
  a DESCRIPTION/QTY/UNIT PRICE/AMOUNT table with Subtotal + Tax). Defaults to
  itemized when the job has line items, else total.

**Type B data** comes from operator-entered `job.lineItems`
(`{ description, qty, unitPrice }`) via the `LineItemsEditor` in Add/Edit
Job; the lines auto-sum and set `job.revenue`. From a job, the Job Detail
sheet's **Document style** toggle picks Total (A) or Itemized (B) for both
**Send Invoice** and **Send Quote**. Pure helpers (`buildDocNumber`,
`normalizeLineItems`, `lineItemsTotal`) are tested in
`tests/quoteDocument.spec.ts`.

## Removed: Leads tab & Missed Call Recovery

The **Leads** bottom-nav tab + pipeline screen and the **Missed Call
Recovery** feature have been removed (no longer used). Gone: `src/pages/
Leads.tsx`, `src/components/leads/*`, `MissedCallRecoverySection`,
`leadLifecycle`/`leadPriority` libs, the `Lead`/`OutboundSms` types, the
`'leads'` TabId, and the missed-call branch of the incoming-call popup. The
live **caller-ID popup** (`IncomingCallNotification`, `incoming_calls`) is
unaffected and still works.

**Lead-source attribution is preserved.** It was never sourced from the
Leads pipeline — it's captured on `job.source` (the AddJob "Lead source"
chips) and read directly by `computeInsights` → the Insights **"Top Lead
Sources by Revenue"** card and the Dashboard "Lead Sources" card. Guarded by
`tests/leadSourceAttribution.spec.ts`.

Backend Cloud Functions / Firestore rules for the legacy `leads` collection
are a separate deploy concern and are intentionally left untouched; nothing
in the app reads or writes leads anymore.

## Troubleshooting deployed auth errors

| Error | Fix |
|---|---|
| `auth/operation-not-allowed` | Enable the provider in Firebase Console → Authentication → Sign-in method |
| `auth/unauthorized-domain` | Add `mobileserviceos.github.io` to Authentication → Settings → Authorized domains |
| `auth/invalid-api-key` | The bundled key is wrong or restricted in GCP. Re-copy from Firebase Console → Project Settings → Web app → Config |
| `auth/popup-blocked` (Google) | Browser is blocking the popup. Allow popups for the site, or switch to redirect flow |
| Stuck on splash | Old service worker. Hard-refresh (Cmd+Shift+R), or use the in-app "Clear cache & reload" button |

## License

MIT
