# Stripe Per-Business Customer Rework — Design Spec

**Status:** Approved · 2026-05-27
**Author:** brainstorm session 2026-05-27
**Implements:** Audit finding "Stripe customer keyed per-user, not per-business"

## Problem

Stripe customers are currently keyed per Firebase Auth uid (`customers/{uid}` via the Firebase Stripe Extension). The business is the actual paying entity. When a business owner adds a second admin who also clicks Subscribe, the admin creates a parallel Stripe customer + subscription. Both write to `settings/main.subscriptionStatus` via the client-side `attachStripeSync` mirror, overwriting each other in racey order.

Bug pattern:

1. Owner subscribes → owner has Stripe customer + subscription. `attachStripeSync(owner.uid)` mirrors `active/pro` to `settings/main`.
2. Owner adds Admin A. Admin A has no Stripe customer.
3. Admin A clicks Subscribe (no role gate today) → creates parallel customer + subscription via Stripe Extension. `attachStripeSync(admin.uid)` mirrors `trialing/pro` to the SAME `settings/main`, overwriting the owner's `active`.
4. The business now has TWO active subscriptions in Stripe. The business owner's plan disappears from the app UI because the admin's newer trial state takes precedence.

There is also a secondary staleness bug: `attachStripeSync` runs only for the currently logged-in user. If an admin opens the app for a business where the owner hasn't signed in for a week, the admin sees whatever the owner last mirrored — even if Stripe has since canceled or downgraded the subscription.

## Decision summary

Four decisions, locked during the brainstorm:

| Decision | Value | Rationale |
|---|---|---|
| Who can subscribe | **Owner only.** Admins read; cannot subscribe. | Matches B2B norm. Simplest. |
| Migration of existing per-user subscribers | **Greenfield.** No script. | Founder Access is free today → effectively zero per-user paying subscribers to migrate. |
| Ownership transfer | **Out of scope.** Future feature. | Today there's no transfer flow at all; rework establishes the rule, transfer is its own future spec. |
| Architectural shape | **Server-side subscription mirror.** Cloud Function → `settings/main`. Client `attachStripeSync` deleted. | Eliminates "admin sees stale status" bug. Net code reduction. Status driven by Stripe webhook events, not by which user happens to be logged in. |

## Architecture

**Single rule:** the business owner's Firebase Auth uid is the **billing principal** for that business. Exactly one Stripe customer + one subscription per business, anchored to the owner's uid. The Firebase Stripe Extension keeps its existing per-Firebase-user data shape (no fork, no replacement).

**Data flow:**

```
Owner clicks Subscribe
  → Client writes customers/{ownerUid}/checkout_sessions/{id} with
     metadata.businessId = <current bid>
  → Stripe Firebase Extension processes → opens Stripe Checkout
  → On payment, Stripe webhook fires
  → Extension writes customers/{ownerUid}/subscriptions/{subId}
       with metadata.businessId inherited from checkout session
  → NEW: onOwnerSubscriptionChange Cloud Function
       (Firestore trigger on customers/{*}/subscriptions/{*})
       reads metadata.businessId, writes status to
       businesses/{bid}/settings/main
  → All members of the business read settings/main; status is fresh
     for everyone regardless of who's logged in
  → Client never touches Stripe data directly.
     attachStripeSync is deleted.
```

**SubscribeButton is role-gated** — `if (role !== 'owner') return null;` at the top. Non-owners see a small contextual hint in SubscriptionSection: "Only the business owner can change the subscription plan."

## Data model

### Subscription metadata is the routing key

```
customers/{ownerUid}/subscriptions/{subId}
{
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | ...,
  current_period_end: <ts>,
  items: [...],
  metadata: {
    businessId: "biz_abc123",     // ← NEW: source of truth for routing
    firebaseUID: "ownerUid"       // ← extension already sets this
  },
  ...
}
```

**Why metadata, not "find the business where ownerUid is owner":** an owner can run **two businesses simultaneously** via the business switcher. A uid-based lookup would find both and not know which subscription belongs where. Metadata makes the routing explicit and unambiguous: one subscription = one business.

This also future-proofs ownership transfer: if a Cloud Function ever transfers a subscription's ownership, we update `metadata.businessId` rather than moving Stripe customers around.

### Trigger lookup logic

