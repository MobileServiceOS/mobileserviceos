// tests/syncState.test.ts
// Run: npx tsx tests/syncState.test.ts
//
// Pure-singleton coverage for the sync-state tracker:
//   - pending count goes up on issue, down on ack/fail (never < 0)
//   - lastSyncedAt is set only by successful ACKs
//   - successful ACK clears the failed badge
//   - subscribers receive snapshots on every change
//   - subscriber unsubscribe stops further emissions

import {
  getSyncState,
  subscribeSyncState,
  noteWriteIssued,
  noteWriteAcked,
  noteWriteFailed,
  _resetSyncStateForTests,
} from '@/lib/syncState';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
};

// ─── counters ──────────────────────────────────────────────────────
console.log('\n┌─ pendingWrites counter ───────────────────────────');
_resetSyncStateForTests();
check('initial pendingWrites = 0',
  getSyncState().pendingWrites === 0);
noteWriteIssued();
noteWriteIssued();
check('after 2 issues → pending 2',
  getSyncState().pendingWrites === 2);
noteWriteAcked();
check('after 1 ack → pending 1',
  getSyncState().pendingWrites === 1);
noteWriteFailed();
check('after 1 fail → pending 0',
  getSyncState().pendingWrites === 0);
noteWriteAcked();
check('extra ack with no pending → pending stays at 0 (no underflow)',
  getSyncState().pendingWrites === 0);
noteWriteFailed();
check('extra fail with no pending → pending stays at 0 (no underflow)',
  getSyncState().pendingWrites === 0);

// ─── lastSyncedAt ──────────────────────────────────────────────────
console.log('\n┌─ lastSyncedAt ────────────────────────────────────');
_resetSyncStateForTests();
check('initial lastSyncedAt is null',
  getSyncState().lastSyncedAt === null);
noteWriteIssued();
noteWriteFailed();
check('failure alone does not set lastSyncedAt',
  getSyncState().lastSyncedAt === null);
noteWriteIssued();
noteWriteAcked();
check('successful ack sets lastSyncedAt to an ISO timestamp',
  (() => {
    const t = getSyncState().lastSyncedAt;
    return typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(t);
  })());

// ─── failed count + clear-on-success ────────────────────────────────
console.log('\n┌─ failedWrites + clear-on-success ─────────────────');
_resetSyncStateForTests();
noteWriteIssued(); noteWriteFailed();
noteWriteIssued(); noteWriteFailed();
check('two failures → failedWrites = 2',
  getSyncState().failedWrites === 2);
noteWriteIssued(); noteWriteAcked();
check('a successful ack clears failedWrites back to 0',
  getSyncState().failedWrites === 0);

// ─── subscribers ────────────────────────────────────────────────────
console.log('\n┌─ subscribers ─────────────────────────────────────');
_resetSyncStateForTests();
let snapshotsSeen = 0;
const unsub = subscribeSyncState(() => { snapshotsSeen++; });
check('subscribe fires immediately with the current state',
  snapshotsSeen === 1);
noteWriteIssued();
check('issue triggers another emission',
  snapshotsSeen === 2);
noteWriteAcked();
check('ack triggers another emission',
  snapshotsSeen === 3);
unsub();
noteWriteIssued();
check('after unsubscribe, no further emissions',
  snapshotsSeen === 3);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
