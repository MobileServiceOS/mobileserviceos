# MSOS — App Store Submission Assets & Listing Spec

Reference for preparing the Apple App Store listing for **Mobile Service OS (MSOS)**.
This is a **spec only** — no image files are produced here. Capture the screenshots
per the dimensions below, then upload in App Store Connect.

> **Packaging status:** the native wrapper now EXISTS — MSOS is wrapped with
> **Capacitor** (`capacitor.config.ts`, `ios/` project, `docs/capacitor-ios-guide.md`).
> It adds offline, camera, and push, satisfying the "minimum functionality"
> guideline (4.2). Remaining native steps (device signing, archive → TestFlight)
> wait on the Apple Developer account approval + Xcode on Javon's Mac. Everything
> below is the **listing** prep, all verifiable now.

---

## 1. Screenshots — required sizes (App Store Connect, 2025)

Apple derives smaller sizes from the largest you provide, so the **6.9" iPhone set
is the only strictly required one**. Provide iPad sizes only if you ship an
iPad-compatible build.

| Device class | Example device | Portrait px (W × H) | Required? |
|---|---|---|---|
| **iPhone 6.9"** | iPhone 16 Pro Max | **1320 × 2868** | **Yes** |
| iPhone 6.7" | iPhone 15 Pro Max | 1290 × 2796 | Accepted in place of 6.9" |
| iPhone 6.5" | iPhone 11 Pro Max | 1242 × 2688 | Optional (legacy) |
| iPad 13" | iPad Pro 13" (M4) | 2064 × 2752 | Only if iPad build |

