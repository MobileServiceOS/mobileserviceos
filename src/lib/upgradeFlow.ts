// src/lib/upgradeFlow.ts
// ─────────────────────────────────────────────────────────────────────
//  Single entry point for "take me to the upgrade flow", so any gated
//  surface (LockedFeature, banners) can trigger it without threading a
//  callback through props. Sets the session flag the SubscriptionAccordion
//  watches (auto-expands) and fires an event App.tsx listens for to switch
//  to the Settings tab. The actual purchase happens via SubscribeButton →
//  web Stripe Checkout (NOT native IAP).
// ─────────────────────────────────────────────────────────────────────

import { track } from '@/lib/analytics';

export const OPEN_UPGRADE_EVENT = 'msos:open-upgrade';
const OPEN_SUBSCRIPTION_FLAG = 'msos_open_subscription';

/** Route the user to the subscription/upgrade surface (web checkout). */
export function triggerUpgrade(): void {
  if (typeof window === 'undefined') return;
  track('upgrade_cta_clicked');
  try {
    sessionStorage.setItem(OPEN_SUBSCRIPTION_FLAG, '1');
  } catch {
    /* sessionStorage unavailable — the event still navigates to Settings */
  }
  window.dispatchEvent(new CustomEvent(OPEN_UPGRADE_EVENT));
}
