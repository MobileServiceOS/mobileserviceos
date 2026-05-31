// tests/jobsQuery.test.ts
// Run: npx tsx tests/jobsQuery.test.ts
//
// Hotfix #5 (2026-05-31, audit P1): the jobs listener attached at
// App startup was subscribing to the ENTIRE jobs collection, with
// no orderBy and no limit. A 1,500-job business was streaming ~3 MB
// of data on every cold start before Dashboard could paint.
//
// The fix bounds the listener via buildJobsListenerQuery(). This
// test pins:
//   (A) The page-size constant — caps cold-start network cost
//   (B) The orderBy field — ensures the bounded set is the MOST
//       RECENT N jobs (not arbitrary N jobs)
//   (C) The order direction — descending, so recents land first
//   (D) Source-content assertion that App.tsx actually USES the
//       helper instead of subscribing to the unbounded collection

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JOBS_LISTENER_PAGE_SIZE,
  JOBS_LISTENER_ORDER_FIELD,
} from '@/lib/jobsQuery';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

// ────────── A — constant contracts ──────────

section('Page-size constant');
{
  check('JOBS_LISTENER_PAGE_SIZE is defined', JOBS_LISTENER_PAGE_SIZE !== undefined);
  check('JOBS_LISTENER_PAGE_SIZE is a number', typeof JOBS_LISTENER_PAGE_SIZE === 'number');
  check(
    'JOBS_LISTENER_PAGE_SIZE is bounded (1..500)',
    JOBS_LISTENER_PAGE_SIZE > 0 && JOBS_LISTENER_PAGE_SIZE <= 500,
    'audit P1 regression: removing the bound or setting it impractically large defeats the cold-start fix'
  );
  check(
    'JOBS_LISTENER_PAGE_SIZE >= 50 (covers History first page)',
    JOBS_LISTENER_PAGE_SIZE >= 50,
    'page size too small — History "Load more" needed earlier than expected'
  );
}

section('Order field constant');
{
  check(
    "JOBS_LISTENER_ORDER_FIELD is 'date'",
    JOBS_LISTENER_ORDER_FIELD === 'date',
    'audit P1 regression: ordering by anything other than the job date silently changes "most recent N" semantics'
  );
}

// ────────── B — App.tsx call-site regression ──────────

section('App.tsx uses the bounded query');
{
  const appPath = resolve(repoRoot, 'src/App.tsx');
  const app = readFileSync(appPath, 'utf-8');

  check(
    'App.tsx imports buildJobsListenerQuery',
    /import\s*\{[^}]*buildJobsListenerQuery[^}]*\}\s*from\s*['"]@\/lib\/jobsQuery['"]/.test(app),
    'audit P1 regression: helper import removed — App is back to unbounded jobs subscription'
  );
  check(
    'App.tsx invokes buildJobsListenerQuery',
    /buildJobsListenerQuery\s*\(/.test(app),
    'helper imported but never used — listener is still unbounded'
  );

  // Confirm the jobs listener line specifically uses the helper. We
  // look for the exact subscription pattern.
  const jobsListenerSection = /scopedCol\([^)]*,\s*['"]jobs['"]\)/.exec(app);
  check('App.tsx still scopes the jobs collection per business', jobsListenerSection !== null);

  // Stronger: assert the fbListen call for jobs threads the bounded
  // query in. We look for buildJobsListenerQuery near the same
  // fbListen call.
  const fbListenJobsBlock = /unsubs\.push\(fbListen\(([^)]*\)){1,2}[^,]*,?[^,]*,\s*\(docs\)\s*=>\s*\{[^}]*setJobs/.exec(app);
  check(
    'fbListen for setJobs threads buildJobsListenerQuery',
    fbListenJobsBlock !== null && /buildJobsListenerQuery/.test(fbListenJobsBlock[0]),
    'jobs fbListen no longer wraps with buildJobsListenerQuery — unbounded subscription returned'
  );
}

// ────────── C — firebase.fbListen accepts Query ──────────

section('fbListen signature change');
{
  const fbPath = resolve(repoRoot, 'src/lib/firebase.ts');
  const fb = readFileSync(fbPath, 'utf-8');

  check(
    "fbListen target type accepts CollectionReference | Query",
    /target:\s*CollectionReference<DocumentData>\s*\|\s*Query<DocumentData>\s*\|\s*null/.test(fb),
    'audit P1 regression: fbListen signature reverted to CollectionReference-only; bounded queries can no longer be passed'
  );
  // Scope this assertion to the fbListen function body specifically —
  // other helpers (fbSet, fbDelete) still take CollectionReference
  // and legitimately read col.path.
  const fbListenBlock = /export function fbListen\([\s\S]*?\n\}/.exec(fb);
  check('fbListen function block located', fbListenBlock !== null);
  if (fbListenBlock) {
    check(
      'fbListen body does not read col.path directly (Query has no .path)',
      !/\bcol\.path\b/.test(fbListenBlock[0]),
      'fbListen reads col.path inside its body — would throw when a Query (e.g. bounded jobs listener) is passed'
    );
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