```js
// functions/src/onOwnerSubscriptionChange.ts (NEW)
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const onOwnerSubscriptionChange = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('customers/{ownerUid}/subscriptions/{subId}')
  .onWrite(async (change, context) => {
    const sub = change.after.exists ? change.after.data() : null;
    if (!sub) return;
    const subId = context.params.subId as string;
    const bid = (sub.metadata && sub.metadata.businessId) as string | undefined;
    if (!bid) {
      // Defensive: subscription with no businessId metadata. Could be
      // a legacy sub from before this rework. Log it for manual
      // review; do not mirror. Greenfield migration means this should
      // never fire in practice.
      console.warn('[onOwnerSubscriptionChange] missing businessId metadata', {
        subId, customerId: sub.customer,
      });
      return;
    }
    const customerId = typeof sub.customer === 'string'
      ? sub.customer
      : (sub.customer && sub.customer.id) || null;
    const db = admin.firestore();
    const settingsRef = db
      .collection('businesses').doc(bid)
      .collection('settings').doc('main');

    // Read settings to honor billingExempt — never overwrite an
    // exempt account with Stripe state.
    const settingsSnap = await settingsRef.get();
    if (settingsSnap.data()?.billingExempt === true) {
      console.info('[onOwnerSubscriptionChange] skipping exempt business', { bid });
      return;
    }

    const status = mapStripeStatus(sub.status);
    const plan = extractPlan(sub);  // 'core' | 'pro' | undefined
    const trialEnd = sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null;

    const payload: Record<string, unknown> = {
      subscriptionStatus: status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subId,
    };
    if (plan) payload.plan = plan;
    if (trialEnd) payload.trialEndsAt = trialEnd;

    await settingsRef.set(payload, { merge: true });
  });
```

### Coexistence with existing functions

- **`onSubscriptionWrite` (existing)** — handles referral rewards. Keep it. It triggers on the same path but does different work (referral lifecycle, fraud check, reward application). Two triggers on the same path is fine — Firestore fans out cleanly.
- **`stripeWebhook` (orphan, source-only)** — already gated off (export removed in commit `aa9eaf3`). This rework does NOT change the orphan's status; it stays as documented migration-fallback source.

## Client-side changes

### SubscribeButton role gate

`src/components/SubscribeButton.tsx` — add `useMembership` import and gate at the top of the component, before the existing `isBillingExempt` check:

```tsx
import { useMembership } from '@/context/MembershipContext';

export function SubscribeButton({ settings, plan }: Props) {
  const { role } = useMembership();
  // Only the business owner is the billing principal. Admins and
  // techs see subscription state but can't change it.
  if (role !== 'owner') return null;
  // existing isBillingExempt + price-id checks unchanged below
```

### Checkout-session metadata

Same file — the checkout-session document written to `customers/{uid}/checkout_sessions/{id}` must include the businessId metadata:

```ts
const sessionDoc = {
  price: priceId,
  mode: 'subscription',
  success_url: successUrl,
  cancel_url: cancelUrl,
  trial_period_days: 14,
  allow_promotion_codes: true,
  // NEW: pin this subscription to the business the owner is currently
  // viewing. Stripe propagates checkout metadata onto the resulting
  // subscription, where onOwnerSubscriptionChange reads it to route
  // the status update to the right business.
  metadata: { businessId: brand.businessId },
  subscription_data: {
    metadata: { businessId: brand.businessId },
  },
};
```

Both `metadata` and `subscription_data.metadata` are set — belt-and-suspenders since Stripe sometimes propagates one and not the other depending on which event fires.

### SubscriptionSection.tsx contextual hint

Where SubscribeButton used to render for non-owners (it now returns null), add a small text:

```tsx
{role !== 'owner' && (
  <div style={{
    fontSize: 12, color: 'var(--t3)',
    padding: '8px 12px', textAlign: 'center',
  }}>
    Only the business owner can change the subscription plan.
  </div>
)}
```

### Delete `src/lib/stripeSync.ts`

Once Phase 1 of the rollout verifies the server trigger works, the entire `stripeSync.ts` file becomes dead code. Delete the file. Remove the import + call from `src/App.tsx:657` (`attachStripeSync(user.uid, businessId)`). Net code reduction: ~280 lines deleted.

## Files

| File | Action | Purpose |
|---|---|---|
| `functions/src/onOwnerSubscriptionChange.ts` | Create | New Cloud Function trigger; server-side subscription mirror |
| `functions/src/index.ts` | Modify | Export the new function |
| `functions/src/stripeSync-helpers.ts` (or co-located) | Create | Shared `mapStripeStatus`, `extractPlan` helpers — currently in `src/lib/stripeSync.ts`; need server-side copies since `functions/` can't import from `src/` |
| `tests/onOwnerSubscriptionChange.test.ts` | Create | Pure-logic tests for `mapStripeStatus`, `extractPlan`, metadata-missing branch |
| `src/components/SubscribeButton.tsx` | Modify | Add `useMembership` role gate + metadata.businessId on checkout-session doc |
| `src/components/settings/SubscriptionSection.tsx` | Modify | Add contextual hint for non-owners |
| `src/lib/stripeSync.ts` | Delete (Phase 3) | Client mirror is replaced by server trigger |
| `src/App.tsx` | Modify (Phase 3) | Remove the `attachStripeSync` import + call |

## Defensive rollout

Three phases, each verifiable independently before proceeding.

### Phase 1: Ship the server trigger (additive)

