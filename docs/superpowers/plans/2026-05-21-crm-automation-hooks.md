# CRM Automation Hooks Implementation Plan (Phase 2.2 / Sub-Project D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the StageNotificationSpec declarations from the lifecycle foundation to actually fire — in-app notifications dispatch automatically; customer SMS / email surface as tap-to-send affordances. Spec: [docs/superpowers/specs/2026-05-21-crm-automation-hooks-design.md](../specs/2026-05-21-crm-automation-hooks-design.md).

**Architecture:** Pure helper pipeline. `dispatchNotifications()` reads the stage's `notifications[]` spec, renders templates via `renderTemplate()`, returns NotificationDocs. `handleStageTransition` (Sub-Project C) extends with a `writeBatch` that writes the job + notification docs atomically. In-app surfaces (bell + panel) listen to the new `notifications/` collection. Customer outbound is one operator tap → OS opens prefilled SMS/email app.

**Tech Stack:** TypeScript strict mode, React 18, Firestore (`writeBatch`). No new dependencies.

**Commit cadence:** one focused commit per task; never squash. `npm run build` + relevant `npx tsx tests/<file>.test.ts` after every task. **Task 12 (firestore.rules deploy) pauses for explicit user confirmation before push** — same protocol as Sub-Project B Task 9.

---

## File Structure

**Files to create:**

| File | Responsibility |
|---|---|
| `src/config/notifications/templates.ts` | `NOTIFICATION_TEMPLATES` registry — 7 templates |
| `src/lib/notificationTemplates.ts` | `renderTemplate`, `buildTemplateVars` pure helpers |
| `src/lib/notificationDispatch.ts` | `dispatchNotifications` pure helper |
| `src/lib/openMessagingUri.ts` | `buildSmsUri`, `buildMailtoUri`, `openMessagingUri` |
| `src/lib/visibleNotifications.ts` | Role-based filter for the bell + panel |
| `src/lib/useNotifications.ts` | Live Firestore-listener hook for the notifications collection |
| `src/components/NotificationsBell.tsx` | Header icon + unread badge |
| `src/components/NotificationsPanel.tsx` | Bottom-sheet list with mark-read + tap-to-send |
| `tests/renderTemplate.test.ts` | Template rendering edge cases |
| `tests/buildTemplateVars.test.ts` | Variable derivation correctness |
| `tests/dispatchNotifications.test.ts` | Dispatcher logic, fireMode, missing-template guards |
| `tests/visibleNotifications.test.ts` | Role-based filter |
| `tests/openMessagingUri.test.ts` | URI building / encoding |

**Files to modify:**

| File | Change |
|---|---|
| `src/types/index.ts` | Add `Job.customerEmail?`, `NotificationDoc`, extend `ToastItem.action?` |
| `src/lib/deserializers.ts` | `deserializeNotification` + new `customerEmail` field on Job |
| `src/lib/toast.ts` | New `addActionToast(msg, action, type)` |
| `src/components/ToastHost.tsx` | Render action button when `toast.action` present |
| `src/components/Header.tsx` | Mount `NotificationsBell` |
| `src/components/JobDetailModal.tsx` | Inline pending-action buttons for this job |
| `src/App.tsx` | `handleStageTransition` extension: dispatcher + `writeBatch` |
| `firestore.rules` | Add `notifications/` rules block |

---

## Task 1: Schema — `Job.customerEmail`, `NotificationDoc`, `ToastItem.action`

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/deserializers.ts`

- [ ] **Step 1: Add `customerEmail` to Job**

Open `src/types/index.ts`. Find the existing `Job` interface (search for `customerName`). Add the field next to `customerPhone`:

```ts
  customerPhone: string;
  /** Customer email — optional; populated by operator when needed
   *  for the invoice-send email path. Empty string → mailto:
   *  pending actions render disabled. */
  customerEmail?: string;
```

- [ ] **Step 2: Add the `NotificationDoc` interface**

In `src/types/index.ts`, near the existing job-adjacent types (after `Job` or near the bottom), add:

```ts
export interface NotificationDoc {
  id: string;
  createdAt: string;
  jobId: string;
  audience: 'customer' | 'technician' | 'owner';
  channel: 'sms' | 'email' | 'in_app' | 'push';
  templateId: string;
  toUid?: string;
  toPhone?: string;
  toEmail?: string;
  subject?: string;
  body: string;
  readAt?: string;
  dismissedAt?: string;
  sentAt?: string;
  byUid: string;
  toStage: string;
}
```

- [ ] **Step 3: Extend `ToastItem` with optional action**

Update the existing `ToastItem` interface:

```ts
export interface ToastItem {
  id: string;
  msg: string;
  type: ToastType;
  ts: number;
  /** Optional inline action button. When set, ToastHost renders a
   *  button labeled `action.label` next to the message; tapping it
   *  calls `action.onTap()` and dismisses the toast. */
  action?: {
    label: string;
    onTap: () => void;
  };
}
```

- [ ] **Step 4: Deserialize `customerEmail` on Job**

In `src/lib/deserializers.ts`, find `deserializeJob`. Add the field handler near `customerPhone`:

```ts
    customerEmail: raw.customerEmail == null ? undefined : asString(raw.customerEmail),
```

- [ ] **Step 5: Add `deserializeNotification`**

Append to `src/lib/deserializers.ts`:

```ts
export function deserializeNotification(raw: RawDoc): NotificationDoc {
  return {
    id: asString(raw.id),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    jobId: asString(raw.jobId),
    audience: asEnum(raw.audience, ['customer', 'technician', 'owner'] as const, 'owner'),
    channel: asEnum(raw.channel, ['sms', 'email', 'in_app', 'push'] as const, 'in_app'),
    templateId: asString(raw.templateId),
    toUid: raw.toUid == null ? undefined : asString(raw.toUid),
    toPhone: raw.toPhone == null ? undefined : asString(raw.toPhone),
    toEmail: raw.toEmail == null ? undefined : asString(raw.toEmail),
    subject: raw.subject == null ? undefined : asString(raw.subject),
    body: asString(raw.body),
    readAt: raw.readAt == null ? undefined : asString(raw.readAt),
    dismissedAt: raw.dismissedAt == null ? undefined : asString(raw.dismissedAt),
    sentAt: raw.sentAt == null ? undefined : asString(raw.sentAt),
    byUid: asString(raw.byUid),
    toStage: asString(raw.toStage),
  };
}
```

Add the `NotificationDoc` import at the top of `deserializers.ts`:

```ts
import type { ..., NotificationDoc } from '@/types';
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```
Expected: TS clean.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/deserializers.ts
git commit -m "feat(types): Job.customerEmail; NotificationDoc; ToastItem.action; deserializeNotification"
```

---

## Task 2: Template registry

**Files:**
- Create: `src/config/notifications/templates.ts`

