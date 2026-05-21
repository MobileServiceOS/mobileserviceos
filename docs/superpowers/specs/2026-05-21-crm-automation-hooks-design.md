# Phase 2.2 / Sub-Project D — CRM Automation Hooks Design Spec

**Status:** Approved for implementation planning (2026-05-21)

**Owning phase:** Phase 2.2 mechanic full-slice — Sub-Project D (CRM Automation Hooks). Final sub-project of Phase 2.2.

**Predecessor sub-projects:**
- A. Mechanic Operations — `phase-2.2-mechanic-ops-stable`
- B. Multi-User Foundation — `phase-2.2-multi-user-stable` (firestore.rules deploy pending)
- C. Dispatch + Lifecycle UI — `phase-2.2-dispatch-stable`
- Job-lifecycle foundation — declared `StageNotificationSpec` on each universal stage with `audience` / `channel` / `templateId` / `fireMode`

**Successor sub-projects:** none in Phase 2.2. Phase 2.3 (Detailing Operations) is the next phase after this lands.

---

## 1. Goal

Consume the `transitions[]` writes from Sub-Project C and fire the right notifications declared on each stage's `StageNotificationSpec`. In-app notifications (owner / tech audience) dispatch fully automatically; customer-audience notifications (SMS / email) surface as tap-to-send affordances that open the OS's SMS or email app with the template pre-rendered.

**Out of scope this sub-project:** fully automated outbound (would require Blaze + Cloud Functions + Twilio); push notifications to other devices; customer-facing status page; in-app chat; campaign / drip sequences; SMS-receipt webhooks; analytics on notification engagement.

## 2. Hard constraints

- No backend (no Cloud Functions, no Blaze upgrade)
- No new third-party dependencies (no Twilio, no SendGrid, no FCM)
- Customer-facing outbound is tap-to-send (operator approves each message) — fully automated is deferred
- Tire / mechanic / detailing workflows byte-identical when the operator never opens the bell or taps a Send prompt
- Additive schema: one new collection (`notifications/`), no Job changes
- `firestore.rules` change is additive (existing reads/writes pass) — pause before push (same pattern as Sub-Project B)
- Mobile-first; bell + panel work on phone-width viewports
- Every commit independently revertible

## 3. Architecture

Four pieces, all client-side:

1. **Template registry** — static config at `src/config/notifications/templates.ts`. One `NotificationTemplate` entry per `templateId` referenced in the universal-stages `StageNotificationSpec` declarations. Each template declares channel, optional subject (email), body string with `{var}` placeholders.

2. **`dispatchNotifications()` helper** — pure function in `src/lib/notificationDispatch.ts`. Takes the just-appended transition + ResolvedLifecycle + a context (job, business brand, owner uids, assigned tech uid) and returns `{ inAppDocs, pendingActions }` — both arrays of `NotificationDoc`. The transition-write batch picks up `inAppDocs` and writes them alongside the job; `pendingActions` get written too (they sit in the collection awaiting tap) and the first is surfaced as a toast.

3. **`notifications/` collection** — small docs per notification. Members of the business read; rules-gated writes match Sub-Project B's pattern.

4. **In-app surfaces** — `NotificationsBell` in the header (icon + unread count badge), `NotificationsPanel` bottom sheet (list newest-first, mark-as-read, [Send] for pendingActions), inline pending-action buttons on `JobDetailModal`.

The dispatcher runs from `handleStageTransition` in `App.tsx` (the callback already added in Sub-Project C). One Firestore `writeBatch` writes the job + all notification docs atomically.

## 4. Schema

### 4.1 `NotificationDoc`

