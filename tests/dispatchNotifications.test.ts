// tests/dispatchNotifications.test.ts
// Run: npx tsx tests/dispatchNotifications.test.ts

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
    transition: t({ toStage: 'enroute' }), job: baseJob(),
    prior_transitions: [], resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('enroute: 0 inAppDocs', r.inAppDocs.length === 0);
  check('enroute: 1 pendingAction (SMS)', r.pendingActions.length === 1);
  check('enroute: pendingAction toPhone populated',
    r.pendingActions[0].toPhone === '5551234567');
  check('enroute: pendingAction body has rendered template',
    r.pendingActions[0].body.includes('John'));
  check('enroute: channel is sms', r.pendingActions[0].channel === 'sms');
}

// dispatched → tech_assigned in_app (owner audience) → inAppDocs
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'dispatched' }), job: baseJob(),
    prior_transitions: [], resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
    assignedToUid: 'tech1',
  });
  check('dispatched: 1 inAppDoc', r.inAppDocs.length === 1);
  check('dispatched: 0 pendingActions', r.pendingActions.length === 0);
  check('dispatched: inAppDoc has tech_assigned templateId',
    r.inAppDocs[0].templateId === 'tech_assigned');
  check('dispatched: audience is owner', r.inAppDocs[0].audience === 'owner');
}

// paid (first entry) → review SMS + payment_received in-app
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'paid' }), job: baseJob(),
    prior_transitions: [], resolved, vars,
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
    transition: t({ toStage: 'paid' }), job: baseJob(),
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
    transition: t({ toStage: 'completed' }), job: baseJob(),
    prior_transitions: [], resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('completed first entry: 1 inAppDoc',
    r.inAppDocs.length === 1 && r.inAppDocs[0].templateId === 'job_done');
}

// completed re-entry → SKIPPED (first_entry)
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'completed' }), job: baseJob(),
    prior_transitions: [{ toStage: 'completed', at: '2026-05-20T08:00:00Z', byUid: 'owner' }],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('completed re-entry: SKIPPED', r.inAppDocs.length === 0);
}

// in_progress → no notifications declared on universal stage
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'in_progress' }), job: baseJob(),
    prior_transitions: [], resolved, vars,
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
    prior_transitions: [], resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('invoiced: 1 pendingAction (email)',
    r.pendingActions.length === 1 && r.pendingActions[0].channel === 'email');
  check('invoiced: pendingAction toEmail populated',
    r.pendingActions[0].toEmail === 'j@d.com');
  check('invoiced: pendingAction has subject',
    !!r.pendingActions[0].subject);
}

// every entry on enroute: re-entering re-fires
{
  const r = dispatchNotifications({
    transition: t({ toStage: 'enroute' }), job: baseJob(),
    prior_transitions: [{ toStage: 'enroute', at: '2026-05-20T08:00:00Z', byUid: 'tech1' }],
    resolved, vars,
    businessId: 'b', byUid: 'owner', ownerUids: ['owner'],
  });
  check('enroute re-entry: still fires (every_entry)',
    r.pendingActions.length === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