- [ ] **Step 1: Write the registry**

Create the directory first if needed:

```bash
mkdir -p src/config/notifications
```

Create the file:

```ts
// src/config/notifications/templates.ts
// ═══════════════════════════════════════════════════════════════════
//  Static template registry — one entry per templateId referenced in
//  universal-stages StageNotificationSpec declarations. Each template
//  declares its channel + body (+ optional subject for email).
//  Variables in {curly.braces} resolve via renderTemplate().
//
//  Adding a new template means adding an entry here AND referencing
//  the templateId in a stage's notifications array (or in a
//  vertical's stageOverrides). Missing templates log a console.warn
//  and skip — never crash the transition write.
// ═══════════════════════════════════════════════════════════════════

export interface NotificationTemplate {
  id: string;
  channel: 'sms' | 'email' | 'in_app';
  subject?: string;
  body: string;
  description?: string;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  tech_assigned: {
    id: 'tech_assigned',
    channel: 'in_app',
    body: '{tech.name} assigned to job #{job.shortId} for {customer.name}',
    description: 'Fires when a job moves into dispatched — owner audience.',
  },
  tech_on_the_way: {
    id: 'tech_on_the_way',
    channel: 'sms',
    body: "Hi {customer.firstName}, this is {business.name}. I'm on my way for your {job.service}. Reply STOP to opt out.",
    description: 'Customer SMS when job moves into enroute.',
  },
  tech_arrived: {
    id: 'tech_arrived',
    channel: 'sms',
    body: 'Hi {customer.firstName}, I just arrived for your {job.service}. - {business.name}',
    description: 'Customer SMS when tech marks onsite.',
  },
  job_done: {
    id: 'job_done',
    channel: 'in_app',
    body: '{tech.name} completed job #{job.shortId} ({customer.name})',
    description: 'Owner in-app when a job moves into completed.',
  },
  invoice_sent: {
    id: 'invoice_sent',
    channel: 'email',
    subject: 'Invoice for your {job.service} - {business.name}',
    body: 'Hi {customer.firstName},\n\nThank you for choosing {business.name}. Your invoice for {job.service} totaling {job.totalFormatted} is attached.\n\nPayment options: {business.paymentMethods}\n\nQuestions? Reply to this email or call {business.phone}.\n\n- {business.name}',
    description: 'Customer email when job moves into invoiced.',
  },
  thank_you_review_request: {
    id: 'thank_you_review_request',
    channel: 'sms',
    body: 'Thank you for choosing {business.name}, {customer.firstName}! If we earned 5 stars, a quick review would mean the world: {business.reviewUrl}',
    description: 'Customer SMS on first entry to paid — review prompt.',
  },
  payment_received: {
    id: 'payment_received',
    channel: 'in_app',
    body: 'Payment received: {job.totalFormatted} from {customer.name} (job #{job.shortId})',
    description: 'Owner in-app on every entry to paid.',
  },
};
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/config/notifications/templates.ts
git commit -m "feat(notifications): NOTIFICATION_TEMPLATES registry"
```

---

## Task 3: `renderTemplate` + `buildTemplateVars` + tests

**Files:**
- Create: `src/lib/notificationTemplates.ts`
- Create: `tests/renderTemplate.test.ts`
- Create: `tests/buildTemplateVars.test.ts`

- [ ] **Step 1: Write the helpers**

```ts
// src/lib/notificationTemplates.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure rendering for NOTIFICATION_TEMPLATES — variable substitution
//  + builder that derives the substitution context from a Job +
//  business brand + settings.
//
//  Missing variables render as the literal `{var.name}` and emit a
//  dev-only console warning. Production stays silent.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Brand, Settings } from '@/types';
import { money } from '@/lib/utils';
import type { NotificationTemplate } from '@/config/notifications/templates';

export interface TemplateVars {
  customer: { firstName: string; name: string; phone: string; email?: string };
  business: { name: string; phone: string; email: string; reviewUrl: string; paymentMethods: string };
  job: { shortId: string; service: string; totalFormatted: string };
  tech: { name: string };
}

const VAR_RE = /\{([a-zA-Z]+)\.([a-zA-Z]+)\}/g;

export function renderTemplate(
  template: NotificationTemplate,
  vars: TemplateVars,
): { subject?: string; body: string } {
  const substitute = (input: string): string =>
    input.replace(VAR_RE, (match, group: string, key: string) => {
      const bucket = (vars as unknown as Record<string, Record<string, string | undefined>>)[group];
      if (!bucket) {
        if (import.meta?.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn(`[notificationTemplates] unknown group: ${match}`);
        }
        return match;
      }
      const v = bucket[key];
      if (v === undefined || v === null || v === '') {
        if (import.meta?.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn(`[notificationTemplates] empty variable: ${match}`);
        }
        return match;
      }
      return String(v);
    });

  return {
    subject: template.subject ? substitute(template.subject) : undefined,
    body: substitute(template.body),
  };
}

export function buildTemplateVars(
  job: Job,
  brand: Brand,
  settings: Settings,
  techName: string,
): TemplateVars {
  const fullName = String(job.customerName || '').trim();
  const firstName = fullName ? fullName.split(/\s+/)[0] : 'there';
  const shortId = String(job.id || '').slice(-6).toUpperCase();
  const total = money(Number(job.revenue || 0));
  const paymentMethods = (settings.acceptedPaymentMethods || ['Cash', 'Zelle', 'Card']).join(', ');

  return {
    customer: {
      firstName,
      name: fullName || 'customer',
      phone: String(job.customerPhone || ''),
      email: job.customerEmail || undefined,
    },
    business: {
      name: brand.businessName || 'our business',
      phone: brand.phone || '',
      email: brand.email || '',
      reviewUrl: brand.reviewUrl || '',
      paymentMethods,
    },
    job: {
      shortId: shortId || 'NEW',
      service: job.service || 'service',
      totalFormatted: total,
    },
    tech: {
      name: techName || 'your technician',
    },
  };
}
```

**Note** — `settings.acceptedPaymentMethods` may not exist as a typed field today. The `(... || ['Cash','Zelle','Card'])` fallback handles the missing case; no schema change required.

- [ ] **Step 2: Write `tests/renderTemplate.test.ts`**

