# AI Voice Logging (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 🎤 button at the top of the Add Job form that captures a spoken job description, parses it via the AI proxy, and offers the extracted fields in a chip-based review-before-apply bottom sheet — never auto-saving, never overwriting without consent.

**Architecture:** Browser `SpeechRecognition` does STT in a thin `useVoiceRecorder` hook (no audio through the proxy). A pure `voiceParser.ts` packages the transcript with the active vertical's allowed enums for grounding and validates the AI's JSON reply against those enums. A new `voice_parse` proxy task owns the prompt server-side. The Add Job page wires the mic button (press-and-hold OR tap-to-toggle) and a `VoicePreviewSheet` that applies survived chips with a brief field highlight. Tech-safe mode hides the revenue chip for the technician role.

**Tech Stack:** TypeScript, React 18, Vite; Cloudflare Worker (`ai-proxy/`); hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-ai-voice-logging-design.md`

---

## File Structure

- **Create `src/lib/voiceParser.ts`** — pure module. Owns `VoiceParseInput`, `VoiceParseFields`, `VoiceParseResult` types; `buildVoiceParseInput()` (assemble payload + hard-code enums); `parseVoiceParseResponse()` (parse JSON + validate every field). No I/O, no React.
- **Create `tests/voiceParser.test.ts`** — logic tests, hand-rolled `check()` runner.
- **Create `src/lib/useVoiceRecorder.ts`** — React hook wrapping `SpeechRecognition`. No logic test (browser-API-driven).
- **Modify `ai-proxy/worker.js`** — add the `voice_parse` entry to the `TASKS` map.
- **Create `src/components/VoicePreviewSheet.tsx`** — bottom-sheet UI with chip list, sticky Apply, swipe-to-remove, tech-safe revenue hiding, per-chip notes Replace toggle. `default` export so `React.lazy` can load it.
- **Modify `src/pages/AddJob.tsx`** — mic button at the top of the form, press-and-hold + tap-to-toggle gestures, helper text, voice-flow state, field mapper, `React.lazy` of the sheet.
- **Modify `src/styles/app.css`** — voice styles + `.field-just-filled`.

Notes for the engineer:
- `callAI(task, input)` from `src/lib/aiClient.ts` returns `{ ok, text?, error? }` and never throws. `isAIConfigured()` from the same module returns whether the proxy URL is set.
- `PaymentMethod` from `src/types/index.ts` is `'cash' | 'card' | 'zelle' | 'venmo' | 'cashapp' | 'check'`.
- `useMembership()` from `@/context/MembershipContext` returns `{ role, permissions, … }`. Tech role is `'technician'`.
- `useActiveVertical()` from `@/lib/useActiveVertical` returns the active `VerticalConfig` with `services` and `key`.
- AddJob's form state is mutated via a local `set(key, value)` helper that wraps `setJob`. For multi-field updates, prefer one batched `setJob((p) => ({ ...p, ...updates }))` call.
- Logic tests run via `npx tsx tests/<name>.test.ts`; `@/` resolves to `src/`. `npm test` runs all logic suites.
- This follows the same shape as the app's other AI features — a pure helper module, a proxy task, and an on-demand UI affordance.

---

## Task 1: `src/lib/voiceParser.ts` — pure module + tests

**Files:**
- Create: `src/lib/voiceParser.ts`
- Test: `tests/voiceParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/voiceParser.test.ts`:

```ts
// tests/voiceParser.test.ts
// Run: npx tsx tests/voiceParser.test.ts

import { buildVoiceParseInput, parseVoiceParseResponse } from '@/lib/voiceParser';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const opts = {
  services: [
    'Flat Tire Repair', 'Tire Replacement',
    'Brake Pad Replacement', 'Full Detail', 'Battery Replacement',
  ],
  vehicleTypes: ['Car', 'SUV', 'Truck', 'Van'],
};

console.log('\n┌─ buildVoiceParseInput ────────────────────────────');
{
  const inp = buildVoiceParseInput('hello world', {
    vertical: 'tire', services: ['A', 'B'], vehicleTypes: ['Car'],
  });
  check('transcript / vertical / services / vehicleTypes pass through',
    inp.transcript === 'hello world'
    && inp.vertical === 'tire'
    && JSON.stringify(inp.allowed.services) === JSON.stringify(['A', 'B'])
    && JSON.stringify(inp.allowed.vehicleTypes) === JSON.stringify(['Car']));
  check('paymentMethods + conditions hard-coded',
    JSON.stringify(inp.allowed.paymentMethods) === JSON.stringify(
      ['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check'])
    && JSON.stringify(inp.allowed.conditions) === JSON.stringify(
      ['emergency', 'lateNight', 'highway', 'weekend']));
}

console.log('\n┌─ parseVoiceParseResponse ─────────────────────────');
check('clean tire-job JSON → all fields validated and kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Tire Replacement","quantity":2,"vehicleType":"SUV",' +
      '"vehicleMakeModel":"BMW X5","location":"Aventura","paymentMethod":"cash"}',
      opts);
    return r.ok && r.fields.service === 'Tire Replacement'
      && r.fields.quantity === 2 && r.fields.vehicleType === 'SUV'
      && r.fields.vehicleMakeModel === 'BMW X5'
      && r.fields.location === 'Aventura'
      && r.fields.paymentMethod === 'cash';
  })());
check('JSON inside markdown fences extracted',
  (() => {
    const r = parseVoiceParseResponse(
      '```json\n{"service":"Flat Tire Repair"}\n```', opts);
    return r.ok && r.fields.service === 'Flat Tire Repair';
  })());
check('non-JSON → unparseable',
  (() => {
    const r = parseVoiceParseResponse('not json', opts);
    return !r.ok && r.error === 'unparseable';
  })());
check('non-object JSON (array) → malformed',
  (() => {
    const r = parseVoiceParseResponse('["x"]', opts);
    return !r.ok && r.error === 'malformed';
  })());
