// tests/renderTemplate.test.ts
// Run: npx tsx tests/renderTemplate.test.ts

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
  check('substitutes single var',
    renderTemplate(t, baseVars).body === 'Hi John!');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: '{tech.name} for {customer.name} on {job.service}' };
  check('substitutes multi var',
    renderTemplate(t, baseVars).body === 'Alice for John Doe on Brake Service');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'email', subject: 'Invoice {job.shortId}', body: 'Hi {customer.firstName}' };
  const r = renderTemplate(t, baseVars);
  check('subject + body both rendered',
    r.subject === 'Invoice A1B2C3' && r.body === 'Hi John');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'Line1\nLine2 {customer.firstName}' };
  check('multi-line body preserved',
    renderTemplate(t, baseVars).body === 'Line1\nLine2 John');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: '{job.foo} unknown' };
  check('unknown var renders as literal placeholder',
    renderTemplate(t, baseVars).body === '{job.foo} unknown');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: '{custom.bar} unknown group' };
  check('unknown group renders as literal placeholder',
    renderTemplate(t, baseVars).body === '{custom.bar} unknown group');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'Hi {customer.firstName} 🎉' };
  check('unicode preserved',
    renderTemplate(t, baseVars).body === 'Hi John 🎉');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'no vars here' };
  check('templates with no vars pass through',
    renderTemplate(t, baseVars).body === 'no vars here');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'in_app', body: '{customer.firstName} {customer.firstName}' };
  check('same var twice',
    renderTemplate(t, baseVars).body === 'John John');
}
{
  const t: NotificationTemplate = { id: 't', channel: 'sms', body: 'just body' };
  check('no subject → undefined subject',
    renderTemplate(t, baseVars).subject === undefined);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