Deploy `onOwnerSubscriptionChange` to production. Add `metadata.businessId` to new checkout sessions. **Do NOT delete `attachStripeSync` yet.** Both mirrors run in parallel.

- **Verification:** owner subscribes via Stripe test mode. Confirm both the client-side mirror AND the server-side trigger write the same status to `settings/main`. They agree.
- **Rollback:** revert the deploy. Trigger goes away; nothing user-visible changes.

### Phase 2: Role-gate SubscribeButton

Ship the `if (role !== 'owner') return null;` gate + the contextual hint for admins.

- **Verification:** sign in as an admin to a business with an owner-subscribed plan. Settings page shows current status + "Only the business owner can change..." message. No Subscribe button visible.
- **Rollback:** revert the single commit. Admins can subscribe again (pre-rework behavior).

### Phase 3: Delete `attachStripeSync` (commits the architecture switch)

Once Phase 1 has verified the server trigger correctly mirrors for at least one real subscription, delete the client mirror.

- **Verification:** subscribe as a NEW owner (Stripe test mode). Confirm status reaches `settings/main` within ~2 seconds of payment. Sign in as an admin in that business; confirm status is visible.
- **Rollback:** restore `stripeSync.ts` and the `App.tsx` import. The server trigger continues running; the restored client mirror creates a dual-write but doesn't break anything since both write the same fields.

## Testing

### Pure-logic tests

`tests/onOwnerSubscriptionChange.test.ts` — hand-rolled `tsx check()` runner, mirrors `tests/aiInventoryInsights.test.ts` pattern:

1. `mapStripeStatus('active') === 'active'` (all 8 Stripe status values map correctly)
2. `extractPlan(subWithCorePrice)` returns `'core'`
3. `extractPlan(subWithProPrice)` returns `'pro'`
4. `extractPlan(subWithUnknownPrice)` returns `undefined`
5. Missing-metadata branch: the trigger logs + skips (cannot fully test in unit; covered by manual integration)

### Manual integration tests (Stripe test mode required)

1. Owner subscribes from Settings → status reaches `settings/main` within 2s
2. Owner cancels → status flips to `canceled` within 2s
3. Card fails (Stripe test card `4000000000000341` after sub) → status flips to `past_due`
4. Owner of TWO businesses subscribes to each → each subscription routes to its own business; no cross-write
5. Admin signs in to a business where owner is subscribed → sees current status; no Subscribe button; cannot trigger checkout via direct URL manipulation
6. Owner of business A who is also admin in business B — each business shows its own subscription state, no cross-contamination

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Server trigger fails silently → status diverges | High | Phase 1 dual-write verifies correctness before relying on server. Console.warn on missing metadata; could escalate to errorMonitor.captureMessage in implementation. |
| metadata.businessId not propagated by Stripe in some event types | Medium | Set both `metadata` AND `subscription_data.metadata` on checkout. Trigger logs + skips on missing field rather than guessing. |
| Owner-of-two-businesses race | Medium | metadata.businessId scopes each subscription explicitly; no lookup-by-uid ambiguity. |
| Pre-rework `customers/{uid}/subscriptions` docs lack metadata | Low | Greenfield assumption (no paying customers today). If any sneak through, trigger logs + skips; client mirror handles them via Phase 1+2 transition window. |
| Ownership transfer happens mid-rollout | Low | Out of scope; flag any transfer requests for manual Stripe-dashboard handling until the future spec ships. |
| billingExempt account gets stomped by Stripe state | Low | Trigger reads `settings.billingExempt` and returns early if true. |

## Out of scope

- Ownership transfer flow (separate future spec)
- Migration of any pre-rework subscribers (greenfield)
- Stripe customer consolidation (an owner with two old per-user customers keeps both)
- Per-business billing reporting / invoicing UI
- Founder Access changes (this rework matters when paid plans begin)
- Touching the existing `onSubscriptionWrite` (referral rewards) — coexists fine

## Success criteria

1. Owner of a business clicks Subscribe → subscription appears in Stripe with `metadata.businessId` set
2. Within ~2s of payment, `businesses/{bid}/settings/main.subscriptionStatus = 'active'` (or 'trialing')
3. An admin signing in to that business sees the current status without delay, with no Subscribe button
4. An owner with two businesses can subscribe to each separately; each business shows its own state
5. `src/lib/stripeSync.ts` no longer exists after Phase 3; client code is ~280 lines lighter
6. No regressions to `onSubscriptionWrite` (referral rewards still fire correctly)

## Estimated effort

- Phase 1 (server trigger + metadata): ~4 hours
- Phase 2 (role gate): ~1 hour
- Phase 3 (client deletion + verify): ~1 hour
- Total: ~6 hours of focused work + ~2 hours for Stripe test-mode integration verification

The longest part is **NOT writing code** — it's the careful manual verification across all the Stripe lifecycle states (active, trialing, past_due, canceled) in test mode. Don't skip that.