```ts
export interface NotificationDoc {
  id: string;
  createdAt: string;             // ISO timestamp
  jobId: string;                 // origin job — for navigate-to-job from bell
  audience: 'customer' | 'technician' | 'owner';
  channel: 'sms' | 'email' | 'in_app' | 'push';
  templateId: string;            // resolves to NOTIFICATION_TEMPLATES[id]
  // Audience-specific fields (one of these populated):
  toUid?: string;                // technician audience
  toPhone?: string;              // customer SMS
  toEmail?: string;              // customer email
  // Rendered:
  subject?: string;              // email only
  body: string;
  // Lifecycle:
  readAt?: string;               // in-app: read receipt
  dismissedAt?: string;          // in-app: cleared by user
  sentAt?: string;               // tap-to-send: stamped when operator taps Send
  // Origin context:
  byUid: string;                 // who triggered the transition that fired this
  toStage: string;               // for debugging / future analytics
}
```

**One additive Job field** for the email path:

```ts
// src/types/index.ts — Job interface
customerEmail?: string;   // optional; populated by operator when needed for invoice send
```

Existing job docs without `customerEmail` are unaffected. The dispatcher leaves `toEmail` undefined when `job.customerEmail` is empty; the UI renders the [Send] button **disabled** with tooltip "No email on file — edit job to add". Operator can edit the job and add the email; subsequent transitions render it.

No Settings changes.

### 4.2 New collection

`businesses/{businessId}/notifications/{notifId}` — flat collection, no subcollections.

## 5. Template registry

`src/config/notifications/templates.ts`:

```ts
export interface NotificationTemplate {
  id: string;
  channel: 'sms' | 'email' | 'in_app';
  subject?: string;          // email only; supports {vars}
  body: string;              // supports {vars}
  description?: string;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  tech_assigned: {
    id: 'tech_assigned',
    channel: 'in_app',
    body: '{tech.name} assigned to job #{job.shortId} for {customer.name}',
  },
  tech_on_the_way: {
    id: 'tech_on_the_way',
    channel: 'sms',
    body: "Hi {customer.firstName}, this is {business.name}. I'm on my way for your {job.service}. Reply STOP to opt out.",
  },
  tech_arrived: {
    id: 'tech_arrived',
    channel: 'sms',
    body: 'Hi {customer.firstName}, I just arrived for your {job.service}. - {business.name}',
  },
  job_done: {
    id: 'job_done',
    channel: 'in_app',
    body: '{tech.name} completed job #{job.shortId} ({customer.name})',
  },
  invoice_sent: {
    id: 'invoice_sent',
    channel: 'email',
    subject: 'Invoice for your {job.service} - {business.name}',
    body: 'Hi {customer.firstName},\n\nThank you for choosing {business.name}. Your invoice for {job.service} totaling {job.totalFormatted} is attached.\n\nPayment options: {business.paymentMethods}\n\nQuestions? Reply to this email or call {business.phone}.\n\n- {business.name}',
  },
  thank_you_review_request: {
    id: 'thank_you_review_request',
    channel: 'sms',
    body: 'Thank you for choosing {business.name}, {customer.firstName}! If we earned 5 stars, a quick review would mean the world: {business.reviewUrl}',
  },
  payment_received: {
    id: 'payment_received',
    channel: 'in_app',
    body: 'Payment received: {job.totalFormatted} from {customer.name} (job #{job.shortId})',
  },
};
```

These exactly match the `templateId` strings declared in `src/config/jobs/universal-stages.ts`. Missing-template lookup logs a `console.warn` and skips that notification (defensive — never crashes the transition write).

## 6. Variable substitution

Pure helpers in `src/lib/notificationTemplates.ts`:

```ts
export interface TemplateVars {
  customer: { firstName: string; name: string; phone: string; email?: string };
  business: { name: string; phone: string; email: string; reviewUrl: string; paymentMethods: string };
  job:      { shortId: string; service: string; totalFormatted: string };
  tech:     { name: string };
}

export function renderTemplate(
  template: NotificationTemplate,
  vars: TemplateVars,
): { subject?: string; body: string };

export function buildTemplateVars(
  job: Job,
  brand: Brand,
  settings: Settings,
  techName: string,
): TemplateVars;
```

