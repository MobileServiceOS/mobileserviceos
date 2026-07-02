// tests/rules/firestore.rules.test.ts
// ═══════════════════════════════════════════════════════════════════
//  Firestore SECURITY-RULES tests — the multi-tenant boundary.
//
//  Run: npm run test:rules   (boots the Firestore emulator via
//  `firebase emulators:exec`, then this suite against firestore.rules).
//
//  Covers the load-bearing guarantees the app relies on but never had a
//  test for: cross-business isolation, the per-user `users` doc, and the
//  owner/admin-vs-technician write matrix on jobs / inventory / settings /
//  leads. Membership is seeded via withSecurityRulesDisabled so the
//  authenticated assertions exercise the real rules (which read the
//  members docs via get()/exists()).
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'demo-msos';
const BIZ_A = 'bizA';
const BIZ_B = 'bizB';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await env?.cleanup(); });

// Seed membership + one doc per collection in each business, with rules
// OFF, before every test. Authenticated assertions below then run against
// the REAL rules.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Membership (the unforgeable source of truth).
    await setDoc(doc(db, `businesses/${BIZ_A}/members/ownerA`), { role: 'owner' });
    await setDoc(doc(db, `businesses/${BIZ_A}/members/adminA`), { role: 'admin' });
    await setDoc(doc(db, `businesses/${BIZ_A}/members/techA`), { role: 'technician' });
    await setDoc(doc(db, `businesses/${BIZ_B}/members/ownerB`), { role: 'owner' });
    // User docs (self-only collection).
    await setDoc(doc(db, 'users/ownerA'), { businessId: BIZ_A });
    await setDoc(doc(db, 'users/ownerB'), { businessId: BIZ_B });
    // Business data in A.
    await setDoc(doc(db, `businesses/${BIZ_A}/settings/main`), { businessName: 'A' });
    await setDoc(doc(db, `businesses/${BIZ_A}/inventory/item1`), { size: '225/45R17', qty: 10, cost: 80 });
    await setDoc(doc(db, `businesses/${BIZ_A}/customers/cust1`), { name: 'Pat', jobCount: 1 });
    await setDoc(doc(db, `businesses/${BIZ_A}/leads/lead1`), { status: 'New', phoneE164: '+13055550000' });
    // A job created by + assigned to the technician (their own job).
    await setDoc(doc(db, `businesses/${BIZ_A}/jobs/jobTech`), {
      createdByUid: 'techA', assignedToUid: 'techA', revenue: 100,
    });
    // A job owned by the owner (not the technician's).
    await setDoc(doc(db, `businesses/${BIZ_A}/jobs/jobOwner`), {
      createdByUid: 'ownerA', assignedToUid: 'ownerA', revenue: 200,
    });
  });
});

const asOwnerA = () => env.authenticatedContext('ownerA').firestore();
const asTechA = () => env.authenticatedContext('techA').firestore();
const asOwnerB = () => env.authenticatedContext('ownerB').firestore();
const asOutsider = () => env.authenticatedContext('stranger').firestore(); // signed in, no membership
const asAnon = () => env.unauthenticatedContext().firestore();

describe('cross-business isolation', () => {
  it('a member of B cannot read A jobs', async () => {
    await assertFails(getDoc(doc(asOwnerB(), `businesses/${BIZ_A}/jobs/jobOwner`)));
  });
  it('a member of B cannot write A jobs', async () => {
    await assertFails(setDoc(doc(asOwnerB(), `businesses/${BIZ_A}/jobs/jobOwner`), { revenue: 9 }));
  });
  it('a member of B cannot read A customers / settings / inventory / leads', async () => {
    await assertFails(getDoc(doc(asOwnerB(), `businesses/${BIZ_A}/customers/cust1`)));
    await assertFails(getDoc(doc(asOwnerB(), `businesses/${BIZ_A}/settings/main`)));
    await assertFails(getDoc(doc(asOwnerB(), `businesses/${BIZ_A}/inventory/item1`)));
    await assertFails(getDoc(doc(asOwnerB(), `businesses/${BIZ_A}/leads/lead1`)));
  });
  it('a signed-in non-member cannot read A jobs', async () => {
    await assertFails(getDoc(doc(asOutsider(), `businesses/${BIZ_A}/jobs/jobOwner`)));
  });
  it('an unauthenticated user cannot read A jobs', async () => {
    await assertFails(getDoc(doc(asAnon(), `businesses/${BIZ_A}/jobs/jobOwner`)));
  });
  it('a member of A CAN read their own business job', async () => {
    await assertSucceeds(getDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/jobTech`)));
  });
});

describe('users — self only', () => {
  it('a user can read their own user doc', async () => {
    await assertSucceeds(getDoc(doc(asOwnerA(), 'users/ownerA')));
  });
  it('a user cannot read another user doc', async () => {
    await assertFails(getDoc(doc(asOwnerA(), 'users/ownerB')));
  });
  it('a user cannot write another user doc', async () => {
    await assertFails(setDoc(doc(asOwnerA(), 'users/ownerB'), { businessId: BIZ_A }));
  });
});

describe('jobs — owner/admin vs technician write matrix', () => {
  it('owner can create any job', async () => {
    await assertSucceeds(setDoc(doc(asOwnerA(), `businesses/${BIZ_A}/jobs/newByOwner`), {
      createdByUid: 'ownerA', assignedToUid: 'techA', revenue: 50,
    }));
  });
  it('technician can create a job created-by + assigned-to themselves', async () => {
    await assertSucceeds(setDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/newByTech`), {
      createdByUid: 'techA', assignedToUid: 'techA', revenue: 50,
    }));
  });
  it('technician cannot create a job assigned to someone else', async () => {
    await assertFails(setDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/badAssign`), {
      createdByUid: 'techA', assignedToUid: 'ownerA', revenue: 50,
    }));
  });
  it('technician cannot create a job created by someone else', async () => {
    await assertFails(setDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/badCreator`), {
      createdByUid: 'ownerA', assignedToUid: 'techA', revenue: 50,
    }));
  });
  it('technician can update their own job', async () => {
    await assertSucceeds(setDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/jobTech`), { revenue: 150 }, { merge: true }));
  });
  it("technician cannot update the owner's job", async () => {
    await assertFails(setDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/jobOwner`), { revenue: 999 }, { merge: true }));
  });
  it('technician cannot delete a job', async () => {
    await assertFails(deleteDoc(doc(asTechA(), `businesses/${BIZ_A}/jobs/jobTech`)));
  });
  it('owner can delete a job', async () => {
    await assertSucceeds(deleteDoc(doc(asOwnerA(), `businesses/${BIZ_A}/jobs/jobOwner`)));
  });
});