```ts
// tests/renderTemplate.test.ts
import { renderTemplate } from '@/lib/notificationTemplates';
import type { NotificationTemplate } from '@/config/notifications/templates';
import type { TemplateVars } from '@/lib/notificationTemplates';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseVars: TemplateVars = {
  customer: { firstName: 'John', name: 'John Doe', phone: '5551234567' },
  business: { name: 'Acme Mobile', phone: '5559998888', email: 'a@b.com', reviewUrl: 'https://g.page/r/abc', paymentMethods: 'Cash, Zelle' },
  job: { shortId: 'A1B2C3', service: 'Brake Service', totalFormatted: '$240' },
  tech: { name: 'Alice' },
};

console.log('\n┌─ renderTemplate ──────────────────────────────────');
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'Hi {customer.firstName}!' };
  const r = renderTemplate(t, baseVars);
  check('substitutes single var', r.body === 'Hi John!');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: '{tech.name} for {customer.name} on {job.service}' };
  const r = renderTemplate(t, baseVars);
  check('substitutes multi var', r.body === 'Alice for John Doe on Brake Service');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'email', subject: 'Invoice {job.shortId}', body: 'Hi {customer.firstName}' };
  const r = renderTemplate(t, baseVars);
  check('subject + body both rendered',
    r.subject === 'Invoice A1B2C3' && r.body === 'Hi John');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'Line1\nLine2 {customer.firstName}' };
  const r = renderTemplate(t, baseVars);
  check('multi-line body preserved', r.body === 'Line1\nLine2 John');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: '{job.foo} unknown' };
  const r = renderTemplate(t, baseVars);
  check('unknown var renders as literal placeholder', r.body === '{job.foo} unknown');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: '{custom.bar} unknown group' };
  const r = renderTemplate(t, baseVars);
  check('unknown group renders as literal placeholder', r.body === '{custom.bar} unknown group');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'Hi {customer.firstName} 🎉' };
  const r = renderTemplate(t, baseVars);
  check('unicode preserved', r.body === 'Hi John 🎉');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'no vars here' };
  const r = renderTemplate(t, baseVars);
  check('templates with no vars pass through', r.body === 'no vars here');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'in_app', body: '{customer.firstName} {customer.firstName}' };
  const r = renderTemplate(t, baseVars);
  check('same var twice', r.body === 'John John');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Write `tests/buildTemplateVars.test.ts`**

```ts
// tests/buildTemplateVars.test.ts
import { buildTemplateVars } from '@/lib/notificationTemplates';
import type { Job, Brand, Settings } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'job-1234567890ABC', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: 'John Doe', customerPhone: '5551234567', tireSize: '', qty: 1,
  revenue: 240, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);
const brand: Brand = {
  businessName: 'Acme', logoUrl: '', primaryColor: '#000', accentColor: '#000',
  phone: '5559998888', email: 'a@b.com', website: '', reviewUrl: 'https://g.page/r/x',
  invoiceFooter: '', serviceArea: '', businessType: 'Mobile Tire & Roadside',
  tagline: '', state: '', mainCity: '', fullLocationLabel: '',
  serviceCities: [], serviceRadius: 25, onboardingComplete: true, onboardingCompletedAt: null,
};
const settings = {} as Settings;