Derivation rules:
- `customer.firstName` = first whitespace-separated word of `customer.name`, falling back to "there" when empty
- `job.shortId` = last 6 chars of `job.id` (consistent with how `shortId` is used elsewhere if applicable; otherwise just the last 6)
- `job.totalFormatted` = `money(job.revenue)` from existing utils
- `business.paymentMethods` = comma-joined list from `settings.acceptedPaymentMethods` (or hardcoded "Cash, Zelle, Card" fallback)
- `tech.name` = resolved member displayName/email/uid, or "your technician" fallback

Unknown variables (e.g. `{job.foo}` when foo isn't in TemplateVars) render as the literal `{job.foo}` and emit a dev-only console warning. Production stays silent — fail-safe.

## 7. `dispatchNotifications()` helper

```ts
export interface DispatchContext {
  transition: LifecycleTransition;        // the entry just appended
  job: Job;
  prior_transitions: ReadonlyArray<LifecycleTransition>;  // before this entry
  resolved: ResolvedLifecycle;
  vars: TemplateVars;
  businessId: string;
  byUid: string;
  ownerUids: ReadonlyArray<string>;       // owner audience targets
  assignedToUid?: string;                 // technician audience target
}

export function dispatchNotifications(ctx: DispatchContext): {
  inAppDocs: NotificationDoc[];
  pendingActions: NotificationDoc[];
};
```

Logic:
1. Resolve stage spec: `ctx.resolved.stageById.get(ctx.transition.toStage)`. If undefined → return empty.
2. For each `StageNotificationSpec` on `stage.notifications ?? []`:
   - **fireMode check**: if `spec.fireMode === 'first_entry'` and `priorTransitions.some(t => t.toStage === currentStage)` → skip.
   - **template lookup**: `NOTIFICATION_TEMPLATES[spec.templateId]`. Missing → console.warn + skip.
   - **render**: `renderTemplate(template, ctx.vars)`.
   - **construct NotificationDoc**:
     - id: `uid()`
     - createdAt: ISO now
     - jobId, audience, channel, templateId from spec
     - byUid + toStage from ctx
     - audience-target fields (`toUid` for technician, `toPhone`/`toEmail` for customer)
     - subject + body from render
   - **Sort by channel**:
     - `in_app` → `inAppDocs`
     - `sms` or `email` (only customer audience triggers these per the universal stages) → `pendingActions`

Pure function. No Firestore writes. The caller batches.

## 8. `handleStageTransition` integration

Extends the Sub-Project C handler in `App.tsx`:

```ts
const handleStageTransition = useCallback(async (job, toStage, toSubstage) => {
  // ...existing transitionJobStage call...
  const next = transitionJobStage({ ... });

  // NEW: dispatch notifications
  const lastTransition = next.transitions![next.transitions!.length - 1];
  const vars = buildTemplateVars(next, brand, settings, techNameFor(next.assignedToUid));
  const dispatch = dispatchNotifications({
    transition: lastTransition,
    job: next,
    prior_transitions: job.transitions ?? [],
    resolved: resolvedLifecycle,
    vars,
    businessId,
    byUid: _auth?.currentUser?.uid || '',
    ownerUids: ownerUidsForBusiness(),
    assignedToUid: next.assignedToUid,
  });

  // Atomic batch: job + notifications
  const batch = writeBatch(_db!);
  batch.set(doc(jobsCol, next.id), next);
  for (const n of [...dispatch.inAppDocs, ...dispatch.pendingActions]) {
    batch.set(doc(notifCol, n.id), n);
  }
  await batch.commit();

  // Surface first pendingAction as a toast with Send button
  if (dispatch.pendingActions.length > 0) {
    surfacePendingActionToast(dispatch.pendingActions[0]);
  }

  setDetailJob(next);
  addToast(`Stage → ${stageLabel}`, 'success');
}, [businessId, settings, brand, ownerUidsForBusiness, techNameFor]);
```

The `writeBatch` import comes from `firebase/firestore`. The existing `fbSetFast` path is replaced for stage transitions with a batched write so notification docs land atomically with the job write — no partial state.

## 9. In-app surfaces

### 9.1 `NotificationsBell`

Lives in the header next to the BusinessSwitcher. Bell icon (🔔) with a numeric badge for unread count. Read via `useUnreadNotificationsCount()` hook (which composes `useNotifications()` + `visibleNotifications()` filter). Badge hidden when count === 0. Tap → opens `NotificationsPanel`.

### 9.2 `NotificationsPanel`

Bottom-sheet (same idiom as `MoreSheet.tsx`). Header: "Notifications" + "Mark all read" action. List newest-first. Each row:

```
┌────────────────────────────────────────────┐
│ 🔧 Job done                  3 min ago     │
│ Alice completed job #4815AB (John Doe)     │
│                                             │
│ 📱 Tech-on-the-way SMS       1 hr ago      │
│ to John (555-0123)                          │
│                              [ Send ] →    │
└────────────────────────────────────────────┘
```

- Icon by channel (📱 SMS, ✉️ email, 🔔 in-app)
- Body = rendered template
- Time-ago string
- [Send →] button for pendingActions (channel === 'sms' or 'email', sentAt undefined)
- Tap row (excluding [Send] button) → navigates to `jobId`, marks `readAt`

Empty state: "No notifications yet — they'll appear as jobs move through stages."

### 9.3 Toast on transition

When `dispatchNotifications` returns pendingActions, the first one surfaces as an action toast immediately after the transition write commits:

```
┌──────────────────────────────────────────┐
│ Stage → En route                          │
│ 📱 Send tech-on-the-way SMS to John?      │
│ [Send] [Skip]                              │
└──────────────────────────────────────────┘
```

[Send] → opens `sms:` URI; stamps `sentAt` on the notification.
[Skip] → dismisses toast; notification stays in panel for later send.

### 9.4 Inline JobDetailModal pending-actions

For the current job, any pendingActions with `sentAt === undefined` and matching `jobId` render as a vertical list of [Send X] buttons in the modal, above the existing action CTAs. Operator can re-send anytime by tapping again (we don't lock).

## 10. Tap-to-send execution

URI builders in `src/lib/openMessagingUri.ts`:

```ts
export function buildSmsUri(toPhone: string, body: string): string {
  // iOS uses sms:?&body=...; Android often accepts the same.
  // Operator phone keypad handles delivery; we open the URI via
  // window.location.href or a temporary <a href>.
  const phone = toPhone.replace(/[^0-9+]/g, '');
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

export function buildMailtoUri(toEmail: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function openMessagingUri(uri: string): void {
  // Programmatic anchor click — most reliable across mobile browsers
  // for sms:/mailto: schemes vs window.location.href which sometimes
  // gets blocked.
  const a = document.createElement('a');
  a.href = uri;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 0);
}
```

After tap, the caller optimistically stamps `sentAt` on the notification doc:

```ts
async function markSent(notif: NotificationDoc): Promise<void> {
  const ref = doc(notifCol, notif.id);
  await fbSetFast(notifCol, notif.id, { ...notif, sentAt: new Date().toISOString() });
}
```

We can't verify the operator actually hit Send in their SMS app — optimistic stamp is acceptable. Operator can re-send by tapping again; new `sentAt` overwrites.

## 11. `fireMode` semantics

```
spec.fireMode === 'every_entry'  → always fire (default)
spec.fireMode === 'first_entry'  → fire only if priorTransitions has no
                                   entry with toStage === currentStage
```

Universal-stages declarations:
- `dispatched`: `tech_assigned` — `first_entry`
- `enroute`: `tech_on_the_way` — `every_entry`
- `onsite`: `tech_arrived` — `every_entry`
- `completed`: `job_done` — `first_entry`
- `invoiced`: `invoice_sent` — `every_entry`
- `paid`: `thank_you_review_request` — `first_entry`; `payment_received` — `every_entry`

This means:
- Re-entering `enroute` (e.g. tech got pulled off then resumed) DOES re-fire the SMS.
- Re-entering `paid` (e.g. operator accidentally bounced) does NOT re-fire the thank-you SMS or duplicate the review request.
- Re-entering `completed` does NOT re-fire the owner's "job done" alert.

## 12. Permissions + firestore.rules

```
match /notifications/{notifId} {
  allow read: if isMemberOfBusiness(businessId);
  allow create: if isMemberOfBusiness(businessId);   // any member triggers
  allow update: if isMemberOfBusiness(businessId);   // mark-read, sentAt stamp
  allow delete: if isOwnerOrAdmin(businessId) ||
                   request.auth.uid == businessId;
}
```

Three rule additions. Same deploy pattern as Sub-Project B — pause before push for explicit user confirmation.

**Client-side visibility filter** (no server-side scoping per role; matches Sub-Project B's trust boundary):

```ts
export function visibleNotifications(
  notifs: ReadonlyArray<NotificationDoc>,
  role: Role | null,
  uid: string | null,
): NotificationDoc[] {
  if (role === 'owner' || role === 'admin') {
    // Owner / admin see owner + technician + customer audience
    // (they manage the business + need to send customer outbound)
    return notifs.slice();
  }
  if (role === 'technician' && uid) {
    // Tech sees notifications targeted at them OR
    // notifications attached to a job they're assigned/created
    return notifs.filter((n) =>
      (n.audience === 'technician' && n.toUid === uid) ||
      n.byUid === uid,
    );
  }
  return [];
}
```

## 13. UI changes summary

| File | Change |
|---|---|
| `src/config/notifications/templates.ts` (new) | `NOTIFICATION_TEMPLATES` registry |
| `src/lib/notificationTemplates.ts` (new) | `renderTemplate`, `buildTemplateVars` |
| `src/lib/notificationDispatch.ts` (new) | `dispatchNotifications` pure helper |
| `src/lib/openMessagingUri.ts` (new) | `buildSmsUri`, `buildMailtoUri`, `openMessagingUri` |
| `src/lib/useNotifications.ts` (new) | Subscribes to `notifications/`, exposes `notifications` + `unreadCount` + `markRead` + `markAllRead` + `markSent` |
| `src/lib/visibleNotifications.ts` (new) | Pure role-based filter |
| `src/components/NotificationsBell.tsx` (new) | Header icon + badge |
| `src/components/NotificationsPanel.tsx` (new) | Bottom-sheet list |
| `src/types/index.ts` (modify) | Add `NotificationDoc` interface |
| `src/lib/deserializers.ts` (modify) | `deserializeNotification` |
| `src/components/Header.tsx` (modify) | Mount `NotificationsBell` |
| `src/components/JobDetailModal.tsx` (modify) | Inline pending-action buttons |
| `src/App.tsx` (modify) | Extend `handleStageTransition` with dispatcher + writeBatch |
| `firestore.rules` (modify) | Add `notifications/` block |

## 14. Testing

Five pure-helper test files:

| File | Coverage |
|---|---|
| `tests/renderTemplate.test.ts` | Variable substitution; missing variables render as literal `{var}`; multi-line body preserved; email subject + body both rendered; unicode handled |
| `tests/buildTemplateVars.test.ts` | shortId truncation, firstName extraction with edge cases (empty, single-word, multi-word, unicode), totalFormatted, paymentMethods stringification, tech name fallback |
| `tests/dispatchNotifications.test.ts` | Returns inAppDocs + pendingActions split correctly; fireMode 'first_entry' skips on re-entry; missing template warns + skips (doesn't crash); per-audience target fields populated; empty notifications array on stages without any |
| `tests/visibleNotifications.test.ts` | Owner sees all; admin sees all; tech sees own technician audience + own-triggered; tech with no uid sees empty; null role sees empty |
| `tests/openMessagingUri.test.ts` | `buildSmsUri` strips non-digits except `+`; encodes body; `buildMailtoUri` encodes subject + body separately; round-trip decoding |

All `npx tsx`-runnable. ~60 assertions.

## 15. Pre-tag production smoke checklist

**Owner regression:**
- [ ] All existing flows unchanged (Dashboard / History / AddJob / Inventory / Settings / stage picker)
- [ ] No console errors before any transition fires

**New surfaces (owner):**
- [ ] Bell appears in header with badge 0
- [ ] Stage transition scheduled → dispatched → bell badge increments; tap → panel shows "tech assigned" notification
- [ ] Stage transition scheduled → enroute → toast surfaces "Send tech-on-the-way SMS?"; [Send] opens SMS app prefilled with template
- [ ] Stage transition onsite → in_progress → no notification (correct — no spec)
- [ ] Stage transition in_progress → completed → bell badge increments; in-app "job done" notification
- [ ] Stage transition completed → invoiced → mailto: opens with rendered subject + body
- [ ] Stage transition invoiced → paid → toast surfaces "Send thank-you SMS?"; in-app "payment received" notification fires too
- [ ] Mark notification as read → badge count decrements; refresh page → stays read
- [ ] Mark-all-read clears all
- [ ] Tap a notification → navigates to job detail

**Technician account:**
- [ ] Tech sees only their audience notifications (not other techs' assignments)
- [ ] Pending tap-to-send actions for assigned jobs visible in panel

**fireMode:**
- [ ] Bounce enroute → onsite → enroute → second tech-on-the-way SMS fires (every_entry)
- [ ] Bounce paid → invoiced → paid → thank-you SMS does NOT re-fire (first_entry)

**Cross-cutting:**
- [ ] Bundle delta ≤ +10 kB gzipped
- [ ] firestore-rules deploy applied → unauthorized tech-account write to a stranger's notification denied (manual devtools test)

## 16. Backward compatibility

- Tire / mechanic / detailing operators who don't transition any jobs see zero behavior change (the bell appears but stays at 0).
- Existing jobs without `transitions[]`: no notifications fire (dispatcher only runs on new transitions).
- The `notifications/` collection starts empty for every account; no backfill.
- Tap-to-send notifications sit unread/unsent until operator engages; collection growth is ~one doc per transition (negligible at any realistic scale).
- Every commit independently revertible; the production app stays functional at any rollback point.

## 17. Performance

- One new Firestore listener (notifications/ scoped to current business). Each notification doc ≈ 200 bytes. 100 transitions/day = 20 KB/day = $0 on free tier.
- `dispatchNotifications` is pure + sub-millisecond.
- Bell badge count via local filter on the cached collection (no extra reads).
- `writeBatch` for the transition: 1 job doc + N notification docs in one round-trip. Faster than sequential writes; atomic.

## 18. Rollback path

Each implementation commit is revertible independently:

1. Templates + render helpers — pure, no consumers
2. Dispatcher — pure
3. URI helpers — pure
4. visibleNotifications + useNotifications + types — additive
5. NotificationsBell + NotificationsPanel — no consumer until mounted
6. Header mounts bell
7. JobDetailModal inline actions
8. handleStageTransition extends with dispatcher + writeBatch
9. firestore.rules update

Reverting step 8 stops new notification writes; existing notification docs stay (harmless). No data loss. The bell continues to read from the collection until step 6 is reverted.

## 19. Open items for the implementation plan

The `writing-plans` skill must capture:

1. **`ownerUidsForBusiness()` resolver** — extract a helper that reads `useBusinessMembers()` and returns owner + admin uids. Used by the dispatcher.
2. **`techNameFor(uid)` resolver** — uses existing `useMembersDirectory(businessId).resolveName(uid)` with a "your technician" fallback.
3. **`useUnreadNotificationsCount` hook** — composes `useNotifications()` + `visibleNotifications()` + filter for unread + (channel === 'in_app' OR sentAt === undefined).
4. **Toast-with-action UX** — `addToast` currently supports text only; extend to accept an optional `action: { label: string; onTap: () => void }` field, or use a one-off `addActionToast` variant.
5. **NotificationDoc deserializer** — mirror the Phase 2.x deserializer fix from Sub-Project B's Task 1.
6. **`firestore.rules` deploy** — pause for explicit user confirmation before pushing (same protocol as Sub-Project B Task 9).
7. **Header bell placement** — confirm BusinessSwitcher proximity is the right spot; alternative is the top-right of the page in a fixed position.
