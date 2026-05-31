// tests/inviteCreateRule.test.ts
// Run: npx tsx tests/inviteCreateRule.test.ts
//
// Regression guard for the 2026-05-31 hotfix:
// The Firestore invite-create rule must require isOwnerOrAdmin(...)
// in addition to the businessId match. Removing this guard re-opens
// the technician → admin self-promotion path (audit P1).
//
// We can't run actual Firestore Rules without the emulator from
// this test runner, so this is a content-level guard: it parses
// firestore.rules, locates the `match /invites/{token}` block, and
// asserts the CREATE rule contains the role check.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

const rulesPath = resolve(__dirname, '..', 'firestore.rules');
const rules = readFileSync(rulesPath, 'utf-8');

// Extract the invites block. Greedy enough to capture create+update+delete.
const invitesMatch = /match\s+\/invites\/\{token\}\s*\{([\s\S]*?)\n\s{4}\}/.exec(rules);

section('Rules file shape');
check('firestore.rules is readable', rules.length > 0);
check('contains match /invites/{token}', invitesMatch !== null,
  'rules file may have been restructured; update this test if so');

if (invitesMatch) {
  const invitesBlock = invitesMatch[1];

  // Extract the CREATE rule specifically. The CREATE clause ends at the
  // semicolon that follows the chained `&&` conditions.
  const createMatch = /allow\s+create\s*:\s*if([\s\S]*?);/m.exec(invitesBlock);

  section('Invite CREATE rule');
  check('contains an `allow create` clause', createMatch !== null);

  if (createMatch) {
    const createRule = createMatch[1];

    // The pre-fix rule had only a businessId match. Post-fix must
    // include the role guard. We don't pin the exact spelling so the
    // test stays robust to minor formatting changes — we just require
    // the substring `isOwnerOrAdmin(` somewhere in the CREATE clause.
    check(
      'CREATE requires isOwnerOrAdmin (role guard)',
      /isOwnerOrAdmin\s*\(/.test(createRule),
      'audit P1 regression — invite create rule no longer gates the inviter role; a technician can self-promote to admin'
    );

    // Other pre-existing guards must remain — defensive against an
    // over-eager rewrite that accidentally weakens the rule while
    // adding the role check.
    check(
      'CREATE still requires businessId match',
      /businessId\s*==\s*userBusinessId\(\)/.test(createRule),
      'businessId guard removed — the role check alone is not enough'
    );
    check(
      'CREATE still restricts role to admin|technician',
      /role\s*==\s*['"]admin['"]/.test(createRule) &&
        /role\s*==\s*['"]technician['"]/.test(createRule),
      'role-value restriction removed — owner-role invites become possible'
    );
    check(
      'CREATE still pins status to pending',
      /status\s*==\s*['"]pending['"]/.test(createRule),
      'status pre-pin removed'
    );
    check(
      'CREATE still requires invitedBy == request.auth.uid',
      /invitedBy\s*==\s*request\.auth\.uid/.test(createRule),
      'attribution guard removed'
    );
    check(
      'CREATE still pins token field to doc id',
      /token\s*==\s*token/.test(createRule),
      'token mismatch guard removed'
    );
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
