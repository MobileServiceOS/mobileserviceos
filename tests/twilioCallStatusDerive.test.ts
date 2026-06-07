// tests/twilioCallStatusDerive.test.ts
// Run: npx tsx tests/twilioCallStatusDerive.test.ts
//
// Pure call-analytics derivation from a Twilio status-callback form:
// answered requires a completed status AND real talk time; status
// mapping; optional answeredBy / recordingUrl; direction.

import { __testHooks } from '../functions/src/twilioCallStatus';

const { deriveCall, mapStatus } = __testHooks;

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

function form(over: Record<string, string> = {}): Record<string, string> {
  return { CallSid: 'CA1', From: '+13055551234', To: '+15555550000', Direction: 'inbound', CallStatus: 'completed', CallDuration: '120', ...over };
}

console.log('\n── mapStatus ──');
{
  check('completed → completed', mapStatus('completed') === 'completed');
  check('no-answer → no-answer', mapStatus('no-answer') === 'no-answer');
  check('busy → busy', mapStatus('BUSY') === 'busy');
  check('unknown → failed', mapStatus('weird') === 'failed');
}

console.log('\n── deriveCall: answered ──');
{
  const c = deriveCall(form())!;
  check('status completed', c.status === 'completed');
  check('answered true (completed + duration>0)', c.answered === true);
  check('durationSec = 120', c.durationSec === 120);
  check('direction inbound', c.direction === 'inbound');
}

console.log('\n── deriveCall: missed ──');
{
  const c = deriveCall(form({ CallStatus: 'no-answer', CallDuration: '0' }))!;
  check('status no-answer', c.status === 'no-answer');
  check('answered false', c.answered === false);
  check('durationSec 0', c.durationSec === 0);
}

console.log('\n── deriveCall: completed but zero duration → NOT answered ──');
{
  const c = deriveCall(form({ CallStatus: 'completed', CallDuration: '0' }))!;
  check('answered false when duration 0', c.answered === false);
}

console.log('\n── deriveCall: DialCallStatus precedence + outbound ──');
{
  const c = deriveCall(form({ Direction: 'outbound-dial', DialCallStatus: 'busy', CallStatus: 'completed' }))!;
  check('DialCallStatus wins (busy)', c.status === 'busy');
  check('direction outbound', c.direction === 'outbound');
}

console.log('\n── deriveCall: metadata only — no recording/transcript fields ──');
{
  const c = deriveCall(form({ RecordingUrl: 'https://r/x', AnsweredBy: 'human' })) as Record<string, unknown>;
  check('no recordingUrl captured', !('recordingUrl' in c));
  check('no answeredBy captured', !('answeredBy' in c));
}

console.log('\n── deriveCall: missing CallSid → null ──');
{
  check('null when no CallSid', deriveCall(form({ CallSid: '' })) === null);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