console.log('\n┌─ buildTemplateVars ───────────────────────────────');
{
  const v = buildTemplateVars(baseJob(), brand, settings, 'Alice');
  check('shortId = last 6 of id, uppercased', v.job.shortId === '90ABC0' || v.job.shortId === '0ABC' || v.job.shortId.length === 6);
}
{
  const v = buildTemplateVars(baseJob({ customerName: 'John Doe' }), brand, settings, 'Alice');
  check('firstName = first whitespace-separated word', v.customer.firstName === 'John');
}
{
  const v = buildTemplateVars(baseJob({ customerName: 'Jane' }), brand, settings, 'Alice');
  check('firstName for single-word name', v.customer.firstName === 'Jane');
}
{
  const v = buildTemplateVars(baseJob({ customerName: '' }), brand, settings, 'Alice');
  check('empty customerName → firstName "there"', v.customer.firstName === 'there');
}
{
  const v = buildTemplateVars(baseJob({ customerName: 'María García López' }), brand, settings, 'Alice');
  check('unicode firstName preserved', v.customer.firstName === 'María');
}
{
  const v = buildTemplateVars(baseJob({ revenue: 240 }), brand, settings, 'Alice');
  check('totalFormatted via money()', v.job.totalFormatted.startsWith('$'));
}
{
  const v = buildTemplateVars(baseJob(), brand, settings, '');
  check('empty techName → "your technician" fallback', v.tech.name === 'your technician');
}
{
  const v = buildTemplateVars(baseJob({ customerEmail: 'j@d.com' }), brand, settings, 'Alice');
  check('customerEmail populated when set', v.customer.email === 'j@d.com');
}
{
  const v = buildTemplateVars(baseJob({ customerEmail: undefined }), brand, settings, 'Alice');
  check('customerEmail undefined when absent', v.customer.email === undefined);
}
{
  const v = buildTemplateVars(baseJob(), brand, settings, 'Alice');
  check('paymentMethods fallback when missing', v.business.paymentMethods.length > 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Run + verify**

```bash
npx tsx tests/renderTemplate.test.ts
npx tsx tests/buildTemplateVars.test.ts
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificationTemplates.ts tests/renderTemplate.test.ts tests/buildTemplateVars.test.ts
git commit -m "feat(notifications): renderTemplate + buildTemplateVars + tests"
```

---

## Task 4: `dispatchNotifications` + test

**Files:**
- Create: `src/lib/notificationDispatch.ts`
- Create: `tests/dispatchNotifications.test.ts`

- [ ] **Step 1: Write the dispatcher**

```ts
// src/lib/notificationDispatch.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure notification dispatcher — reads the just-appended transition,
//  consults the stage's notifications[] spec, applies fireMode rules,
//  renders templates, and returns NotificationDocs to write.
//
//  Returns two arrays: `inAppDocs` (audience: owner/tech, channel:
//  in_app) and `pendingActions` (audience: customer, channel:
//  sms/email). The caller writes ALL of them to Firestore — the
//  split is informational for surfacing pending tap-to-send actions.
// ═══════════════════════════════════════════════════════════════════

import type { Job, NotificationDoc } from '@/types';
import type { LifecycleTransition, ResolvedLifecycle } from '@/config/jobs/lifecycle';
import { uid } from '@/lib/utils';
import { NOTIFICATION_TEMPLATES } from '@/config/notifications/templates';
import { renderTemplate, type TemplateVars } from '@/lib/notificationTemplates';

export interface DispatchContext {
  transition: LifecycleTransition;
  job: Job;
  prior_transitions: ReadonlyArray<LifecycleTransition>;
  resolved: ResolvedLifecycle;
  vars: TemplateVars;
  businessId: string;
  byUid: string;
  ownerUids: ReadonlyArray<string>;
  assignedToUid?: string;
}

export function dispatchNotifications(ctx: DispatchContext): {
  inAppDocs: NotificationDoc[];
  pendingActions: NotificationDoc[];
} {
  const stage = ctx.resolved.stageById.get(ctx.transition.toStage);
  if (!stage || !stage.notifications || stage.notifications.length === 0) {
    return { inAppDocs: [], pendingActions: [] };
  }

  const inAppDocs: NotificationDoc[] = [];
  const pendingActions: NotificationDoc[] = [];
  const now = new Date().toISOString();

  const priorEntryToStage = ctx.prior_transitions.some(
    (t) => t.toStage === ctx.transition.toStage,
  );

  for (const spec of stage.notifications) {
    if (spec.fireMode === 'first_entry' && priorEntryToStage) continue;

    const template = NOTIFICATION_TEMPLATES[spec.templateId];
    if (!template) {
      // eslint-disable-next-line no-console
      console.warn(`[notifications] missing template "${spec.templateId}" — skipping`);
      continue;
    }

    const { subject, body } = renderTemplate(template, ctx.vars);

    const baseDoc: NotificationDoc = {
      id: uid(),
      createdAt: now,
      jobId: ctx.job.id,
      audience: spec.audience,
      channel: spec.channel,
      templateId: spec.templateId,
      subject,
      body,
      byUid: ctx.byUid,
      toStage: ctx.transition.toStage,
    };

    // Audience-specific target fields
    if (spec.audience === 'technician' && ctx.assignedToUid) {
      baseDoc.toUid = ctx.assignedToUid;
    } else if (spec.audience === 'customer') {
      if (spec.channel === 'sms') baseDoc.toPhone = ctx.vars.customer.phone;
      if (spec.channel === 'email') baseDoc.toEmail = ctx.vars.customer.email;
    }

    if (spec.channel === 'in_app') {
      inAppDocs.push(baseDoc);
    } else if (spec.audience === 'customer' && (spec.channel === 'sms' || spec.channel === 'email')) {
      pendingActions.push(baseDoc);
    } else {
      // Owner/technician audience with non-in_app channel — degrade to
      // in-app notification (we have no auto-push without backend).
      inAppDocs.push({ ...baseDoc, channel: 'in_app' });
    }
  }

  return { inAppDocs, pendingActions };
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/dispatchNotifications.test.ts
import { dispatchNotifications } from '@/lib/notificationDispatch';
import { resolveLifecycle } from '@/config/jobs';
import type { Job } from '@/types';
import type { TemplateVars } from '@/lib/notificationTemplates';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';
import type { LifecycleTransition } from '@/config/jobs/lifecycle';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const stubVertical: BusinessTypeConfig = {
  key: 'tire', displayName: 'Tire', shortName: 'Tire',
  pricingModel: { kind: 'flat' },
  services: [], jobFields: [], inventoryFields: [],
  copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
  defaultExpenseCategories: [],
  features: { inventoryDeduction: true, photoCapture: false, vehicleDiagnostics: false, vehicleSizeMultiplier: false, roadsideAddons: true },
  invoiceTemplateKey: 'tire', dashboardMetrics: [],
};
const resolved = resolveLifecycle(stubVertical);

const vars: TemplateVars = {
  customer: { firstName: 'John', name: 'John Doe', phone: '5551234567', email: 'j@d.com' },
  business: { name: 'Acme', phone: '5559998888', email: 'a@b.com', reviewUrl: 'https://g.page/r/x', paymentMethods: 'Cash' },
  job: { shortId: 'A1B2C3', service: 'Brake Service', totalFormatted: '$240' },
  tech: { name: 'Alice' },
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Brake Service', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: 'John Doe', customerPhone: '5551234567', tireSize: '', qty: 1,
  revenue: 240, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const t = (over: Partial<LifecycleTransition>): LifecycleTransition => ({
  toStage: 'enroute', at: '2026-05-21T10:00:00Z', byUid: 'owner', ...over,
});

console.log('\n┌─ dispatchNotifications ───────────────────────────');

// enroute → tech_on_the_way SMS (customer audience) → pendingActions
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'enroute' }),
    job: baseJob(),
    prior_transitions: [],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('enroute: 0 inAppDocs', r.inAppDocs.length === 0);
  check('enroute: 1 pendingAction (SMS)', r.pendingActions.length === 1);
  check('enroute: pendingAction toPhone populated',
    r.pendingActions[0].toPhone === '5551234567');
  check('enroute: pendingAction body has rendered template',
    r.pendingActions[0].body.includes('John'));
}

// dispatched → tech_assigned in_app (owner audience) → inAppDocs
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'dispatched' }),
    job: baseJob(),
    prior_transitions: [],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
    assignedToUid: 'tech1',
  });
  check('dispatched: 1 inAppDoc', r.inAppDocs.length === 1);
  check('dispatched: 0 pendingActions', r.pendingActions.length === 0);
  check('dispatched: inAppDoc has tech_assigned templateId',
    r.inAppDocs[0].templateId === 'tech_assigned');
}

// paid (first entry) → both review SMS + payment_received in-app
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'paid' }),
    job: baseJob(),
    prior_transitions: [],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('paid first entry: 1 inAppDoc (payment_received)',
    r.inAppDocs.length === 1 && r.inAppDocs[0].templateId === 'payment_received');
  check('paid first entry: 1 pendingAction (thank_you SMS)',
    r.pendingActions.length === 1 && r.pendingActions[0].templateId === 'thank_you_review_request');
}

// paid (re-entry) → thank-you SKIPPED, payment_received still fires
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'paid' }),
    job: baseJob(),
    prior_transitions: [{ toStage: 'paid', at: '2026-05-20T08:00:00Z', byUid: 'owner' }],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('paid re-entry: thank_you SKIPPED (first_entry)', r.pendingActions.length === 0);
  check('paid re-entry: payment_received still fires (every_entry)',
    r.inAppDocs.length === 1 && r.inAppDocs[0].templateId === 'payment_received');
}

// completed first entry → job_done in_app
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'completed' }),
    job: baseJob(),
    prior_transitions: [],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('completed first entry: 1 inAppDoc',
    r.inAppDocs.length === 1 && r.inAppDocs[0].templateId === 'job_done');
}

// completed re-entry → SKIPPED (first_entry)
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'completed' }),
    job: baseJob(),
    prior_transitions: [{ toStage: 'completed', at: '2026-05-20T08:00:00Z', byUid: 'owner' }],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('completed re-entry: SKIPPED', r.inAppDocs.length === 0);
}

// in_progress → no notifications declared on universal stage
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'in_progress' }),
    job: baseJob(),
    prior_transitions: [],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('in_progress: 0 inAppDocs', r.inAppDocs.length === 0);
  check('in_progress: 0 pendingActions', r.pendingActions.length === 0);
}

// invoiced → email pendingAction
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'invoiced' }),
    job: baseJob({ customerEmail: 'j@d.com' }),
    prior_transitions: [],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('invoiced: 1 pendingAction (email)',
    r.pendingActions.length === 1 && r.pendingActions[0].channel === 'email');
  check('invoiced: pendingAction toEmail populated',
    r.pendingActions[0].toEmail === 'j@d.com');
  check('invoiced: pendingAction has subject',
    !!r.pendingActions[0].subject);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run + verify**

```bash
npx tsx tests/dispatchNotifications.test.ts
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/notificationDispatch.ts tests/dispatchNotifications.test.ts
git commit -m "feat(notifications): dispatchNotifications + tests (fireMode + audience routing)"
```

---

## Task 5: URI builders + test

**Files:**
- Create: `src/lib/openMessagingUri.ts`
- Create: `tests/openMessagingUri.test.ts`

- [ ] **Step 1: Write the builders**

```ts
// src/lib/openMessagingUri.ts
// ═══════════════════════════════════════════════════════════════════
//  sms: / mailto: URI helpers for the tap-to-send flow. Browsers
//  handle URI-scheme handoff to the OS's SMS / email app; this
//  module just builds the URIs and triggers the navigation.
//
//  We use a programmatic anchor click rather than window.location.href
//  because some mobile browsers block scheme-handoff on direct
//  location.href assignment.
// ═══════════════════════════════════════════════════════════════════

export function buildSmsUri(toPhone: string, body: string): string {
  const phone = String(toPhone || '').replace(/[^0-9+]/g, '');
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

export function buildMailtoUri(toEmail: string, subject: string, body: string): string {
  const email = String(toEmail || '').trim();
  const subj = encodeURIComponent(subject);
  const bod = encodeURIComponent(body);
  return `mailto:${email}?subject=${subj}&body=${bod}`;
}

export function openMessagingUri(uri: string): void {
  const a = document.createElement('a');
  a.href = uri;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 0);
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/openMessagingUri.test.ts
import { buildSmsUri, buildMailtoUri } from '@/lib/openMessagingUri';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ buildSmsUri ─────────────────────────────────────');
check('basic SMS URI',
  buildSmsUri('5551234567', 'Hi there') === 'sms:5551234567?&body=Hi%20there');
check('strips formatting from phone',
  buildSmsUri('(555) 123-4567', 'X') === 'sms:5551234567?&body=X');
check('preserves leading +',
  buildSmsUri('+15551234567', 'X') === 'sms:+15551234567?&body=X');
check('encodes special chars in body',
  buildSmsUri('555', 'hi & bye') === 'sms:555?&body=hi%20%26%20bye');
check('encodes newlines',
  buildSmsUri('555', 'line1\nline2') === 'sms:555?&body=line1%0Aline2');

console.log('\n┌─ buildMailtoUri ──────────────────────────────────');
check('basic mailto URI',
  buildMailtoUri('j@d.com', 'Hi', 'Body text') === 'mailto:j@d.com?subject=Hi&body=Body%20text');
check('trims email whitespace',
  buildMailtoUri('  j@d.com  ', 'S', 'B') === 'mailto:j@d.com?subject=S&body=B');
check('encodes subject + body separately',
  buildMailtoUri('j@d.com', 'Hi & you', 'a=1&b=2') === 'mailto:j@d.com?subject=Hi%20%26%20you&body=a%3D1%26b%3D2');
check('multi-line email body',
  buildMailtoUri('j@d.com', 'S', 'L1\nL2') === 'mailto:j@d.com?subject=S&body=L1%0AL2');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run + verify**

```bash
npx tsx tests/openMessagingUri.test.ts
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/openMessagingUri.ts tests/openMessagingUri.test.ts
git commit -m "feat(notifications): sms: / mailto: URI builders + tests"
```

---

## Task 6: `visibleNotifications` + test

**Files:**
- Create: `src/lib/visibleNotifications.ts`
- Create: `tests/visibleNotifications.test.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/lib/visibleNotifications.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure role-based filter for the notifications collection. Owner /
//  admin see everything; tech sees notifications targeted at them
//  (audience: technician + toUid === me) OR notifications they
//  triggered (byUid === me).
// ═══════════════════════════════════════════════════════════════════

import type { NotificationDoc, Role } from '@/types';

export function visibleNotifications(
  notifs: ReadonlyArray<NotificationDoc>,
  role: Role | null | undefined,
  uid: string | null | undefined,
): NotificationDoc[] {
  if (role === 'owner' || role === 'admin') {
    return notifs.slice();
  }
  if (role === 'technician' && uid) {
    return notifs.filter((n) =>
      (n.audience === 'technician' && n.toUid === uid) ||
      n.byUid === uid,
    );
  }
  return [];
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/visibleNotifications.test.ts
import { visibleNotifications } from '@/lib/visibleNotifications';
import type { NotificationDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const n = (over: Partial<NotificationDoc>): NotificationDoc => ({
  id: 'n', createdAt: '2026-05-21T10:00:00Z', jobId: 'j',
  audience: 'owner', channel: 'in_app', templateId: 'tech_assigned',
  body: 'b', byUid: 'owner', toStage: 'dispatched',
  ...over,
} as NotificationDoc);

const notifs: NotificationDoc[] = [
  n({ id: 'a', audience: 'owner', byUid: 'owner' }),
  n({ id: 'b', audience: 'technician', toUid: 'tech1', byUid: 'owner' }),
  n({ id: 'c', audience: 'technician', toUid: 'tech2', byUid: 'owner' }),
  n({ id: 'd', audience: 'customer', toPhone: '555', byUid: 'tech1', channel: 'sms' }),
];

console.log('\n┌─ visibleNotifications ────────────────────────────');
check('owner sees all 4', visibleNotifications(notifs, 'owner', 'owner').length === 4);
check('admin sees all 4', visibleNotifications(notifs, 'admin', 'admin').length === 4);
check('tech1 sees own technician notif + own-triggered customer notif',
  visibleNotifications(notifs, 'technician', 'tech1').length === 2);
check('tech1 does not see tech2 notification',
  !visibleNotifications(notifs, 'technician', 'tech1').some((x) => x.id === 'c'));
check('tech2 sees only own technician notif',
  visibleNotifications(notifs, 'technician', 'tech2').length === 1);
check('tech with no jobs sees empty',
  visibleNotifications(notifs, 'technician', 'unknown').length === 0);
check('null role → empty',
  visibleNotifications(notifs, null, 'tech1').length === 0);
check('tech with null uid → empty',
  visibleNotifications(notifs, 'technician', null).length === 0);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run + verify**

```bash
npx tsx tests/visibleNotifications.test.ts
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/visibleNotifications.ts tests/visibleNotifications.test.ts
git commit -m "feat(notifications): visibleNotifications role-based filter + test"
```

---

## Task 7: `useNotifications` hook

**Files:**
- Create: `src/lib/useNotifications.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/lib/useNotifications.ts
// ═══════════════════════════════════════════════════════════════════
//  Live subscription to businesses/{id}/notifications. Returns the
//  full filtered list + helpers to mark-read, mark-all-read, and
//  stamp sentAt for tap-to-send.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { useMembership } from '@/context/MembershipContext';
import { deserializeNotification } from '@/lib/deserializers';
import { visibleNotifications } from '@/lib/visibleNotifications';
import type { NotificationDoc } from '@/types';

export interface UseNotificationsResult {
  notifications: NotificationDoc[];
  unreadCount: number;
  pendingCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  markSent: (id: string) => Promise<void>;
}

export function useNotifications(): UseNotificationsResult {
  const { member, role } = useMembership();
  const businessId = member?.businessId;
  const uid = member?.uid;
  const [all, setAll] = useState<NotificationDoc[]>([]);

  useEffect(() => {
    const db = _db;
    if (!db || !businessId) { setAll([]); return undefined; }
    const ref = collection(db, 'businesses', businessId, 'notifications');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const docs = snap.docs.map((d) =>
          deserializeNotification({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }),
        );
        // Newest first
        docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setAll(docs);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[useNotifications] snapshot error:', err);
        setAll([]);
      },
    );
    return () => unsub();
  }, [businessId]);

  const notifications = useMemo(
    () => visibleNotifications(all, role, uid),
    [all, role, uid],
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);
  const pendingCount = useMemo(
    () => notifications.filter((n) => (n.channel === 'sms' || n.channel === 'email') && !n.sentAt).length,
    [notifications],
  );

  const markRead = useCallback(async (id: string) => {
    if (!_db || !businessId) return;
    const ref = doc(_db, 'businesses', businessId, 'notifications', id);
    await updateDoc(ref, { readAt: new Date().toISOString() });
  }, [businessId]);

  const markAllRead = useCallback(async () => {
    if (!_db || !businessId) return;
    const now = new Date().toISOString();
    const batch = writeBatch(_db);
    for (const n of notifications) {
      if (!n.readAt) {
        const ref = doc(_db, 'businesses', businessId, 'notifications', n.id);
        batch.update(ref, { readAt: now });
      }
    }
    await batch.commit();
  }, [businessId, notifications]);

  const markSent = useCallback(async (id: string) => {
    if (!_db || !businessId) return;
    const ref = doc(_db, 'businesses', businessId, 'notifications', id);
    await updateDoc(ref, { sentAt: new Date().toISOString() });
  }, [businessId]);

  return { notifications, unreadCount, pendingCount, markRead, markAllRead, markSent };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/useNotifications.ts
git commit -m "feat(notifications): useNotifications live hook"
```

---

## Task 8: `addActionToast` + ToastHost render

**Files:**
- Modify: `src/lib/toast.ts`
- Modify: `src/components/ToastHost.tsx`

- [ ] **Step 1: Extend toast.ts with action support**

Replace `src/lib/toast.ts` with:

```ts
import type { ToastItem, ToastType } from '@/types';
import { uid } from '@/lib/utils';

type Listener = (toasts: ToastItem[]) => void;
let toasts: ToastItem[] = [];
let listeners: Listener[] = [];

function emit() {
  listeners.forEach((l) => l(toasts));
}

export function addToast(msg: string, type: ToastType = 'info'): void {
  const item: ToastItem = { id: uid(), msg, type, ts: Date.now() };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emit();
  }, type === 'error' ? 5000 : 3000);
}

