# Mobile Service OS

White-label PWA for mobile tire & roadside-assistance businesses. Built with **Vite + React 18 + TypeScript + Firebase**.

## Stack

- **Vite 5** — fast dev server, production bundler
- **React 18** + **TypeScript 5** strict mode
- **Firebase 10** (Auth + Firestore w/ persistent local cache + Storage)
- **jsPDF** — invoice generation
- **PWA** — service worker, offline shell, install prompt

## Quick start

```bash
npm install
cp .env.example .env   # fill in your Firebase keys (or skip — fallback dev project is hard-coded)
npm run dev            # http://localhost:5173/mobileserviceos/
```

## Build

```bash
npm run build          # tsc -b && vite build → dist/
npm run preview        # serve dist locally
```

## Deploy

Pushes to `main` automatically deploy to GitHub Pages via `.github/workflows/deploy.yml`.

The site builds to `https://<username>.github.io/mobileserviceos/`. Override `VITE_BASE_PATH` if hosting at a custom domain root:

```bash
VITE_BASE_PATH=/ npm run build
```

### One-time GitHub Pages setup

1. Repo settings → Pages → Source: **GitHub Actions**
2. (Optional) Repo secrets: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
3. Push to `main`; the workflow builds and publishes `dist/`

### Firebase rules

```bash
npm install -g firebase-tools
firebase login
firebase use --add                    # select project
npm run deploy:rules                  # deploys firestore.rules and storage.rules
```

## Project structure

```
public/
  icons/            — full PWA icon set (16 → 1024px, maskable, monochrome, rounded)
  manifest.webmanifest
  sw.js             — service worker (offline shell)
  404.html          — GitHub Pages SPA fallback
  .nojekyll
src/
  App.tsx           — auth gating, tab routing, Firestore wiring
  main.tsx          — Vite entry, ErrorBoundary, SW registration
  components/       — Header, ToastHost, JobDetailModal, JobSuccessPanel, InstallBanner, ErrorBoundary
  context/
    BrandContext.tsx — multi-tenant brand & business-id provider
  lib/
    firebase.ts     — modular SDK init, scopedCol, fbSet/Listen/Delete, uploadLogo
    invoice.ts      — jsPDF invoice generator
    review.ts       — review-request SMS builder
    toast.ts        — toast singleton
    utils.ts        — pure helpers (money, dates, pricing, deductions)
    defaults.ts     — DEFAULT_BRAND/SERVICE_PRICING/SETTINGS, EMPTY_JOB
    useCountUp.ts   — count-up animation hook
    pwa.ts          — install prompt setup
  pages/            — AuthScreen, Dashboard, AddJob, History, Customers, Payouts, Expenses, Inventory, Settings
  styles/app.css    — full luxury black/gold stylesheet, mobile-first
  types/index.ts    — shared types
.github/workflows/deploy.yml
firestore.rules
storage.rules
firebase.json
vite.config.ts
tsconfig.json
```

## Multi-tenant

Each authenticated user is bootstrapped to a business document at `businesses/{businessId}` (defaults to `users/{uid}.businessId === uid`). All collections (`jobs`, `inventory`, `expenses`, `operational_settings`, `settings/main`) are scoped beneath `businesses/{businessId}/`. Multiple users can share one `businessId` — set the field on `users/{uid}` to assign team members.

## PWA

- Standalone display, theme-color black, status bar black-translucent
- Custom install banner (Android prompt + iOS instructions)
- Service worker pre-caches the app shell
- Update prompt via toast when new SW activates

## License

MIT
