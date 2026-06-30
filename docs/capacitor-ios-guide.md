# MSOS — Capacitor iOS Wrap → App Store

The repo is now Capacitor-ready. This guide covers the few commands to run **on
your Mac** (where Xcode + CocoaPods live) and the exact Xcode steps to build,
run on device, and ship to TestFlight.

## What's already set up (in this repo)
- **Packages:** `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`, plus
  `@capacitor/push-notifications`, `@capacitor/splash-screen`, `@capacitor/status-bar`.
- **`capacitor.config.ts`** — `appId: app.mobileserviceos`, `appName: Mobile
  Service OS`, `webDir: dist`. Splash = MSOS navy `#16263F`. `server.url` →
  `https://app.mobileserviceos.app` is **gated behind `CAP_LIVE_RELOAD=1`** (dev
  live-reload only; production ships the bundled `dist/`).
- **`src/lib/native.ts`** — status bar (theme-matched), splash dismissal, and
  the push-permission request. Every call is a **no-op on the web PWA**, so the
  existing site is untouched.
- **Push permission fires after onboarding completes** (in
  `handleOnboardingComplete`), never on cold first launch, and is denial-safe.
- **Service worker is disabled in the native shell** (`src/main.tsx`) so it
  can't fight the WebView.
- **npm scripts:** `cap:sync` (`build` + `cap sync ios`), `cap:open`, `ios`
  (build + sync + open).

> The `ios/` native project is **not** committed — it's generated per-machine
> with `npx cap add ios` (needs CocoaPods). Do that on your Mac (next section).
> Note: this CLI environment has Xcode but **no CocoaPods**, so the `ios/`
> folder and the Xcode build can't be produced/verified here — they're your
> one-time local steps below.

## One-time setup on your Mac
```bash
# 1. CocoaPods (Capacitor iOS needs it for plugin pods)
brew install cocoapods            # or: sudo gem install cocoapods

# 2. Generate the native iOS project (creates ios/)
npx cap add ios

# 3. Build the web app and copy it into the iOS project
npm run cap:sync                  # = npm run build && npx cap sync ios

# 4. Open in Xcode
npm run cap:open                  # opens ios/App/App.xcworkspace
```
After any web change, re-run `npm run cap:sync` to push the new build into iOS.

**Live reload while developing (optional):**
```bash
CAP_LIVE_RELOAD=1 npx cap sync ios   # native shell loads the live site
```
Re-run `npm run cap:sync` (without the flag) before archiving so the **store
build ships the bundled `dist/`**, not a remote URL.

## Xcode steps

### Open the project
`npm run cap:open` (or open `ios/App/App.xcworkspace` — the **.xcworkspace**, not
`.xcodeproj`).

### Set the Bundle Identifier
Project navigator → **App** target → **Signing & Capabilities** → set **Bundle
Identifier** to `app.mobileserviceos`. (This must match the App ID you register
in the Apple Developer portal / App Store Connect.)

### Select your development team
Same **Signing & Capabilities** tab → check **Automatically manage signing** →
**Team** dropdown → pick your Apple Developer team. If it's not listed: **Xcode →
Settings → Accounts → +** and sign in with your Apple Developer account, then
reselect the team.

### Add the Push Notifications capability
**Signing & Capabilities → + Capability → Push Notifications**. (This adds the
APNs entitlement that the permission request needs. The JS already requests
permission after onboarding.) For background delivery later, also add
**Background Modes → Remote notifications**.

### Build & run on a device
Connect your iPhone (Trust the Mac if prompted) → select it as the run
destination (top toolbar) → press **⌘R**. First run on a device: open
**Settings → General → VPN & Device Management** on the iPhone and trust your
developer certificate.

### Archive & upload to TestFlight
1. Set the run destination to **Any iOS Device (arm64)**.
2. **Product → Archive** (waits for a release build).
3. In the **Organizer** window → select the archive → **Distribute App** →
   **App Store Connect → Upload** → keep defaults → **Upload**.
4. In **App Store Connect → your app → TestFlight**, the build appears after
   processing (a few minutes). Add internal testers / submit for beta review.

### App icon
- **1024 × 1024 px PNG, RGB, NO transparency/alpha, NO rounded corners** (Apple
  applies the mask). Use the MSOS gold "MS" mark on the navy background.
- In Xcode: **App/Assets.xcassets → AppIcon**, drag the 1024 image into the
  single "App Store" slot (Xcode 14+ accepts one size and downsizes the rest).
- Splash background is already set to MSOS navy; to use a custom splash image,
  add it to `ios/App/App/Assets.xcassets/Splash`.

## App Store Connect — listing copy (paste-ready)

**App Name:** Mobile Service OS

**Subtitle:** Run Your Mobile Tire Business

**Description** (159 words):
> Mobile Service OS is the all-in-one app for mobile tire and roadside operators
> who run their business from the truck, not a desk.
>
> Log every job in seconds — service, vehicle, tire size, price — right at the
> roadside. Returning customer? Their details auto-fill from the phone number.
>
> Send clean, branded invoices and estimates by text before you pull away, and
> record how you got paid. Your customer list builds itself from the jobs you
> log, so you always know who you've served and what they drive.
>
> Schedule jobs ahead, see today's appointments the moment you open the app, and
> advance each one from En Route to Complete with a tap.
>
> The Insights dashboard shows real numbers — today's revenue and profit, profit
> by month, top services, best-selling tire sizes, and unpaid invoices — live
> from your work.
>
> Built for the field. Fast, mobile-first, and ready when you are.

**Keywords** (comma-separated):
```
mobile tire repair,roadside assistance,tire shop,job tracker,mobile mechanic software,field service app,invoice app,small business,tire business
```

**Privacy Policy URL:** `https://app.mobileserviceos.app/privacy`
**Support URL:** `https://app.mobileserviceos.app`

## Notes / follow-ups
- **Sending** push (not just permission) needs an APNs Auth Key uploaded in App
  Store Connect + a sender (e.g. a Cloud Function). The wrap satisfies the
  native-capability requirement; wiring real notifications is a later step.
- Screenshot sizes + full listing metadata: see `docs/app-store-submission.md`.
