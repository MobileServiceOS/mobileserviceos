// ═══════════════════════════════════════════════════════════════════
//  tests/ownedBusinesses.test.ts — Stage 2 multi-business tests
// ═══════════════════════════════════════════════════════════════════
//  Run: npx tsx tests/ownedBusinesses.test.ts
//
//  Verifies the multi-business model + Pro gating, and proves the
//  back-compat guarantee: a pre-Stage-2 user (no ownedBusinesses
//  field) resolves to exactly one business with no switcher.
// ═══════════════════════════════════════════════════════════════════

import {
  getOwnedBusinesses,
  maxBusinessesForPlan,
  canCreateAnotherBusiness,
  hasMultipleBusinesses,
  resolveActiveBusinessId,
  type UserBusinessDoc,
} from '../src/lib/ownedBusinesses';
import type { Settings } from '../src/types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
function section(t: string): void { console.log(`\n${t}`); }

const UID = 'user-abc';
const B2 = 'biz-second';
const B3 = 'biz-third';

// Plan fixtures. Note: during growth mode resolvePlan() returns 'pro'
// for every account, so the "core" fixture only behaves as Core when
// growth mode is off. Tests below account for both possibilities.
const coreSettings = { subscriptionStatus: 'active', plan: 'core' } as unknown as Settings;
const proSettings = { subscriptionStatus: 'active', plan: 'pro' } as unknown as Settings;

section('BACK-COMPAT — pre-Stage-2 user (no ownedBusinesses field)');
{
  const oldUserDoc: UserBusinessDoc = { businessId: UID }; // no ownedBusinesses
  const owned = getOwnedBusinesses(UID, oldUserDoc);
  check('resolves to exactly one business', owned.length === 1);
  check('that business is the user uid', owned[0] === UID);
  check('no switcher shown (single business)', hasMultipleBusinesses(UID, oldUserDoc) === false);
  check('active business is the uid', resolveActiveBusinessId(UID, oldUserDoc) === UID);
}

section('BACK-COMPAT — null user doc entirely');
{
  check('null doc -> one business [uid]', getOwnedBusinesses(UID, null).length === 1);
  check('null doc -> active is uid', resolveActiveBusinessId(UID, null) === UID);
  check('null doc -> no switcher', hasMultipleBusinesses(UID, null) === false);
}

section('MULTI-BUSINESS — user owns three');
{
  const doc: UserBusinessDoc = { businessId: UID, ownedBusinesses: [UID, B2, B3] };
  const owned = getOwnedBusinesses(UID, doc);
  check('resolves all three', owned.length === 3);
  check('uid is first', owned[0] === UID);
  check('switcher IS shown', hasMultipleBusinesses(UID, doc) === true);
}

section('DEFENSIVE — uid missing from stored array');
{
  // Malformed: ownedBusinesses somehow lacks the user's own uid.
  const doc: UserBusinessDoc = { businessId: UID, ownedBusinesses: [B2, B3] };
  const owned = getOwnedBusinesses(UID, doc);
  check('uid is force-added', owned.includes(UID));
  check('uid is first even when missing from stored array', owned[0] === UID);
  check('no duplicates', new Set(owned).size === owned.length);
}

section('DEFENSIVE — duplicate ids in stored array');
{
  const doc: UserBusinessDoc = { businessId: UID, ownedBusinesses: [UID, B2, B2, UID] };
  const owned = getOwnedBusinesses(UID, doc);
  check('duplicates removed', owned.length === 2);
}

section('PRO GATING — business allowance per plan');
{
  // maxBusinessesForPlan depends on resolvePlan(). Under growth mode
  // BOTH fixtures resolve to 'pro' (unlimited). With billing on, the
  // core fixture is limited to 1. Assert the Pro path strictly, and
  // assert the core path is EITHER 1 (billing on) OR Infinity (growth).
  const proMax = maxBusinessesForPlan(proSettings);
  check('Pro plan -> unlimited businesses', proMax === Infinity);

  const coreMax = maxBusinessesForPlan(coreSettings);
  check('Core plan -> 1 (billing on) or unlimited (growth mode)',
    coreMax === 1 || coreMax === Infinity,
    `got ${coreMax}`);
}

section('PRO GATING — canCreateAnotherBusiness');
{
  // Pro user with 1 business -> can always create another.
  check('Pro + owns 1 -> can create', canCreateAnotherBusiness(proSettings, 1) === true);
  check('Pro + owns 5 -> can create', canCreateAnotherBusiness(proSettings, 5) === true);

  // Core user with 1 business: blocked when billing is on, allowed
  // under growth mode. Assert it matches maxBusinessesForPlan.
  const coreMax = maxBusinessesForPlan(coreSettings);
  const expectCore = 1 < coreMax;
  check('Core + owns 1 -> matches plan allowance',
    canCreateAnotherBusiness(coreSettings, 1) === expectCore);
}

section('ACTIVE BUSINESS — last-choice restore');
{
  const doc: UserBusinessDoc = { businessId: UID, ownedBusinesses: [UID, B2, B3], activeBusinessId: B2 };
  check('restores last-active business', resolveActiveBusinessId(UID, doc) === B2);

  // Last-active points at a business the user no longer owns.
  const stale: UserBusinessDoc = { businessId: UID, ownedBusinesses: [UID, B2], activeBusinessId: 'biz-deleted' };
  check('stale active id falls back to primary', resolveActiveBusinessId(UID, stale) === UID);
}

console.log(`\n${'═'.repeat(56)}`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
console.log('═'.repeat(56));
if (failed > 0) process.exit(1);