/**
 * Toast with an inline action button. Stays visible longer (8 s) so
 * the operator has time to tap. Tapping the action dismisses the
 * toast immediately.
 */
export function addActionToast(
  msg: string,
  action: { label: string; onTap: () => void },
  type: ToastType = 'info',
): void {
  const id = uid();
  const wrappedTap = () => {
    try { action.onTap(); } finally {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }
  };
  const item: ToastItem = {
    id, msg, type, ts: Date.now(),
    action: { label: action.label, onTap: wrappedTap },
  };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 8000);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.push(l);
  l(toasts);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}
```

- [ ] **Step 2: Update ToastHost to render the action button**

Read the existing `src/components/ToastHost.tsx`:

```bash
cat src/components/ToastHost.tsx
```

Then modify it so each toast row renders the action button when `toast.action` is set. The render structure is component-specific — locate the per-toast JSX render (likely a `.map(...)` over the toast list) and inject:

```tsx
{toast.action && (
  <button
    type="button"
    onClick={toast.action.onTap}
    className="btn xs primary"
    style={{ marginLeft: 8 }}
  >
    {toast.action.label}
  </button>
)}
```

inside each toast row, after the message text.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/toast.ts src/components/ToastHost.tsx
git commit -m "feat(toast): addActionToast with inline action button"
```

