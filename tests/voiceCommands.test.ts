// tests/voiceCommands.test.ts
// Run: npx tsx tests/voiceCommands.test.ts
//
// Deterministic voice-command parser: transcript → typed intent. No AI.

import { parseVoiceCommand } from '@/lib/voiceCommands';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── navigation ──');
{
  const nav = (s: string) => parseVoiceCommand(s);
  check('open inventory → inventory', (() => { const i = nav('open inventory'); return i.type === 'navigate' && i.tab === 'inventory'; })());
  check('go to leads → leads', (() => { const i = nav('go to leads'); return i.type === 'navigate' && i.tab === 'leads'; })());
  check('show customers → customers', (() => { const i = nav('show me my customers'); return i.type === 'navigate' && i.tab === 'customers'; })());
  check('pull up settings → settings', (() => { const i = nav('pull up settings'); return i.type === 'navigate' && i.tab === 'settings'; })());
  check('job history → history tab', (() => { const i = nav('open job history'); return i.type === 'navigate' && i.tab === 'history'; })());
  check('bare "home" → dashboard', (() => { const i = nav('home'); return i.type === 'navigate' && i.tab === 'dashboard'; })());
}

console.log('\n── metric answers (checked before Jobs nav) ──');
{
  check("today's revenue → revenueToday", parseVoiceCommand("what's today's revenue").type === 'metric' && (parseVoiceCommand("today's revenue") as { metric: string }).metric === 'revenueToday');
  check('how much did we make today → revenueToday', (parseVoiceCommand('how much did we make today') as { metric?: string }).metric === 'revenueToday');
  check('profit today → profitToday', (parseVoiceCommand('profit today') as { metric?: string }).metric === 'profitToday');
  check('jobs completed today → jobsToday', (parseVoiceCommand('how many jobs completed today') as { metric?: string }).metric === 'jobsToday');
  check('jobs today → jobsToday (NOT Jobs nav)', (() => { const i = parseVoiceCommand('jobs today'); return i.type === 'metric' && i.metric === 'jobsToday'; })());
}

console.log('\n── new job ──');
{
  check('log a job → newJob', parseVoiceCommand('log a job').type === 'newJob');
  check('new job → newJob', parseVoiceCommand('new job').type === 'newJob');
  check('start a job → newJob', parseVoiceCommand('start a job').type === 'newJob');
}

console.log('\n── unknown / empty ──');
{
  check('gibberish → unknown', parseVoiceCommand('banana helicopter').type === 'unknown');
  check('empty → unknown', parseVoiceCommand('').type === 'unknown');
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
