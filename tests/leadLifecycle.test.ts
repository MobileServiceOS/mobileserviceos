// tests/leadLifecycle.test.ts
// Run: npx tsx tests/leadLifecycle.test.ts
//
// Lead read-state + lifecycle-stage derivation. The badge shown and the
// Firestore write both flow through these pure helpers, so the UI can
// never claim a state the data doesn't back. Covers the audit scenarios
// A–H: a lead is "Unread" until opened once (viewedAt written), stays
// read across refresh / re-login (persisted field), and each status
// transition stamps exactly the right lifecycle timestamp.

import {
  isLeadUnread,
  leadReadState,
  markViewedPatch,
  stageTransitionPatch,
  STAGE_TIMESTAMP_FIELD,
} from '@/lib/leadLifecycle';
import type { Lead, LeadStatus } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

// A fake Timestamp — only toMillis is exercised by the helpers. Stable
// instances (T1/T5) so identity comparisons in assertions are meaningful.
const TS = (ms: number) => ({ toMillis: () => ms });
const T1 = TS(1000);
const T2 = TS(2000);
const T5 = TS(5000);
const UID = 'user-123';

// Minimal Lead factory. Cast through unknown — the helpers only read the
// few fields under test.
function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1', customerId: 'c1', phoneE164: '+13055551212',
    source: 'missed_call', status: 'New', wasNewCustomer: true,
    autoTextSent: false, lastEditedByUid: 'system',
    ...over,
  } as unknown as Lead;
}

console.log('\n── Scenario A: new lead created → Unread ──');
{
  const l = lead();                       // no viewedAt
  check('isLeadUnread true when viewedAt absent', isLeadUnread(l) === true);
  check('readState = unread', leadReadState(l) === 'unread');
}

console.log('\n── Scenario B: lead opened → viewedAt written, Unread cleared ──');
{
  const l = lead();
  const patch = markViewedPatch(l, UID, T1);
  check('markViewedPatch writes viewedAt', !!patch && 'viewedAt' in patch);
  check('patch carries audit fields', !!patch && patch.updatedAt === T1 && patch.lastEditedByUid === UID,
    JSON.stringify(patch));
  // Apply the patch (what Firestore + the live snapshot would reflect).
  const opened = lead({ viewedAt: (patch as { viewedAt: Lead["viewedAt"] }).viewedAt });
  check('after viewedAt set → not unread', isLeadUnread(opened) === false);
  check('readState = viewed', leadReadState(opened) === 'viewed');
}

console.log('\n── Scenario B′: opening an already-viewed lead writes nothing ──');
{
  const opened = lead({ viewedAt: T1 as Lead["viewedAt"] });
  check('markViewedPatch returns null when already viewed', markViewedPatch(opened, UID, T2) === null);
}

console.log('\n── Scenario C: refresh → state derives from persisted field ──');
{
  // A page refresh re-reads the same Firestore doc. viewedAt persists ⇒
  // the lead is still viewed; nothing is time-window inferred.
  const refetched = lead({ viewedAt: T1 as Lead["viewedAt"] });
  check('still viewed after refresh', isLeadUnread(refetched) === false);
}

console.log('\n── Scenario D: logout/login → state still derives from Firestore ──');
{
  // Different session, same doc — read state is global business state, not
  // per-device/per-session, because it lives in viewedAt.
  const newSession = lead({ id: "lead-1", viewedAt: T1 as Lead["viewedAt"] });
  check('still viewed after re-login', isLeadUnread(newSession) === false);
}

console.log('\n── Scenarios E–H: status transitions stamp the right timestamp ──');
{
  const cases: Array<{ name: string; next: LeadStatus; field: string }> = [
    { name: 'E Contacted → contactedAt', next: 'Contacted', field: 'contactedAt' },
    { name: 'F Quoted → quotedAt',       next: 'Quoted',    field: 'quotedAt'    },
    { name: 'G Booked → bookedAt',       next: 'Booked',    field: 'bookedAt'    },
    { name: 'H Lost → lostAt',           next: 'Lost',      field: 'lostAt'      },
  ];
  for (const c of cases) {
    const patch = stageTransitionPatch(c.next, UID, T5);
    check(c.name + ' (status set)', patch.status === c.next);
    check(c.name + ' (timestamp stamped)', patch[c.field] === T5, JSON.stringify(patch));
    check(c.name + ' (audit set)', patch.updatedAt === T5 && patch.lastEditedByUid === UID);
  }
  // Closed maps to completedAt (success terminal), not a 'closedAt' status field.
  const closed = stageTransitionPatch("Closed", UID, T5);
  check('Closed → completedAt stamped', closed.completedAt === T5);
  check('STAGE map: New has no stamp', STAGE_TIMESTAMP_FIELD.New === null);
  // Lost transition can carry close-out metadata without losing the stamp.
  const lostWithReason = stageTransitionPatch('Lost', UID, T5, { closedReason: 'went elsewhere', closedAt: T5 });
  check('Lost extra metadata merges + lostAt kept',
    lostWithReason.lostAt === T5 && lostWithReason.closedReason === 'went elsewhere');
}

console.log('\n── Honesty: read state is purely viewedAt, never wasNewCustomer ──');
{
  // A brand-new *customer* whose lead has already been viewed must NOT
  // show as unread — the old bug conflated these.
  const viewedNewCustomer = lead({ wasNewCustomer: true, viewedAt: TS(1) as Lead["viewedAt"] });
  check('new customer + viewed → not unread (bug fixed)', isLeadUnread(viewedNewCustomer) === false);
  // An existing customer whose lead is fresh must still be unread.
  const unreadExisting = lead({ wasNewCustomer: false });
  check('existing customer + never opened → unread', isLeadUnread(unreadExisting) === true);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
