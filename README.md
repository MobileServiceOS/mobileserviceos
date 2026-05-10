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
