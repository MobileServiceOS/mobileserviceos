# MSOS — App Store Submission Assets & Listing Spec

Reference for preparing the Apple App Store listing for **Mobile Service OS (MSOS)**.
This is a **spec only** — no image files are produced here. Capture the screenshots
per the dimensions below, then upload in App Store Connect.

> **Heads-up (packaging):** MSOS today is a PWA served at `app.mobileserviceos.app`.
> Apple does **not** accept a pure PWA/URL in the App Store — the binary must be a
> native wrapper around the web app (e.g. **Capacitor** or a `WKWebView` shell) that
> ships an `.ipa`. The wrapper must add real value (offline, push, camera) — MSOS
> already has offline + camera, which satisfies the "minimum functionality"
> guideline (4.2). Everything below is the **listing** prep; the wrapper is a
> separate build step.

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

## 2. App icon

- **1024 × 1024 px**, PNG, RGB, **no alpha, no rounded corners** (Apple rounds it).
- Use the MSOS gold "MS" mark on the dark navy background for contrast.

---

## 3. Listing metadata

- **App name (30 char max):** `Mobile Service OS`
- **Subtitle (30 char max):** `Tire & roadside business OS`
- **Promotional text (170 char, updatable any time):**
  `Run your mobile tire & roadside business from your phone — quote, schedule, invoice, and track profit in seconds. No paperwork.`
- **Keywords (100 char, comma-separated, no spaces):**
  `tire,mobile mechanic,roadside,invoice,scheduling,small business,auto repair,quote,dispatch,jobs`
- **Support URL:** `https://app.mobileserviceos.app` (must resolve; add a contact email on it)
- **Marketing URL (optional):** `https://app.mobileserviceos.app`
- **Privacy Policy URL:** `https://app.mobileserviceos.app/privacy`
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

## 5. Demo account for App Review

Apple reviewers must be able to use the app without setup. Provide in App Store
Connect → App Review Information:
- A **pre-seeded demo login** (email + password) that lands in a populated dashboard
  (jobs, inventory, an invoice) so reviewers don't see empty states.
- Confirm **self-serve signup works** (it must — see the signup-flow review) in case
  the reviewer creates their own account.
- Notes: "Sign in with the demo account, or create a new one — onboarding sets up a
  business in under a minute. No special hardware required."

---

## 6. Pre-submission checklist
- [ ] Native wrapper build (Capacitor/WKWebView) producing a signed `.ipa`.
- [ ] `/privacy` resolves publicly (no login) — submitted as the Privacy URL.
- [ ] Support URL resolves and shows a contact email.
- [ ] 6.9" screenshots (5–6) uploaded; icon 1024².
- [ ] App Privacy answers match `/privacy`.
- [ ] Demo account seeded + credentials in Review notes.
- [ ] New-user, existing-user, and empty-data states all verified.