Rules:
- **3–10 screenshots** per device class (aim for 5–6 — the first 2–3 show in search).
- PNG or JPEG, **RGB, no alpha/transparency**, ≤ 500 MB each.
- No device frames required (Apple shows them flat). Status bar should look clean —
  full battery, full signal, a sensible clock (9:41 is Apple's convention).
- Keep real, representative data on screen (not lorem-ipsum / $0 empty states).

### Capture on a 6.9" simulator/device at these screens (in listing order)

1. **Dashboard hero** — "This Week's Profit" ring + today's stats + Today's
   Schedule. The money shot: shows it's a real business OS at a glance.
2. **Schedule / Today's Schedule** — a booked job card + the "Schedule a Job"
   flow. Sells the appointment feature.
3. **Add Job (Quick Pricing)** — the fast log-a-job form with the suggested price.
   Shows speed/ease in the field.
4. **Branded Invoice / Estimate PDF** — the orange+navy Wheel-Rush-style document
   with logo + line items. Proves the customer-facing output.
5. **Insights** — the hero stat row + Revenue & Profit by Month chart with the
   trend line. Shows the analytics depth.
6. **Inventory** (optional 6th) — tire stock list with low-stock alerts.

Add a one-line caption overlay on each (optional but converts better), e.g.
"Quote a job in 15 seconds", "Send a branded invoice by text", "Know your profit
every week."

---

## 2. App icon — DONE ✅

- **File:** [`assets/app-icon-1024.png`](../assets/app-icon-1024.png) — ready to upload.
- **Verified specs:** `1024 × 1024`, PNG, **3 channels / no alpha**, sRGB, square
  full-bleed (no rounded corners — Apple masks them). Uses the existing MSOS mark on
  the dark brand background.
- Note: this was flattened from `public/icons/icon-1024.png`, which had an alpha
  channel — **App Store Connect rejects icons with transparency**, so do not upload
  the `public/icons/` version. Use `assets/app-icon-1024.png`.

---

## 3. Listing metadata

- **App name (30 char max):** `Mobile Service OS`  *(17 chars)*
- **Subtitle (30 char max):** `Mobile Tire & Roadside Pros`  *(27 chars)*
- **Promotional text (170 char max, updatable any time):**  *(157 chars)*
  `Run your whole mobile tire & roadside operation from your phone — quote, schedule, invoice, and see real profit between stops. No paperwork, no spreadsheets.`
- **Keywords (100 char max, comma-separated, no spaces after commas):**  *(99 chars)*
  `tire repair,roadside assistance,job tracker,field tech,invoice maker,tire shop,small business,quote`
  *(Deliberately avoids "mobile"/"service" — already in the app name, so repeating them in keywords is wasted space.)*
- **Support URL:** `https://app.mobileserviceos.app` (resolves; in-app Help is public via `?help=1`, contact `info@mobileserviceos.app`)
- **Marketing URL (optional):** `https://app.mobileserviceos.app`
- **Privacy Policy URL:** `https://app.mobileserviceos.app/privacy`  *(live — built, see §7)*
- **Primary category:** Business · **Secondary:** Productivity
- **Age rating:** 4+

### App Privacy ("nutrition label") answers
Declare in App Store Connect → App Privacy:
- **Data collected:** Contact info (name, phone, email of the operator and their
  customers), User content (job/customer/business records), Identifiers (account
  user ID). **Diagnostics** only if you add analytics/crash SDKs (none today).
- **Linked to the user:** Yes (it's their business data).
- **Used for tracking:** **No.** No third-party ad/tracking SDKs.
- **Purpose:** App functionality only.
This must match `/privacy`.

---

## 4. Suggested App Store description

> **Mobile Service OS — the operating system for mobile tire & roadside pros**
>
> Stop running your business on notebooks, texts, and spreadsheets. Mobile Service
> OS (MSOS) is built for solo operators and small crews who fix flats, replace
> tires, and run roadside calls — log a job, send a branded invoice, and see your
> real profit, all from your phone between stops.
>
> **Quote and log jobs in seconds**
> Pick the service, get a suggested price tuned to your costs and mileage, and save.
> Returning customer? Their info and vehicle auto-fill from the phone number.
>
> **Schedule ahead**
> Book jobs for later, see Today's Schedule the moment you open the app, and advance
> each one — En Route → In Progress → Complete — with a tap.
>
> **Send professional invoices & estimates**
> Text a clean, branded invoice or estimate (your logo, your colors) as a PDF — total
> or fully itemized — without leaving the job.
>
> **Know your numbers**
> Weekly profit, revenue and profit by month, top services, best-selling tire sizes,
> revenue by city, lead-source breakdown, and unpaid-invoice aging — all live from
> your jobs. No data entry.
>
> **Track tire inventory**
> Stock counts deduct automatically as you complete jobs, with low-stock alerts so
> you never show up without the right tire.
>
> **Works in the field**
> Fast, mobile-first, and built to keep working when signal drops. Record how you got
> paid (cash, Zelle, card, and more) — MSOS keeps the books; you keep the cash.
>
> Made for mobile tire repair, tire replacement, and roadside assistance businesses.

(Trim to taste; the App Store description has a 4,000-character limit and the first
~3 lines show before "more".)

---

## 5. Pricing & in-app purchase

**Codebase facts (verified):** two Stripe subscription tiers — **Pro `$79`/month**
and **Core `$39`/month** (`src/lib/pricing-display.ts`; price IDs via
`VITE_STRIPE_PRO_PRICE_ID` / `VITE_STRIPE_CORE_PRICE_ID`). **The paywall is currently
OFF** — `GROWTH_MODE = true` (`src/lib/growthMode.ts`) bypasses billing, so the app
is free and **no purchase UI is active**.

**Recommendation: ship as a free download with web-based Stripe billing — do NOT use
Apple In-App Purchase.**

- **At launch this is trivially clean:** with `GROWTH_MODE = true` there is no
  purchase, paywall, or price shown in the app at all → nothing for Apple to take a
  cut of and nothing to review under IAP rules. Submit as **free**.
- **When you re-enable billing later (B2B SaaS path):** keep subscriptions on the
  **website** (Stripe Checkout / customer portal). Apple's cut (30%, or 15% under the
  Small Business Program <$1M) only applies to **Apple IAP**. For a $39–$79/mo
  business tool, web Stripe avoids that *and* keeps the customer + billing
  relationship with you.
- **Hard rule for the native build (Guideline 3.1.1 / 3.1.3):** the iOS app must
  **not** show in-app purchase buttons, prices to buy, or links/CTAs to the external
  Stripe checkout. Users may *use* a subscription bought on the web, but the app
  can't sell or link to it. ⚠️ **Action when billing returns:** the existing
  `SubscribeButton` (`src/components/SubscribeButton.tsx`) + any "Upgrade"/price CTA
  must be hidden on native (`Capacitor.isNativePlatform()`) before that build is
  submitted. Not a launch blocker today because the paywall is off.
- **Trade-off:** web Stripe = no Apple cut + you own billing, but no slick in-app
  "Upgrade" tap (drive users to the site). Native IAP = smoother upgrade, but
  15–30% off the top and Apple owns the receipt. For B2B SaaS, web Stripe wins.

---

## 6. Demo account for App Review

Apple reviewers must be able to use the app without setup. Provide in App Store
Connect → App Review Information:
- A **pre-seeded demo login** (email + password) that lands in a populated dashboard
  (jobs, inventory, an invoice) so reviewers don't see empty states.
- Confirm **self-serve signup works** (it must — see the signup-flow review) in case
  the reviewer creates their own account.
- Notes: "Sign in with the demo account, or create a new one — onboarding sets up a
  business in under a minute. No special hardware required."

---

## 7. Pre-submission checklist (status verified against the repo)

**Done now (verifiable without the Developer account):**
- [x] **App icon** — `assets/app-icon-1024.png`, 1024², no alpha, sRGB. ✅
- [x] **Privacy policy built** — `/privacy` (`src/pages/PrivacyTerms.tsx`): covers data
  collected (account, operational job/customer, team, payment-via-Stripe, technical),
  storage (Firebase, US), sharing (not sold; sub-processors listed), rights
  (access/export/correct/delete), contact `info@mobileserviceos.app`. ✅
- [x] **Listing copy finalized** — name/subtitle/promo/keywords/description above, all
  within Apple's char limits. ✅
- [x] **Support + Marketing URL live** — `https://app.mobileserviceos.app` resolves;
  public Help via `?help=1`. ✅
- [x] **Onboarding flow** — Welcome + business-type, per-step validation, tested
  (helpers covered by `tests/`). ✅
- [x] **Empty states** — every Insights card has a proper empty state. ✅
- [x] **Capacitor wrapper integrated** — config + `ios/` project + guide. ✅
- [x] **Pricing decision** — free download, web Stripe, no IAP (see §5). ✅

**Outstanding — needs Javon / the approved Developer account / a Mac:**
- [ ] **Screenshots** — capture 5–6 at **6.9" (1320×2868)** [or 6.7" 1290×2796];
  6.5" (1242×2688) optional. Screens: Dashboard → Schedule → Add Job → Invoice PDF →
  Insights. *(Can be done now in the iOS Simulator even before approval.)*
- [ ] **Sign-in confirmed in the native build** — code fixed (persistence + cross-origin
  iframe, PRs #126/#127) but **not yet click-confirmed on a device/sim run**. Verify
  email/password reaches the dashboard before submitting.
- [ ] **Device signing + archive → TestFlight** — needs the approved Apple Developer
  account + Xcode (`docs/capacitor-ios-guide.md`).
- [ ] **Demo account seeded** + credentials in App Review notes (see §6).
- [ ] **App Privacy "nutrition label"** answered in App Store Connect to match `/privacy`.
- [ ] **Click-confirm** `https://app.mobileserviceos.app/privacy` loads with no login
  (it's deployed; just verify in a browser).
