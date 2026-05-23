// tests/invites.test.ts
// Run: npx tsx tests/invites.test.ts
//
// Pure-logic coverage for the invite acceptance decision tree.
// validateInvite is the single helper every surface uses to decide
// whether an invite can be loaded / accepted — keeping its tests
// exhaustive locks the UX of the entire invite flow.

import { validateInvite } from '@/lib/inviteValidation';
import type { InviteDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
};

const NOW = Date.parse('2026-05-22T12:00:00Z');
const FUTURE = '2026-06-05T12:00:00Z';
const PAST   = '2026-05-01T12:00:00Z';

const base = (over: Partial<InviteDoc> = {}): InviteDoc => ({
  id: 'tkn',
  token: 'tkn',
  email: 'tech@example.com',
  businessId: 'biz-1',
  role: 'technician',
  status: 'pending',
  invitedBy: 'owner-uid',
  invitedAt: '2026-05-20T12:00:00Z',
  expiresAt: FUTURE,
  ...over,
});

// ─── Existence ──────────────────────────────────────────────────────
console.log('\n┌─ validateInvite — existence ──────────────────────');
check('null invite → invalid',
  validateInvite(null, { now: NOW }).ok === false);
check('null invite → friendly reason mentions invalid',
  validateInvite(null, { now: NOW }).ok === false &&
  /invalid|no longer/i.test((validateInvite(null, { now: NOW }) as { reason: string }).reason));

// ─── Status states ──────────────────────────────────────────────────
console.log('\n┌─ validateInvite — status states ──────────────────');
check('pending + future expiry → ok',
  validateInvite(base(), { now: NOW }).ok === true);
check('revoked → invalid',
  validateInvite(base({ status: 'revoked' }), { now: NOW }).ok === false);
check('revoked → mentions revoked',
  /revoked/i.test((validateInvite(base({ status: 'revoked' }), { now: NOW }) as { reason: string }).reason));
check('expired (status) → invalid',
  validateInvite(base({ status: 'expired' }), { now: NOW }).ok === false);
check('expired (status) → mentions expired',
  /expired/i.test((validateInvite(base({ status: 'expired' }), { now: NOW }) as { reason: string }).reason));
check('accepted (different user) → invalid',
  validateInvite(base({ status: 'accepted', acceptedByUid: 'other-uid' }), { now: NOW }).ok === false);
check('accepted (different user) → mentions already accepted',
  /already.*accept/i.test((validateInvite(base({ status: 'accepted', acceptedByUid: 'other-uid' }), { now: NOW }) as { reason: string }).reason));

// ─── Idempotency: same user re-accepting ────────────────────────────
console.log('\n┌─ validateInvite — idempotency ────────────────────');
check('accepted by same uid → ok (idempotent replay)',
  validateInvite(
    base({ status: 'accepted', acceptedByUid: 'this-tech-uid' }),
    { now: NOW, authUid: 'this-tech-uid' },
  ).ok === true);
check('accepted by different uid even when authUid given → invalid',
  validateInvite(
    base({ status: 'accepted', acceptedByUid: 'someone-else' }),
    { now: NOW, authUid: 'this-tech-uid' },
  ).ok === false);

// ─── Expiry by date (status still pending) ──────────────────────────
console.log('\n┌─ validateInvite — expiry by date ─────────────────');
check('pending but expiresAt in past → invalid',
  validateInvite(base({ expiresAt: PAST }), { now: NOW }).ok === false);
check('pending past-expiry → reason mentions expired',
  /expired/i.test((validateInvite(base({ expiresAt: PAST }), { now: NOW }) as { reason: string }).reason));
check('pending + expiresAt undefined → ok (no expiry enforced)',
  validateInvite(base({ expiresAt: undefined as unknown as string }), { now: NOW }).ok === true);
check('pending + expiresAt malformed → ok (treated as no expiry)',
  validateInvite(base({ expiresAt: 'not-a-date' }), { now: NOW }).ok === true);

// ─── Email match ─────────────────────────────────────────────────────
console.log('\n┌─ validateInvite — email match ────────────────────');
check('email match (lowercase) → ok',
  validateInvite(base(), { now: NOW, authEmail: 'tech@example.com' }).ok === true);
check('email match (uppercase incoming) → ok via normalization',
  validateInvite(base(), { now: NOW, authEmail: 'Tech@Example.COM' }).ok === true);
check('email mismatch → invalid',
  validateInvite(base(), { now: NOW, authEmail: 'other@example.com' }).ok === false);
check('email mismatch → reason names BOTH emails',
  (() => {
    const r = validateInvite(base(), { now: NOW, authEmail: 'other@example.com' });
    return r.ok === false && r.reason.includes('tech@example.com') && r.reason.includes('other@example.com');
  })());
check('email mismatch → tells user to sign out / get new invite',
  (() => {
    const r = validateInvite(base(), { now: NOW, authEmail: 'other@example.com' });
    return r.ok === false && /sign out|new invite/i.test(r.reason);
  })());
check('email not provided → email check skipped (preview render)',
  validateInvite(base(), { now: NOW }).ok === true);