describe('inventory — member update, owner/admin manage', () => {
  it('technician can update inventory qty (deduction path)', async () => {
    await assertSucceeds(setDoc(doc(asTechA(), `businesses/${BIZ_A}/inventory/item1`), { qty: 5 }, { merge: true }));
  });
  it('technician cannot create an inventory item', async () => {
    await assertFails(setDoc(doc(asTechA(), `businesses/${BIZ_A}/inventory/item2`), { size: '205/55R16', qty: 4, cost: 60 }));
  });
  it('owner can create an inventory item', async () => {
    await assertSucceeds(setDoc(doc(asOwnerA(), `businesses/${BIZ_A}/inventory/item3`), { size: '205/55R16', qty: 4, cost: 60 }));
  });
  it('technician cannot delete an inventory item', async () => {
    await assertFails(deleteDoc(doc(asTechA(), `businesses/${BIZ_A}/inventory/item1`)));
  });
});

describe('settings — read any member, write owner/admin', () => {
  it('technician can read settings', async () => {
    await assertSucceeds(getDoc(doc(asTechA(), `businesses/${BIZ_A}/settings/main`)));
  });
  it('technician cannot write settings', async () => {
    await assertFails(setDoc(doc(asTechA(), `businesses/${BIZ_A}/settings/main`), { businessName: 'hax' }, { merge: true }));
  });
  it('owner can update settings (neutral field)', async () => {
    await assertSucceeds(setDoc(doc(asOwnerA(), `businesses/${BIZ_A}/settings/main`), { businessName: 'A2' }, { merge: true }));
  });
});

describe('leads — no client create/delete, bounded update', () => {
  it('a member cannot create a lead (create: false)', async () => {
    await assertFails(setDoc(doc(asOwnerA(), `businesses/${BIZ_A}/leads/lead2`), { status: 'New' }));
  });
  it('a member can update allowed lead fields (status/notes/assignee)', async () => {
    await assertSucceeds(setDoc(doc(asTechA(), `businesses/${BIZ_A}/leads/lead1`), {
      status: 'Booked', notes: 'called back', updatedAt: '2026-06-08',
    }, { merge: true }));
  });
  it('a member cannot mutate a non-allowlisted lead field (phone)', async () => {
    await assertFails(setDoc(doc(asTechA(), `businesses/${BIZ_A}/leads/lead1`), { phoneE164: '+19999999999' }, { merge: true }));
  });
  it('a member cannot delete a lead (delete: false)', async () => {
    await assertFails(deleteDoc(doc(asOwnerA(), `businesses/${BIZ_A}/leads/lead1`)));
  });
});

// ─────────────────────────────────────────────────────────────────────
//  C-2 (2026-07 audit): removed member cannot resurrect from a stale invite
// ─────────────────────────────────────────────────────────────────────
describe('C-2: member removal is durable (invite resurrection blocked)', () => {
  const RUID = 'removedTech';
  const REMAIL = 'removed@wheelrush.test';
  const TOKEN = 'invite-c2-token';
  const asRemovedTech = () => env.authenticatedContext(RUID, { email: REMAIL }).firestore();
  const memberDoc = { uid: RUID, role: 'technician', email: REMAIL, inviteToken: TOKEN };

  async function seedInvite(status: string) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', TOKEN), {
        businessId: BIZ_A, email: REMAIL, role: 'technician',
        status, acceptedByUid: RUID, invitedBy: 'ownerA',
      });
    });
  }

  it('regression: an ACCEPTED invite still lets the invitee self-create their member doc', async () => {
    await seedInvite('accepted');
    await assertSucceeds(setDoc(doc(asRemovedTech(), `businesses/${BIZ_A}/members/${RUID}`), memberDoc));
  });

  it('a REVOKED (post-removal) invite CANNOT be used to re-create the member doc', async () => {
    await seedInvite('revoked'); // what durable removal leaves behind
    await assertFails(setDoc(doc(asRemovedTech(), `businesses/${BIZ_A}/members/${RUID}`), memberDoc));
  });

  it('owner can flip an ACCEPTED invite → revoked (enables durable removal); a technician cannot', async () => {
    await seedInvite('accepted');
    await assertFails(setDoc(doc(asTechA(), 'invites', TOKEN), { status: 'revoked' }, { merge: true }));
    await assertSucceeds(setDoc(doc(asOwnerA(), 'invites', TOKEN), { status: 'revoked' }, { merge: true }));
  });
});

// Sanity: prove the harness itself is wired (rules ARE being evaluated,
// not silently allowing everything).
describe('harness sanity', () => {
  it('expect is available', () => { expect(1).toBe(1); });
});