check('{} → empty_result',
  (() => {
    const r = parseVoiceParseResponse('{}', opts);
    return !r.ok && r.error === 'empty_result';
  })());
check('mechanic-job phrasing kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Brake Pad Replacement",' +
      '"vehicleMakeModel":"2018 Honda Accord","revenue":420,"paymentMethod":"card"}',
      opts);
    return r.ok && r.fields.service === 'Brake Pad Replacement'
      && r.fields.vehicleMakeModel === '2018 Honda Accord'
      && r.fields.revenue === 420 && r.fields.paymentMethod === 'card';
  })());
check('detailing-job phrasing kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Full Detail","vehicleMakeModel":"Tesla","location":"Miami Gardens"}',
      opts);
    return r.ok && r.fields.service === 'Full Detail'
      && r.fields.vehicleMakeModel === 'Tesla'
      && r.fields.location === 'Miami Gardens';
  })());
check('incomplete speech (just service) kept',
  (() => {
    const r = parseVoiceParseResponse('{"service":"Flat Tire Repair"}', opts);
    return r.ok && Object.keys(r.fields).length === 1
      && r.fields.service === 'Flat Tire Repair';
  })());
check('case-insensitive service match keeps canonical casing',
  (() => {
    const r = parseVoiceParseResponse('{"service":"tire replacement"}', opts);
    return r.ok && r.fields.service === 'Tire Replacement';
  })());
check('invalid service id dropped, other fields kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Barbecue","quantity":2}', opts);
    return r.ok && r.fields.service === undefined && r.fields.quantity === 2;
  })());
check('invalid vehicleType dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"vehicleType":"Spaceship","quantity":2}', opts);
    return r.ok && r.fields.vehicleType === undefined && r.fields.quantity === 2;
  })());
check('invalid paymentMethod dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"paymentMethod":"crypto","quantity":2}', opts);
    return r.ok && r.fields.paymentMethod === undefined && r.fields.quantity === 2;
  })());
check('conditions filter keeps known members',
  (() => {
    const r = parseVoiceParseResponse(
      '{"conditions":["emergency","barbecue","highway"]}', opts);
    return r.ok && JSON.stringify(r.fields.conditions) === JSON.stringify(['emergency', 'highway']);
  })());
check('conditions all invalid → field dropped → empty_result',
  (() => {
    const r = parseVoiceParseResponse(
      '{"conditions":["barbecue","sundae"]}', opts);
    return !r.ok && r.error === 'empty_result';
  })());
check('revenue 50000 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","revenue":50000}', opts);
    return r.ok && r.fields.revenue === undefined;
  })());
check('revenue -5 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","revenue":-5}', opts);
    return r.ok && r.fields.revenue === undefined;
  })());
check('revenue 10000 (boundary) kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","revenue":10000}', opts);
    return r.ok && r.fields.revenue === 10000;
  })());
check('quantity 99 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","quantity":99}', opts);
    return r.ok && r.fields.quantity === undefined;
  })());
check('quantity 0 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","quantity":0}', opts);
    return r.ok && r.fields.quantity === undefined;
  })());
check('non-integer quantity (2.5) dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","quantity":2.5}', opts);
    return r.ok && r.fields.quantity === undefined;
  })());
check('tireSize over 30 chars dropped',
  (() => {
    const big = 'x'.repeat(31);
    const r = parseVoiceParseResponse(
      `{"service":"Flat Tire Repair","tireSize":"${big}"}`, opts);
    return r.ok && r.fields.tireSize === undefined;
  })());
check('vehicleMakeModel over 80 chars dropped',
  (() => {
    const big = 'x'.repeat(81);
    const r = parseVoiceParseResponse(
      `{"service":"Flat Tire Repair","vehicleMakeModel":"${big}"}`, opts);
    return r.ok && r.fields.vehicleMakeModel === undefined;
  })());
check('notes over 500 chars dropped',
  (() => {
    const big = 'x'.repeat(501);
    const r = parseVoiceParseResponse(
      `{"service":"Flat Tire Repair","notes":"${big}"}`, opts);
    return r.ok && r.fields.notes === undefined;
  })());
check('prose around JSON still extracts the object',
  (() => {
    const r = parseVoiceParseResponse(
      'Sure thing — {"service":"Flat Tire Repair"} done', opts);
    return r.ok && r.fields.service === 'Flat Tire Repair';
  })());

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/voiceParser.test.ts`
Expected: FAIL — module `@/lib/voiceParser` does not exist yet.

- [ ] **Step 3: Write `src/lib/voiceParser.ts`**

```ts
// src/lib/voiceParser.ts
// ═══════════════════════════════════════════════════════════════════
//  Voice Logging — pure helpers (roadmap feature #7).
//
//  buildVoiceParseInput()    — packages the transcript with the
//                              active vertical's allowed enums so
//                              Claude returns valid ids.
//  parseVoiceParseResponse() — parses Claude's JSON and validates
//                              every field against those enums.
//                              Drops anything that fails; never
//                              throws.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-voice-logging-design.md
// ═══════════════════════════════════════════════════════════════════

import type { PaymentMethod } from '@/types';

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'card', 'zelle', 'venmo', 'cashapp', 'check',
];
const CONDITIONS = ['emergency', 'lateNight', 'highway', 'weekend'] as const;
type ConditionKey = typeof CONDITIONS[number];

export interface VoiceParseInput {
  transcript: string;
  vertical: string;
  allowed: {
    services: string[];
    vehicleTypes: string[];
    paymentMethods: string[];
    conditions: string[];
  };
}

export interface VoiceParseFields {
  service?: string;
  quantity?: number;
  vehicleType?: string;
  vehicleMakeModel?: string;
  tireSize?: string;
  location?: string;
  paymentMethod?: PaymentMethod;
  revenue?: number;
  notes?: string;
  conditions?: ConditionKey[];
}