// ─── Compound scenarios ─────────────────────────────────────────────
console.log('\n┌─ validateInvite — compound ───────────────────────');
check('expired AND email mismatch → expired wins (most actionable)',
  (() => {
    const r = validateInvite(base({ expiresAt: PAST }), { now: NOW, authEmail: 'other@example.com' });
    return r.ok === false && /expired/i.test(r.reason);
  })());
check('revoked AND email mismatch → revoked wins',
  (() => {
    const r = validateInvite(base({ status: 'revoked' }), { now: NOW, authEmail: 'other@example.com' });
    return r.ok === false && /revoked/i.test(r.reason);
  })());

// ─── Friendly-message invariant ─────────────────────────────────────
console.log('\n┌─ validateInvite — friendly message invariant ─────');
const NEVER_LEAK = [
  /permission[- ]denied/i,
  /firestore/i,
  /firebase/i,
  /FirebaseError/,
  /\bcode:\s*['"]/i,
];
const scenarios: Array<[string, InviteDoc | null, { now?: number; authEmail?: string; authUid?: string }?]> = [
  ['null invite', null],
  ['revoked',  base({ status: 'revoked' })],
  ['expired (date)', base({ expiresAt: PAST })],
  ['already accepted', base({ status: 'accepted', acceptedByUid: 'x' })],
  ['email mismatch', base(), { authEmail: 'other@example.com', now: NOW }],
];
for (const [label, invite, opts] of scenarios) {
  const r = validateInvite(invite, opts ?? { now: NOW });
  if (r.ok) continue; // ok branches don't carry messages
  const clean = !NEVER_LEAK.some((rx) => rx.test(r.reason));
  check(`"${label}" reason is human-readable (no raw codes / firebase / firestore)`, clean);
}

// ─── Whitespace + casing in auth email ─────────────────────────────
console.log('\n┌─ validateInvite — email normalization edges ──────');
check('authEmail with leading/trailing whitespace → matches',
  validateInvite(base(), { now: NOW, authEmail: '  tech@example.com  ' }).ok === true);
check('authEmail with newline → matches via trim',
  validateInvite(base(), { now: NOW, authEmail: 'tech@example.com\n' }).ok === true);
check('authEmail empty string → email check skipped, falls back to ok',
  validateInvite(base(), { now: NOW, authEmail: '' }).ok === true);

// ─── Role variants on the invite ────────────────────────────────────
// validateInvite itself doesn't gate on role (the rule does), but it
// must not crash for any documented role value.
console.log('\n┌─ validateInvite — role variants ──────────────────');
check('invite role=technician → ok',
  validateInvite(base({ role: 'technician' }), { now: NOW }).ok === true);
check('invite role=admin → ok',
  validateInvite(base({ role: 'admin' }), { now: NOW }).ok === true);

// ─── Expiry boundary ────────────────────────────────────────────────
console.log('\n┌─ validateInvite — expiry boundary ────────────────');
const EXACT = '2026-05-22T12:00:00Z';
check('expiresAt exactly equals now → ok (only STRICTLY less-than rejects)',
  validateInvite(base({ expiresAt: EXACT }), { now: NOW }).ok === true);
check('expiresAt 1ms before now → invalid',
  validateInvite(base({ expiresAt: '2026-05-22T11:59:59.999Z' }), { now: NOW }).ok === false);
check('expiresAt 1ms after now → ok',
  validateInvite(base({ expiresAt: '2026-05-22T12:00:00.001Z' }), { now: NOW }).ok === true);

// ─── Idempotency interplay with email mismatch ──────────────────────
// If invite is accepted by uid X and a DIFFERENT email-y user comes
// along, validateInvite should still reject — the same-uid replay is
// the only ok path.
console.log('\n┌─ validateInvite — idempotency vs wrong email ─────');
check('accepted by other uid AND wrong-email auth → invalid (both reasons fail closed)',
  validateInvite(
    base({ status: 'accepted', acceptedByUid: 'someone' }),
    { now: NOW, authUid: 'this-tech', authEmail: 'other@example.com' },
  ).ok === false);
check('accepted by this uid AND wrong-email auth → still ok (idempotent wins, no further checks)',
  validateInvite(
    base({ status: 'accepted', acceptedByUid: 'this-tech' }),
    { now: NOW, authUid: 'this-tech', authEmail: 'other@example.com' },
  ).ok === true);

// ─── Owner-inviting-self defense (covered at acceptInvite layer) ────
// validateInvite doesn't have the existing-member context, but a
// pending invite that happens to be issued to the owner's email
// still resolves as "ok" here. The idempotency probe inside
// acceptInvite is what actually protects the owner from demotion.
// This test simply documents the boundary.
console.log('\n┌─ validateInvite — boundary documentation ─────────');
check('pending invite to a user (any role context) → ok at this layer',
  validateInvite(
    base({ email: 'owner@example.com', role: 'technician' }),
    { now: NOW, authEmail: 'owner@example.com', authUid: 'owner-uid' },
  ).ok === true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