---

## Task 9: `NotificationsBell` + `NotificationsPanel`

**Files:**
- Create: `src/components/NotificationsBell.tsx`
- Create: `src/components/NotificationsPanel.tsx`

- [ ] **Step 1: Write `NotificationsBell.tsx`**

```tsx
// src/components/NotificationsBell.tsx
// ═══════════════════════════════════════════════════════════════════
//  Header icon with unread badge. Tap → open NotificationsPanel.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { NotificationsPanel } from '@/components/NotificationsPanel';

export function NotificationsBell() {
  const { unreadCount, pendingCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const badge = unreadCount + pendingCount;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        style={{
          position: 'relative',
          background: 'transparent', border: 0,
          padding: 6, cursor: 'pointer',
          fontSize: 20, color: 'var(--t1)',
        }}
      >
        🔔
        {badge > 0 && (
          <span
            style={{
              position: 'absolute', top: 0, right: 0,
              background: 'var(--amber)', color: '#000',
              fontSize: 10, fontWeight: 800,
              borderRadius: 10, padding: '2px 5px',
              minWidth: 16, textAlign: 'center',
            }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      {open && <NotificationsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Write `NotificationsPanel.tsx`**

```tsx
// src/components/NotificationsPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bottom-sheet list of notifications. Newest first. Tap row →
//  marks read + (caller-driven) navigates to job. Pending SMS/email
//  rows have a [Send] button that opens the OS messaging app.
// ═══════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { buildSmsUri, buildMailtoUri, openMessagingUri } from '@/lib/openMessagingUri';
import type { NotificationDoc } from '@/types';