export type VoiceParseResult =
  | { ok: true; fields: VoiceParseFields }
  | { ok: false; error: string };

export function buildVoiceParseInput(
  transcript: string,
  opts: { vertical: string; services: string[]; vehicleTypes: string[] },
): VoiceParseInput {
  return {
    transcript,
    vertical: opts.vertical,
    allowed: {
      services: opts.services,
      vehicleTypes: opts.vehicleTypes,
      paymentMethods: [...PAYMENT_METHODS],
      conditions: [...CONDITIONS],
    },
  };
}

// Case-insensitive trim match — returns the canonical value from
// `allowed` if found, else null. So "tire replacement" maps back to
// "Tire Replacement" exactly as configured.
function matchEnum(value: unknown, allowed: string[]): string | null {
  if (typeof value !== 'string') return null;
  const norm = value.trim().toLowerCase();
  if (!norm) return null;
  for (const a of allowed) {
    if (a.trim().toLowerCase() === norm) return a;
  }
  return null;
}

function nonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (s.length > maxLen) return null;
  return s;
}

export function parseVoiceParseResponse(
  text: string,
  opts: { services: string[]; vehicleTypes: string[] },
): VoiceParseResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'malformed' };
  }
  const o = obj as Record<string, unknown>;
  const fields: VoiceParseFields = {};

  const service = matchEnum(o.service, opts.services);
  if (service) fields.service = service;

  if (typeof o.quantity === 'number'
    && Number.isInteger(o.quantity)
    && o.quantity >= 1 && o.quantity <= 20) {
    fields.quantity = o.quantity;
  }

  const vehicleType = matchEnum(o.vehicleType, opts.vehicleTypes);
  if (vehicleType) fields.vehicleType = vehicleType;

  const makeModel = nonEmptyString(o.vehicleMakeModel, 80);
  if (makeModel) fields.vehicleMakeModel = makeModel;

  const tireSize = nonEmptyString(o.tireSize, 30);
  if (tireSize) fields.tireSize = tireSize;

  const location = nonEmptyString(o.location, 80);
  if (location) fields.location = location;

  const pay = matchEnum(o.paymentMethod, [...PAYMENT_METHODS]);
  if (pay) fields.paymentMethod = pay as PaymentMethod;

  if (typeof o.revenue === 'number'
    && Number.isFinite(o.revenue)
    && o.revenue > 0 && o.revenue <= 10000) {
    fields.revenue = o.revenue;
  }

  const notes = nonEmptyString(o.notes, 500);
  if (notes) fields.notes = notes;

  if (Array.isArray(o.conditions)) {
    const set = new Set<string>(CONDITIONS);
    const kept = o.conditions.filter(
      (c): c is ConditionKey => typeof c === 'string' && set.has(c),
    );
    if (kept.length) fields.conditions = kept;
  }

  if (Object.keys(fields).length === 0) {
    return { ok: false, error: 'empty_result' };
  }
  return { ok: true, fields };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/voiceParser.test.ts`
Expected: PASS — `26 passed, 0 failed`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/lib/voiceParser.ts tests/voiceParser.test.ts
git commit -m "feat(ai): voiceParser pure module — input packager + validated response parser"
```

---

## Task 2: `src/lib/useVoiceRecorder.ts` — STT hook

**Files:**
- Create: `src/lib/useVoiceRecorder.ts`

This task ships the React hook around the browser's `SpeechRecognition`. There is no logic test (the API is browser-driven); verification is `tsc --noEmit` plus manual device testing in Task 7.

- [ ] **Step 1: Write the hook**

```ts
// src/lib/useVoiceRecorder.ts
// ═══════════════════════════════════════════════════════════════════
//  Voice Logging — speech-to-text hook (roadmap feature #7).
//
//  Thin React wrapper around the browser's SpeechRecognition API.
//  No audio leaves the device through our proxy — STT runs locally
//  in the OS-level speech engine and we receive the final transcript.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-voice-logging-design.md
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';

export type VoiceErrorReason = 'no_speech' | 'denied' | 'unsupported' | 'other';

export interface UseVoiceRecorderOpts {
  /** BCP-47 language tag (default 'en-US'). */
  lang?: string;
  /** Fires once per session with the final transcript. */
  onResult?: (transcript: string) => void;
  /** Fires on STT failure (mapped to a small set of reasons). */
  onError?: (reason: VoiceErrorReason) => void;
}

export interface UseVoiceRecorder {
  /** True iff the browser exposes SpeechRecognition. */
  supported: boolean;
  /** True while a recogniser is active. */
  listening: boolean;
  /** Start a fresh single-utterance recogniser. */
  start: () => void;
  /** Stop the active recogniser (final onresult still fires). */
  stop: () => void;
}

// SpeechRecognition is not in TypeScript's standard lib; cast through any.
function getSR(): unknown {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useVoiceRecorder(opts: UseVoiceRecorderOpts = {}): UseVoiceRecorder {
  const SR = getSR() as (new () => SpeechRecognitionInstance) | null;
  const supported = !!SR;
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  // Capture latest callbacks in refs so the handlers always see the
  // freshest version without re-creating the recogniser.
  const onResultRef = useRef(opts.onResult);
  const onErrorRef = useRef(opts.onError);
  onResultRef.current = opts.onResult;
  onErrorRef.current = opts.onError;

  useEffect(() => {
    return () => {
      try { recRef.current?.stop?.(); } catch { /* noop */ }
      recRef.current = null;
    };
  }, []);

  const start = (): void => {
    if (!supported || !SR || listening) return;
    let rec: SpeechRecognitionInstance;
    try {
      rec = new SR();
    } catch {
      onErrorRef.current?.('other');
      return;
    }
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = opts.lang || 'en-US';
    rec.onresult = (event: SpeechRecognitionEvent): void => {
      try {
        const last = event.results[event.results.length - 1];
        const transcript = (last?.[0]?.transcript || '').trim();
        if (transcript) onResultRef.current?.(transcript);
        else onErrorRef.current?.('no_speech');
      } catch {
        onErrorRef.current?.('other');
      }
    };
    rec.onerror = (event: { error?: string }): void => {
      const err = event?.error;
      const reason: VoiceErrorReason =
        err === 'not-allowed' || err === 'service-not-allowed' ? 'denied' :
          err === 'no-speech' ? 'no_speech' : 'other';
      onErrorRef.current?.(reason);
    };
    rec.onend = (): void => {
      setListening(false);
      recRef.current = null;
    };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      onErrorRef.current?.('other');
      setListening(false);
    }
  };

  const stop = (): void => {
    try { recRef.current?.stop?.(); } catch { /* noop */ }
  };

  return { supported, listening, start, stop };
}

// Minimal local typing — the standard DOM lib does not ship a
// SpeechRecognition type, and we only touch a small surface.
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: { error?: string }) => void;
  onend: () => void;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/useVoiceRecorder.ts
git commit -m "feat(ai): useVoiceRecorder — thin SpeechRecognition hook for STT"
```

