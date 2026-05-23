// tests/teamRoleChange.test.ts
// Run: npx tsx tests/teamRoleChange.test.ts

import {
  canChangeRole, canRemoveMember, isLastOwner,
} from '@/lib/teamRoleChange';
import type { Role } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const ctx = (
  actorRole: Role, targetCurrentRole: Role,
  over: Partial<{ isSelf: boolean; isLastOwner: boolean }> = {},
) => ({ actorRole, targetCurrentRole, isSelf: false, isLastOwner: false, ...over });

console.log('\n┌─ isLastOwner ─────────────────────────────────────');
check('one owner → true',
  isLastOwner([{ uid: 'a', role: 'owner' }, { uid: 'b', role: 'admin' }], 'a'));
check('two owners → false',
  !isLastOwner([{ uid: 'a', role: 'owner' }, { uid: 'b', role: 'owner' }], 'a'));
check('target is not an owner → false',
  !isLastOwner([{ uid: 'a', role: 'owner' }, { uid: 'b', role: 'admin' }], 'b'));
check('missing uid → false',
  !isLastOwner([{ role: 'owner' }, { uid: 'b', role: 'admin' }], 'a'));

console.log('\n┌─ canChangeRole — owner actor ─────────────────────');
check('owner → promote tech to admin',
  canChangeRole(ctx('owner', 'technician'), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('owner → promote tech to owner',
  canChangeRole(ctx('owner', 'technician'), { kind: 'changeRole', toRole: 'owner' }).allowed);
check('owner → demote admin to tech',
  canChangeRole(ctx('owner', 'admin'), { kind: 'changeRole', toRole: 'technician' }).allowed);
check('owner → demote co-owner to admin (≥2 owners)',
  canChangeRole(ctx('owner', 'owner', { isLastOwner: false }), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('owner → demote LAST owner → rejected',
  !canChangeRole(ctx('owner', 'owner', { isLastOwner: true, isSelf: true }), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('owner → no-op same role → rejected',
  !canChangeRole(ctx('owner', 'admin'), { kind: 'changeRole', toRole: 'admin' }).allowed);

console.log('\n┌─ canChangeRole — admin actor ─────────────────────');
check('admin → promote tech to admin',
  canChangeRole(ctx('admin', 'technician'), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('admin → demote admin to tech',
  canChangeRole(ctx('admin', 'admin'), { kind: 'changeRole', toRole: 'technician' }).allowed);
check('admin → promote tech to OWNER → rejected',
  !canChangeRole(ctx('admin', 'technician'), { kind: 'changeRole', toRole: 'owner' }).allowed);
check('admin → promote admin to OWNER → rejected',
  !canChangeRole(ctx('admin', 'admin'), { kind: 'changeRole', toRole: 'owner' }).allowed);
check('admin → demote owner → rejected',
  !canChangeRole(ctx('admin', 'owner'), { kind: 'changeRole', toRole: 'admin' }).allowed);

console.log('\n┌─ canChangeRole — technician actor ────────────────');
check('tech cannot change any role',
  !canChangeRole(ctx('technician', 'technician'), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('tech cannot promote self',
  !canChangeRole(ctx('technician', 'technician', { isSelf: true }), { kind: 'changeRole', toRole: 'admin' }).allowed);

console.log('\n┌─ canRemoveMember ─────────────────────────────────');
check('owner removes tech',
  canRemoveMember(ctx('owner', 'technician')).allowed);
check('owner removes admin',
  canRemoveMember(ctx('owner', 'admin')).allowed);
check('owner removes co-owner (≥2 owners)',
  canRemoveMember(ctx('owner', 'owner', { isLastOwner: false })).allowed);
check('owner removes LAST owner → rejected',
  !canRemoveMember(ctx('owner', 'owner', { isLastOwner: true })).allowed);
check('admin removes tech',
  canRemoveMember(ctx('admin', 'technician')).allowed);
check('admin removes admin (non-self)',
  canRemoveMember(ctx('admin', 'admin')).allowed);
check('admin removes owner → rejected',
  !canRemoveMember(ctx('admin', 'owner')).allowed);
check('tech removes anyone → rejected',
  !canRemoveMember(ctx('technician', 'technician')).allowed);

console.log('\n┌─ verdict reason ──────────────────────────────────');
check('rejected verdict has a non-empty reason',
  (() => {
    const v = canRemoveMember(ctx('admin', 'owner'));
    return !v.allowed && typeof v.reason === 'string' && v.reason.length > 0;
  })());

console.log(`\n  ${passed} passed, ${failed} failed`);