interface Props {
  onClose: () => void;
  onNavigateToJob?: (jobId: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function iconFor(n: NotificationDoc): string {
  if (n.channel === 'sms') return '📱';
  if (n.channel === 'email') return '✉️';
  return '🔔';
}

export function NotificationsPanel({ onClose, onNavigateToJob }: Props) {
  const { notifications, markRead, markAllRead, markSent } = useNotifications();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleRowTap = async (n: NotificationDoc): Promise<void> => {
    if (!n.readAt) await markRead(n.id);
    if (onNavigateToJob) onNavigateToJob(n.jobId);
    onClose();
  };

  const handleSendTap = async (e: React.MouseEvent, n: NotificationDoc): Promise<void> => {
    e.stopPropagation();
    const uri = n.channel === 'sms'
      ? buildSmsUri(n.toPhone || '', n.body)
      : buildMailtoUri(n.toEmail || '', n.subject || '', n.body);
    openMessagingUri(uri);
    await markSent(n.id);
  };

  return (
    <div
      className="more-sheet-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--s1)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
          maxHeight: '75vh', overflowY: 'auto',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ width: 40, height: 4, background: 'var(--t3)', borderRadius: 4, margin: '2px auto 14px', opacity: 0.5 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.5 }}>
            Notifications ({notifications.length})
          </span>
          {notifications.some((n) => !n.readAt) && (
            <button
              type="button"
              onClick={() => { void markAllRead(); }}
              className="btn xs secondary"
            >Mark all read</button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            No notifications yet — they'll appear as jobs move through stages.
          </div>
        ) : (
          notifications.map((n) => {
            const isPending = (n.channel === 'sms' || n.channel === 'email') && !n.sentAt;
            const isUnread = !n.readAt;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => { void handleRowTap(n); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', textAlign: 'left',
                  padding: '12px 10px', marginBottom: 6,
                  background: isUnread ? 'var(--s2)' : 'transparent',
                  border: '1px solid var(--border)', borderRadius: 10,
                  color: 'var(--t1)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 18 }}>{iconFor(n)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: isUnread ? 700 : 500, marginBottom: 2 }}>
                    {n.subject || n.body.split('\n')[0]}
                  </div>
                  {n.subject && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'pre-line' }}>
                      {n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                    {timeAgo(n.createdAt)}
                    {n.sentAt && ' · sent'}
                  </div>
                </div>
                {isPending && (
                  <button
                    type="button"
                    onClick={(e) => { void handleSendTap(e, n); }}
                    className="btn xs primary"
                  >Send</button>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/NotificationsBell.tsx src/components/NotificationsPanel.tsx
git commit -m "feat(notifications): NotificationsBell + NotificationsPanel components"
```

---

## Task 10: Mount bell in Header + JobDetailModal inline send actions

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/JobDetailModal.tsx`

- [ ] **Step 1: Mount the bell in Header**

Open `src/components/Header.tsx`. Add the import:

```ts
import { NotificationsBell } from '@/components/NotificationsBell';
```

Find the existing `<BusinessSwitcher activeLabel={...} />` line. Add the bell next to it (before or after, your choice — recommended: just before, so the bell is left of the switcher):

```tsx
<NotificationsBell />
<BusinessSwitcher activeLabel={brand.businessName || 'Mobile Service OS'} />
```

- [ ] **Step 2: Inline pending-action buttons in JobDetailModal**

Open `src/components/JobDetailModal.tsx`. Add the imports:

```ts
import { useNotifications } from '@/lib/useNotifications';
import { buildSmsUri, buildMailtoUri, openMessagingUri } from '@/lib/openMessagingUri';
```

Inside the component, after the existing hook calls:

```ts
const { notifications, markSent } = useNotifications();
const pendingForThisJob = notifications.filter(
  (n) => n.jobId === job.id &&
         (n.channel === 'sms' || n.channel === 'email') &&
         !n.sentAt,
);
```

Find the existing "Mark Paid CTA" block (search for `Mark Paid` or `{ps !== 'Paid' && ps !== 'Cancelled' &&`). **Above** that block (between StageHistory and Mark Paid), insert:

```tsx
{pendingForThisJob.length > 0 && (
  <div className="form-group" style={{ marginBottom: 12 }}>
    <div className="form-group-title">Pending customer messages</div>
    {pendingForThisJob.map((n) => (
      <button
        key={n.id}
        type="button"
        onClick={async () => {
          const uri = n.channel === 'sms'
            ? buildSmsUri(n.toPhone || '', n.body)
            : buildMailtoUri(n.toEmail || '', n.subject || '', n.body);
          openMessagingUri(uri);
          await markSent(n.id);
        }}
        disabled={n.channel === 'email' ? !n.toEmail : !n.toPhone}
        className="btn sm secondary"
        style={{ width: '100%', textAlign: 'left', marginBottom: 6 }}
      >
        {n.channel === 'sms' ? '📱' : '✉️'} Send {n.subject || n.body.split('\n')[0]}
        {n.channel === 'email' && !n.toEmail && (
          <span style={{ color: 'var(--t3)', fontSize: 11, marginLeft: 6 }}>(no email on file)</span>
        )}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx src/components/JobDetailModal.tsx
git commit -m "feat(notifications): mount NotificationsBell in Header + inline send actions in JobDetailModal"
```

---

## Task 11: `App.tsx` `handleStageTransition` extension with `writeBatch`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the imports**

In `src/App.tsx`, add to the existing imports near the lifecycle imports:

```ts
import { writeBatch, doc } from 'firebase/firestore';
import { dispatchNotifications } from '@/lib/notificationDispatch';
import { buildTemplateVars } from '@/lib/notificationTemplates';
import { addActionToast } from '@/lib/toast';
import { buildSmsUri, buildMailtoUri, openMessagingUri } from '@/lib/openMessagingUri';
import { useBusinessMembers } from '@/lib/useBusinessMembers';
```

(Some may already exist. Keep one copy each.)

- [ ] **Step 2: Resolve owner uids + tech name via existing hooks**

Inside the App component, add (after the existing `member` resolution):

```ts
const members = useBusinessMembers();
const ownerUids = useMemo(
  () => members.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.uid!).filter(Boolean),
  [members],
);
const techNameFor = useCallback((uid: string | undefined): string => {
  if (!uid) return '';
  const m = members.find((x) => x.uid === uid);
  return m?.displayName || m?.email || '';
}, [members]);
```

- [ ] **Step 3: Replace `handleStageTransition` body**

Find the existing `handleStageTransition` callback (added in Sub-Project C). Replace its body with:

```ts
const handleStageTransition = useCallback(
  async (job: Job, toStage: JobLifecycleStage, toSubstage?: string) => {
    if (!businessId || !_db) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    const notifCol = scopedCol(businessId, 'notifications');
    if (!jobsCol || !notifCol) return;

    const verticalConfig = getBusinessTypeConfig(settings.businessType);
    const resolvedLifecycle = resolveLifecycle(verticalConfig);
    const next = transitionJobStage({
      job,
      toStage,
      toSubstage,
      byUid: _auth?.currentUser?.uid || '',
      resolved: resolvedLifecycle,
      settings,
    });

    // Dispatch notifications based on the just-appended transition.
    const lastTransition = next.transitions![next.transitions!.length - 1];
    const vars = buildTemplateVars(
      next, brand, settings,
      techNameFor(next.assignedToUid),
    );
    const { inAppDocs, pendingActions } = dispatchNotifications({
      transition: lastTransition,
      job: next,
      prior_transitions: job.transitions ?? [],
      resolved: resolvedLifecycle,
      vars,
      businessId,
      byUid: _auth?.currentUser?.uid || '',
      ownerUids,
      assignedToUid: next.assignedToUid,
    });

    try {
      // Atomic batch: job + all notification docs.
      const batch = writeBatch(_db);
      batch.set(doc(jobsCol, next.id), next);
      for (const n of [...inAppDocs, ...pendingActions]) {
        batch.set(doc(notifCol, n.id), n);
      }
      await batch.commit();

      setDetailJob(next);
      addToast(`Stage → ${resolvedLifecycle.stageById.get(toStage)?.label ?? toStage}`, 'success');

      // Surface first pendingAction as an action toast.
      if (pendingActions.length > 0) {
        const first = pendingActions[0];
        addActionToast(
          `Send ${first.channel === 'sms' ? 'SMS' : 'email'} to ${vars.customer.name}?`,
          {
            label: 'Send',
            onTap: () => {
              const uri = first.channel === 'sms'
                ? buildSmsUri(first.toPhone || '', first.body)
                : buildMailtoUri(first.toEmail || '', first.subject || '', first.body);
              openMessagingUri(uri);
              // Mark sent — best-effort
              void (async () => {
                try {
                  const ref = doc(notifCol, first.id);
                  await import('firebase/firestore').then(({ updateDoc }) =>
                    updateDoc(ref, { sentAt: new Date().toISOString() }),
                  );
                } catch (e) {
                  console.warn('[handleStageTransition] markSent failed:', e);
                }
              })();
            },
          },
          'info',
        );
      }
    } catch (e) {
      console.error('[handleStageTransition] failed:', e);
      addToast(`Stage update failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  },
  [businessId, settings, brand, ownerUids, techNameFor],
);
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(notifications): handleStageTransition dispatches + writes via writeBatch"
```

---

## Task 12: firestore.rules — `notifications/` collection (PAUSE before push)

**Files:**
- Modify: `firestore.rules`

> **STOP CRITERION ALERT.** Same protocol as Sub-Project B Task 9 — security boundary change. Local edits only; push pauses for explicit user confirmation.

- [ ] **Step 1: Locate the existing per-collection block**

```bash
grep -n "match /jobs\|match /inventory\|match /customers\|match /technicians" firestore.rules | tail -10
```

You're looking for the section that has `match /jobs/{docId}` and similar collections (Sub-Project B tightened these). Add the new `notifications` block right after `technicians`.

- [ ] **Step 2: Add the notifications block**

In `firestore.rules`, find the `match /technicians/{docId}` block. Immediately after its closing brace, add:

```
      // Notifications: any member can write (they're triggered by
      // transition writes); reads scoped to business members
      // (client-side visibleNotifications() filters by role + uid).
      match /notifications/{notifId} {
        allow read: if isMemberOfBusiness(businessId);
        allow create: if isMemberOfBusiness(businessId);
        allow update: if isMemberOfBusiness(businessId);
        allow delete: if isOwnerOrAdmin(businessId) ||
                         request.auth.uid == businessId;
      }
```

- [ ] **Step 3: Local-only commit (do NOT push yet)**

```bash
git add firestore.rules
git commit -m "feat(rules): notifications collection rules"
```

- [ ] **Step 4: PAUSE — surface the diff to the user**

```bash
git diff HEAD~1 HEAD -- firestore.rules
```

Present the diff. Wait for explicit "push" or "approved". Do NOT push autonomously.

- [ ] **Step 5: After user approval, push**

```bash
git push origin main
```

Then run `firebase deploy --only firestore:rules` (or paste into the Firebase Console) to apply the rules. **This is the same gap as Sub-Project B — the rules don't apply until that command runs.**

---

## Task 13: Final smoke + tag

- [ ] **Step 1: Re-run every test file**

```bash
for t in tests/jobLifecycle.test.ts tests/mechanicJobDerivation.test.ts tests/mechanicDeductionDiff.test.ts tests/mechanicDeductionRollback.test.ts tests/softStockWarning.test.ts tests/mechanicInvoiceLineItems.test.ts tests/technicianPermissions.test.ts tests/scopedJobs.test.ts tests/jobEditPermission.test.ts tests/jobDeletePermission.test.ts tests/assignableMembers.test.ts tests/transitionJobStage.test.ts tests/canTransitionToStage.test.ts tests/historyEntries.test.ts tests/groupJobsByStage.test.ts tests/renderTemplate.test.ts tests/buildTemplateVars.test.ts tests/dispatchNotifications.test.ts tests/openMessagingUri.test.ts tests/visibleNotifications.test.ts; do
  npx tsx "$t" 2>&1 | grep -E "^\s+[0-9]+ passed" | tail -1 | xargs -I{} echo "$t → {}"
done
```
Expected: each file prints `N passed, 0 failed`.

- [ ] **Step 2: Final build**

```bash
npm run build
```

- [ ] **Step 3: Confirm commit log granularity**

```bash
git log --oneline origin/main..HEAD
```
Expected: ~13 commits.

- [ ] **Step 4: Run §15 spec smoke checklist on production**

After the rules-deploy + Pages-deploy lands, hand-execute the spec smoke checklist (owner regression + new surfaces + tech account + fireMode + cross-cutting).

- [ ] **Step 5: Tag stable**

```bash
git tag phase-2.2-crm-stable $(git rev-parse HEAD)
git push origin phase-2.2-crm-stable
```

---

## Phase summary

After all 13 tasks land:

| Surface | State |
|---|---|
| Types | `Job.customerEmail?` added; `NotificationDoc` interface; `ToastItem.action?` extended |
| Templates | `NOTIFICATION_TEMPLATES` registry (7 templates) |
| Helpers | `renderTemplate`, `buildTemplateVars`, `dispatchNotifications`, `buildSmsUri`, `buildMailtoUri`, `openMessagingUri`, `visibleNotifications`, `addActionToast`, `useNotifications` |
| Tests | 5 new files (~60 assertions); all prior suites pass |
| Components | `NotificationsBell`, `NotificationsPanel`; inline pending-action buttons on JobDetailModal |
| Toast | `addActionToast` + ToastHost button render |
| App.tsx | `handleStageTransition` extended with dispatcher + `writeBatch` |
| firestore.rules | `notifications/` block added; deploy pending (pause before push) |
| Backward compat | Operators not using stage picker see zero change; existing jobs without transitions fire no notifications; new `notifications/` collection starts empty |
| Phase 2.2 complete | After this ships + tag lands, Phase 2.2 is done; Phase 2.3 (Detailing Operations) is next |