---

## Task 3: `voice_parse` task in the AI proxy

**Files:**
- Modify: `ai-proxy/worker.js` (the `TASKS` map — currently `ping` and `insights`)

- [ ] **Step 1: Add the `voice_parse` task**

In `ai-proxy/worker.js`, inside the `TASKS` object, add a third entry after `insights` (keep `ping` and `insights` untouched):

```js
  // Voice Logging (roadmap #7). Parses a tech's spoken job
  // description into a structured field map. The client
  // (src/lib/voiceParser.ts) builds `input` with the allowed enums
  // and validates the reply; this handler owns the prompt.
  voice_parse: (input) => {
    if (!input || typeof input !== 'object') {
      throw new Error('voice_parse: input must be an object');
    }
    return {
      system:
        "You extract structured job fields from a mobile service " +
        "technician's spoken job description. You will receive the " +
        'transcript and the allowed enum values for this business. ' +
        'Return ONLY raw JSON, no markdown, with any of these ' +
        'OPTIONAL fields: service (one of the allowed services), ' +
        'quantity (integer 1-20), vehicleType (one of the allowed ' +
        "vehicle types), vehicleMakeModel (a free-text year + make + " +
        "model, e.g. '2018 Honda Accord'), tireSize (free text, e.g. " +
        "'225/65R17'), location (the spoken city or area, free text), " +
        'paymentMethod (one of the allowed payment methods), revenue ' +
        '(the dollar amount as a number, no $ sign), notes (any ' +
        'free-text remainder), conditions (subset of the allowed ' +
        "conditions). Mappings: 'roadside' -> emergency, " +
        "'overnight' / 'middle of the night' / '2 AM' -> lateNight, " +
        "'highway' / 'I-95' / 'I-something' -> highway, 'weekend' -> " +
        'weekend. OMIT any field you cannot confidently extract — do ' +
        'not guess and do not pad. Return {} when nothing is ' +
        'extractable. Respond with ONLY the JSON object.',
      user: JSON.stringify(input),
      maxTokens: 300,
    };
  },
```

- [ ] **Step 2: Deploy the Worker**

The operator's Cloudflare account is already authorized.

Run: `cd ai-proxy && npx wrangler deploy`
Expected: `Deployed mobileserviceos-ai-proxy` with a new `Current Version ID`.

- [ ] **Step 3: Smoke-test the deploy**

Run:
```bash
curl -s -X POST https://mobileserviceos-ai-proxy.veyareid.workers.dev \
  -H "Origin: https://app.mobileserviceos.app" \
  -H "Content-Type: application/json" \
  -d '{"task":"voice_parse"}' -w " [%{http_code}]\n"
```
Expected: `{"error":"unauthorized"} [401]` — confirms the Worker deployed and still gates auth. (A full functional test of the `voice_parse` task needs a Firebase token and happens via the UI in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add ai-proxy/worker.js
git commit -m "feat(ai): add voice_parse task to the AI proxy"
```

---

## Task 4: `VoicePreviewSheet` component

**Files:**
- Create: `src/components/VoicePreviewSheet.tsx`

The sheet displays each extracted field as a chip with a sublabel for conflicts ("overwrites: …" / "appends to: …"). The user can drop chips (✕ tap or swipe-left), toggle notes append/replace, and finally Apply (sticky footer) or Cancel. Role-aware: the `revenue` chip is hidden for technicians.

- [ ] **Step 1: Write the component**

```tsx
// src/components/VoicePreviewSheet.tsx
// ═══════════════════════════════════════════════════════════════════
//  Voice Logging — review-before-apply bottom sheet (roadmap #7).
//
//  Renders the AI-extracted fields as chips. The tech drops bad
//  picks (tap ✕ or swipe left), optionally flips the notes chip
//  from "append" to "replace", and taps Apply. Apply is the gate —
//  the form is never mutated before this.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-voice-logging-design.md
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useRef, useState } from 'react';
import type { Job, PaymentMethod } from '@/types';
import { money } from '@/lib/utils';
import type { VoiceParseFields } from '@/lib/voiceParser';

export interface VoicePreviewSheetProps {
  fields: VoiceParseFields;
  /** Current Add Job state, for "overwrites: …" / "appends to: …". */
  existing: Pick<Job,
    'service' | 'qty' | 'vehicleType' | 'vehicleMakeModel' | 'tireSize'
    | 'city' | 'paymentMethod' | 'revenue' | 'note'
    | 'emergency' | 'lateNight' | 'highway' | 'weekend'>;
  /** Membership role — drives tech-safe mode. */
  role: string;
  onApply: (fields: VoiceParseFields, opts: { notesAppend: boolean }) => void;
  onCancel: () => void;
}

type ChipKey =
  | 'service' | 'quantity' | 'vehicleType' | 'vehicleMakeModel' | 'tireSize'
  | 'location' | 'paymentMethod' | 'revenue' | 'notes' | 'conditions';

interface ChipModel {
  key: ChipKey;
  label: string;
  value: string;
  /** Sublabel describing the conflict, or null when the field is empty. */
  sublabel: string | null;
  /** True for the notes chip when existing notes are non-empty. */
  notesConflict: boolean;
}

function VoicePreviewSheet({ fields, existing, role, onApply, onCancel }: VoicePreviewSheetProps) {
  // Build the chip set. Tech-safe mode hides the revenue chip.
  const chips = useMemo<ChipModel[]>(() => {
    const out: ChipModel[] = [];
    const conflictFor = (current: unknown): string | null => {
      if (current === undefined || current === null) return null;
      const s = String(current).trim();
      return s ? `overwrites: ${s}` : null;
    };

    if (fields.service !== undefined) {
      out.push({ key: 'service', label: 'Service', value: fields.service,
        sublabel: conflictFor(existing.service), notesConflict: false });
    }
    if (fields.quantity !== undefined) {
      out.push({ key: 'quantity', label: 'Qty', value: String(fields.quantity),
        sublabel: conflictFor(existing.qty), notesConflict: false });
    }
    if (fields.vehicleType !== undefined) {
      out.push({ key: 'vehicleType', label: 'Vehicle type', value: fields.vehicleType,
        sublabel: conflictFor(existing.vehicleType), notesConflict: false });
    }
    if (fields.vehicleMakeModel !== undefined) {
      out.push({ key: 'vehicleMakeModel', label: 'Make / model', value: fields.vehicleMakeModel,
        sublabel: conflictFor(existing.vehicleMakeModel), notesConflict: false });
    }
    if (fields.tireSize !== undefined) {
      out.push({ key: 'tireSize', label: 'Tire size', value: fields.tireSize,
        sublabel: conflictFor(existing.tireSize), notesConflict: false });
    }
    if (fields.location !== undefined) {
      out.push({ key: 'location', label: 'City', value: fields.location,
        sublabel: conflictFor(existing.city), notesConflict: false });
    }
    if (fields.paymentMethod !== undefined) {
      out.push({ key: 'paymentMethod', label: 'Payment', value: fields.paymentMethod,
        sublabel: conflictFor(existing.paymentMethod), notesConflict: false });
    }
    if (fields.revenue !== undefined && role !== 'technician') {
      out.push({ key: 'revenue', label: 'Revenue', value: money(fields.revenue),
        sublabel: conflictFor(existing.revenue), notesConflict: false });
    }
    if (fields.notes !== undefined) {
      const existingNotes = (existing.note || '').trim();
      out.push({ key: 'notes', label: 'Notes', value: fields.notes,
        sublabel: existingNotes ? `appends to: ${existingNotes}` : null,
        notesConflict: !!existingNotes });
    }
    if (fields.conditions && fields.conditions.length) {
      out.push({ key: 'conditions', label: 'Conditions', value: fields.conditions.join(', '),
        sublabel: null, notesConflict: false });
    }
    return out;
  }, [fields, existing, role]);

  const [removed, setRemoved] = useState<Set<ChipKey>>(new Set());
  const [notesAppend, setNotesAppend] = useState(true);

  // Swipe-left to remove — a thumb-friendly mobile gesture.
  const swipeRef = useRef<{ key: ChipKey | null; x: number }>({ key: null, x: 0 });
  const onPointerDown = (key: ChipKey, e: React.PointerEvent): void => {
    swipeRef.current = { key, x: e.clientX };
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const s = swipeRef.current;
    if (s.key && e.clientX - s.x < -80) {
      setRemoved((r) => new Set(r).add(s.key as ChipKey));
    }
    swipeRef.current = { key: null, x: 0 };
  };

  const handleApply = (): void => {
    const next: VoiceParseFields = {};
    for (const c of chips) {
      if (removed.has(c.key)) continue;
      switch (c.key) {
        case 'service': next.service = fields.service; break;
        case 'quantity': next.quantity = fields.quantity; break;
        case 'vehicleType': next.vehicleType = fields.vehicleType; break;
        case 'vehicleMakeModel': next.vehicleMakeModel = fields.vehicleMakeModel; break;
        case 'tireSize': next.tireSize = fields.tireSize; break;
        case 'location': next.location = fields.location; break;
        case 'paymentMethod': next.paymentMethod = fields.paymentMethod as PaymentMethod; break;
        case 'revenue': next.revenue = fields.revenue; break;
        case 'notes': next.notes = fields.notes; break;
        case 'conditions': next.conditions = fields.conditions; break;
      }
    }
    onApply(next, { notesAppend });
  };

  return (
    <div className="voice-sheet" role="dialog" aria-label="Voice picked these — review and apply">
      <div className="voice-sheet-body">
        <div className="voice-sheet-title">Voice picked these — review and apply</div>
        {chips.length === 0 && (
          <div className="voice-sheet-empty">Nothing left to apply.</div>
        )}
        {chips.map((c) => {
          const isRemoved = removed.has(c.key);
          return (
            <div
              key={c.key}
              className={'voice-chip' + (isRemoved ? ' removed' : '')}
              onPointerDown={(e) => onPointerDown(c.key, e)}
              onPointerUp={onPointerUp}
            >
              <div className="voice-chip-main">
                <span className="voice-chip-label">{c.label}</span>
                <span className="voice-chip-value">{c.value}</span>
                {c.sublabel && <span className="voice-chip-sub">{c.sublabel}</span>}
                {c.notesConflict && (
                  <label className="voice-chip-toggle">
                    <input
                      type="checkbox"
                      checked={!notesAppend}
                      onChange={(e) => setNotesAppend(!e.target.checked)}
                    />
                    Replace instead of append
                  </label>
                )}
              </div>
              <button
                type="button"
                className="voice-chip-x"
                aria-label={`Drop ${c.label}`}
                onClick={() => setRemoved((r) => new Set(r).add(c.key))}
              >
                {isRemoved ? '↩' : '✕'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="voice-sheet-footer">
        <button type="button" className="voice-sheet-cancel" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="voice-sheet-apply"
          onClick={handleApply}
          disabled={chips.every((c) => removed.has(c.key))}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export default VoicePreviewSheet;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/VoicePreviewSheet.tsx
git commit -m "feat(ai): VoicePreviewSheet — chip-based review-before-apply bottom sheet"
```

---

## Task 5: AddJob integration — mic button, gestures, field mapper

**Files:**
- Modify: `src/pages/AddJob.tsx`

The mic button sits at the top of the Add Job form, just above the existing live-quote box. Both gestures are wired through `onPointerDown` / `onPointerUp` / `onPointerLeave` — a release before 300 ms is a "tap-toggle"; a release at or after 300 ms is "press-and-hold." The sheet is loaded via `React.lazy`. The field mapper applies the survived chips with a brief `.field-just-filled` highlight.

- [ ] **Step 1: Update imports**

In `src/pages/AddJob.tsx`, find the React import line (`import { ... } from 'react';`). Replace it with:

```ts
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
```

(Keep any existing hooks the file already imports — extend the list rather than narrow it. Add only what's missing.)

After the last existing `@/`-prefixed import line near the top of the file, add:

```ts
import { callAI, isAIConfigured } from '@/lib/aiClient';
import { useMembership } from '@/context/MembershipContext';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import {
  buildVoiceParseInput, parseVoiceParseResponse,
} from '@/lib/voiceParser';
import type { VoiceParseFields } from '@/lib/voiceParser';
import type { PaymentMethod } from '@/types';
const VoicePreviewSheet = lazy(() => import('@/components/VoicePreviewSheet'));
```

(If any of these imports already exist in the file, do not duplicate them.)

- [ ] **Step 2: Add voice state and the recorder hook**

Inside the `AddJob` component body, after the existing state declarations (after the line that declares `liveQuote` or its equivalent — anywhere in the early-state region of the component is fine, but BEFORE the `return` statement and BEFORE any function that references the voice state), add:

```tsx
  // ── Voice Logging (feature #7) ─────────────────────────────────
  const membership = useMembership();
  const role = membership.role ?? '';
  const vertical = useActiveVertical();
  const allowedServices = useMemo(() => {
    return vertical.services.map((s: { id: string }) => s.id);
  }, [vertical]);
  const allowedVehicleTypes = useMemo(() => {
    return Object.keys(settings.vehiclePricing || {});
  }, [settings.vehiclePricing]);

  const [voiceState, setVoiceState] = useState<
    'idle' | 'listening' | 'parsing' | 'done' | 'error'>('idle');
  const [voiceFields, setVoiceFields] = useState<VoiceParseFields | null>(null);
  const [justFilled, setJustFilled] = useState<ReadonlySet<string>>(new Set());

  // Press-vs-tap disambiguation.
  const pressStartRef = useRef<number>(0);
  const TAP_MAX_MS = 300;

  useEffect(() => {
    if (justFilled.size === 0) return;
    const t = setTimeout(() => setJustFilled(new Set()), 1500);
    return () => clearTimeout(t);
  }, [justFilled]);

  const handleVoiceResult = async (transcript: string): Promise<void> => {
    setVoiceState('parsing');
    const input = buildVoiceParseInput(transcript, {
      vertical: vertical.key,
      services: allowedServices,
      vehicleTypes: allowedVehicleTypes,
    });
    const res = await callAI('voice_parse', input);
    if (!res.ok || !res.text) { setVoiceState('error'); return; }
    const parsed = parseVoiceParseResponse(res.text, {
      services: allowedServices,
      vehicleTypes: allowedVehicleTypes,
    });
    if (!parsed.ok) { setVoiceState('error'); return; }
    setVoiceFields(parsed.fields);
    setVoiceState('done');
  };

  const recorder = useVoiceRecorder({
    onResult: (t) => { void handleVoiceResult(t); },
    onError: () => { setVoiceState('error'); },
  });

  const startVoice = (): void => {
    if (voiceState === 'parsing' || voiceState === 'listening') return;
    setVoiceState('listening');
    recorder.start();
  };
  const stopVoice = (): void => {
    recorder.stop();
    // The hook's onend handler clears `listening` and the result
    // flow takes over; nothing else needed here.
  };

  const onMicPointerDown = (e: React.PointerEvent): void => {
    pressStartRef.current = Date.now();
    e.preventDefault();
    startVoice();
  };
  const onMicPointerUp = (e: React.PointerEvent): void => {
    const dt = Date.now() - pressStartRef.current;
    e.preventDefault();
    if (dt < TAP_MAX_MS) {
      // Quick tap: toggle behaviour. If we're listening, stop on the
      // NEXT tap, not this one — so do nothing on the tap that just
      // started us, and stop on the tap that finds us listening.
      if (!recorder.listening) return;       // first tap, keep listening
      stopVoice();                           // second tap, stop
      return;
    }
    // Press-and-hold release: stop now.
    stopVoice();
  };
  const onMicPointerLeave = (): void => {
    // Finger slid off the button mid-press — treat like a release.
    if (recorder.listening) stopVoice();
  };

  const applyVoiceFields = (
    chosen: VoiceParseFields,
    appliedOpts: { notesAppend: boolean },
  ): void => {
    const filled = new Set<string>();
    setJob((p) => {
      const next = { ...p };
      if (chosen.service !== undefined) { next.service = chosen.service; filled.add('service'); }
      if (chosen.quantity !== undefined) { next.qty = String(chosen.quantity); filled.add('qty'); }
      if (chosen.vehicleType !== undefined) { next.vehicleType = chosen.vehicleType; filled.add('vehicleType'); }
      if (chosen.vehicleMakeModel !== undefined) { next.vehicleMakeModel = chosen.vehicleMakeModel; filled.add('vehicleMakeModel'); }
      if (chosen.tireSize !== undefined) { next.tireSize = chosen.tireSize; filled.add('tireSize'); }
      if (chosen.location !== undefined) { next.city = chosen.location; filled.add('city'); }
      if (chosen.paymentMethod !== undefined) { next.paymentMethod = chosen.paymentMethod as PaymentMethod; filled.add('paymentMethod'); }
      if (chosen.revenue !== undefined) { next.revenue = String(chosen.revenue); filled.add('revenue'); }
      if (chosen.notes !== undefined) {
        const existingNote = (p.note || '').trim();
        next.note = existingNote && appliedOpts.notesAppend
          ? `${existingNote} • ${chosen.notes}`
          : chosen.notes;
        filled.add('note');
      }
      if (chosen.conditions) {
        for (const c of chosen.conditions) {
          (next as Record<string, unknown>)[c] = true;
          filled.add(c);
        }
      }
      return next;
    });
    setJustFilled(filled);
    setVoiceFields(null);
    setVoiceState('idle');
  };
```

(`setJob` is the prop already available in `AddJob`. The `set` helper used elsewhere in the file wraps `setJob` — you may use either; the snippet above uses `setJob` directly for the single batched update.)

- [ ] **Step 3: Render the mic block and the sheet**

Find the existing live-quote box near the top of the JSX returned by `AddJob` — the `<div className="quote-box card-anim">` (it sits above the form fields). Insert the voice block **immediately before** that `<div>`:

```tsx
      {/* ── Voice fill (feature #7) ─────────────────────────────── */}
      {isAIConfigured() && recorder.supported && (
        <div className="voice-fill">
          <button
            type="button"
            className="voice-mic-btn press-scale"
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerLeave={onMicPointerLeave}
            disabled={voiceState === 'parsing'}
          >
            {voiceState === 'listening' && '🎤 Listening — release / tap to stop'}
            {voiceState === 'parsing' && 'Parsing…'}
            {(voiceState === 'idle' || voiceState === 'error' || voiceState === 'done') && '🎤 Voice fill'}
          </button>
          {voiceState === 'idle' && (
            <div className="voice-helper">
              Say service, vehicle, location, payment. e.g.&nbsp;
              <em>"Two tire replacement on a BMW X5 in Aventura, cash."</em>
            </div>
          )}
          {voiceState === 'error' && (
            <div className="voice-error">Couldn't read the voice fill — try again.</div>
          )}
        </div>
      )}
      {voiceState === 'done' && voiceFields && (
        <Suspense fallback={null}>
          <VoicePreviewSheet
            fields={voiceFields}
            existing={job}
            role={role}
            onApply={applyVoiceFields}
            onCancel={() => { setVoiceFields(null); setVoiceState('idle'); }}
          />
        </Suspense>
      )}
```

- [ ] **Step 4: Add `.field-just-filled` to voice-targeted inputs**

For each form input in `AddJob.tsx` that voice can populate, conditionally add the `field-just-filled` class. The pattern is:

```tsx
className={justFilled.has('FIELD_KEY') ? 'field-just-filled' : undefined}
```

Apply it to the inputs/selects targeting these field keys: `service`, `qty`, `vehicleType`, `vehicleMakeModel`, `tireSize`, `city`, `paymentMethod`, `revenue`, `note`, `emergency`, `lateNight`, `highway`, `weekend`. If a field is rendered inside a wrapping div (e.g. a `field` class), apply the highlight class to the wrapping div instead — wherever the colour pulse will read clearly.

For example, if the existing markup is:
```tsx
<input value={job.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="John D." />
```
and we wanted to highlight on voice fill (we don't, this is just the pattern):
```tsx
<input
  className={justFilled.has('customerName') ? 'field-just-filled' : undefined}
  value={job.customerName} onChange={(e) => set('customerName', e.target.value)}
  placeholder="John D."
/>
```

If a target field is already wrapped in a div with another className, **merge** the classes:
```tsx
<div className={'field' + (justFilled.has('city') ? ' field-just-filled' : '')}>
```

Touch each of the fields listed above exactly once. If a field isn't present in the form (e.g. the condition checkboxes might be a chip row rather than `<input>`s), apply the class to whatever element renders the value so the pulse is visible.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AddJob.tsx
git commit -m "feat(ai): voice-fill mic + apply flow on the Add Job form"
```

---

## Task 6: Styles

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add the voice styles**

In `src/styles/app.css`, find the `.ai-summary-error { … }` rule (the last rule of the Insights AI summary block added by feature #14). Immediately after that rule's closing `}`, add:

```css

/* ── Voice fill (Add Job) — feature #7 ─────────────────────── */
.voice-fill { margin: 0 0 14px 0; }
.voice-mic-btn {
  width: 100%;
  background: var(--brand-primary-dim);
  border: 1px solid var(--brand-primary);
  border-radius: 12px;
  padding: 14px 12px;
  color: var(--brand-primary);
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  min-height: 52px;                  /* one-thumb tap target */
  user-select: none;
  touch-action: manipulation;
}
.voice-mic-btn:disabled { opacity: .6; cursor: default; }
.voice-helper {
  margin-top: 6px;
  font-size: 12px;
  color: var(--t3);
  line-height: 1.4;
}
.voice-helper em { color: var(--t2); font-style: normal; }
.voice-error {
  margin-top: 8px; font-size: 12px; color: var(--red); text-align: center;
}

/* ── Voice review sheet ─────────────────────────────────────── */
.voice-sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: var(--s1, #0f1115);
  border-top: 1px solid var(--border);
  border-radius: 14px 14px 0 0;
  z-index: 60;
  max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 -4px 24px rgba(0,0,0,.4);
}
.voice-sheet-body {
  padding: 14px 14px 8px 14px;
  overflow-y: auto;
  flex: 1 1 auto;
}
.voice-sheet-title {
  font-size: 13px; font-weight: 800; letter-spacing: .5px;
  text-transform: uppercase; color: var(--brand-primary);
  margin-bottom: 10px;
}
.voice-sheet-empty {
  font-size: 13px; color: var(--t3); padding: 12px 0;
}
.voice-chip {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 8px;
  border-radius: 10px;
  background: var(--s2);
  border: 1px solid var(--border);
  margin-bottom: 8px;
  min-height: 44px;                  /* mobile tap target */
  touch-action: pan-y;
}
.voice-chip.removed { opacity: .45; }
.voice-chip-main {
  flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0;
}
.voice-chip-label {
  font-size: 10px; font-weight: 800; letter-spacing: 1px;
  text-transform: uppercase; color: var(--t3);
}
.voice-chip-value {
  font-size: 14px; font-weight: 700; color: var(--t1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.voice-chip-sub {
  font-size: 11px; color: var(--t3); margin-top: 2px;
}
.voice-chip-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--t2); margin-top: 4px; user-select: none;
}
.voice-chip-toggle input { width: 14px; height: 14px; }
.voice-chip-x {
  flex-shrink: 0;
  width: 36px; height: 36px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--t2);
  font-size: 16px;
  cursor: pointer;
}
.voice-sheet-footer {
  position: sticky; bottom: 0;
  display: flex; gap: 10px;
  padding: 12px 14px calc(12px + var(--safe-b, 0px)) 14px;
  background: var(--s1, #0f1115);
  border-top: 1px solid var(--border);
}
.voice-sheet-cancel {
  flex: 1;
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  color: var(--t1);
  font-weight: 700;
  cursor: pointer;
  min-height: 44px;
}
.voice-sheet-apply {
  flex: 2;
  background: var(--brand-primary);
  border: none;
  border-radius: 10px;
  padding: 12px;
  color: #1a1a1a;
  font-weight: 800;
  font-size: 14px;
  cursor: pointer;
  min-height: 44px;
}
.voice-sheet-apply:disabled { opacity: .5; cursor: default; }

/* ── Field-fill highlight (used by voice apply) ─────────────── */
.field-just-filled {
  animation: field-fill-pulse 1500ms ease-out 1;
}
@keyframes field-fill-pulse {
  0%   { box-shadow: 0 0 0 2px rgba(244,180,0,.0);  background-color: rgba(244,180,0,.0); }
  20%  { box-shadow: 0 0 0 2px rgba(244,180,0,.55); background-color: rgba(244,180,0,.18); }
  100% { box-shadow: 0 0 0 2px rgba(244,180,0,.0);  background-color: rgba(244,180,0,.0); }
}
```

(`--s1`, `--s2`, `--border`, `--brand-primary`, `--brand-primary-dim`, `--t1`, `--t2`, `--t3`, `--red`, and `--safe-b` are all defined in the `:root` block at the top of the file. The fallbacks in `var(--s1, #0f1115)` cover the rare case where a token is absent.)

- [ ] **Step 2: Commit**

```bash
git add src/styles/app.css
git commit -m "feat(ai): style the voice-fill mic + review sheet"
```

---

## Task 7: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `voiceParser` (`26 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed` (no component tests added by this feature).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification on a real phone (the iOS-PWA risk)**

This is the verification step the spec flagged. Open the deployed app at `https://app.mobileserviceos.app` on a real iPhone (Safari, then add-to-home-screen PWA mode) AND an Android Chrome browser:

- **Mic button visible.** Open Add Job — the `🎤 Voice fill` button appears at the top of the form, with the one-line helper text underneath.
- **Press-and-hold gesture.** Press and hold the mic button → the label switches to "🎤 Listening — release / tap to stop"; speak ("Two tire replacement on a BMW X5 in Aventura, cash"); release → "Parsing…" → the bottom sheet opens with chips for service, qty, vehicleType, vehicleMakeModel, city, paymentMethod. Tap **Apply** → the form fields fill, each with a brief amber pulse. Tap **Save** to file the job as normal.
- **Quick-tap gesture.** Tap the mic (release before 300 ms) → it stays in listening mode. Speak a job. Tap the mic again → it stops and parses.
- **Tech-safe mode.** Sign in as a `technician`-role member and repeat. Speak a job that mentions a price ("…420 dollars cash"). The bottom sheet shows the other chips but **no revenue chip** — techs enter revenue manually.
- **Notes append.** Type something in the Notes field first. Then speak a job that includes a note. The notes chip's sublabel reads "appends to: …"; with the chip's **Replace** checkbox unchecked (the default), Apply produces `existing • spoken`. Toggle Replace and Apply again to verify the replace branch.
- **Swipe-to-remove.** Swipe a chip left more than ~80 px → it dims (✕ icon becomes ↩ to undo).
- **Sticky Apply.** When many chips are present, the Apply / Cancel footer stays at the bottom of the sheet as you scroll the chip list.
- **Unsupported browser.** Open the app in a browser without `SpeechRecognition` (Firefox desktop is a fast check) → the mic button is correctly hidden; the form works normally.
- **AI failure.** Force a parse failure (turn off mobile data mid-press) → the inline "Couldn't read the voice fill" message shows; the form is untouched.

Note any iOS-PWA-specific failures in a follow-up issue — the spec called this out as the v1 risk.

- [ ] **Step 5: Commit any verification fixes, then push**

```bash
git push
```

---

## Notes

- **Out of scope** for v1 (deferred to a Phase 2 spec listed in the design doc): the local deterministic parser + confidence system, recent local memory, voice shortcuts, duplicate-job detection, and the offline queue. Do not add these in v1.
- The mic button is hidden when `!isAIConfigured()` OR when the browser lacks `SpeechRecognition`. This is by design — the manual form is the always-available path.
- Each task is independently committable and leaves the build green.
