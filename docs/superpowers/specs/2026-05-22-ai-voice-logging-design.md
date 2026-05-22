# AI Voice Logging — Design

> Roadmap feature #7 (Voice Logging). Depends on the AI proxy
> (`docs/superpowers/specs/2026-05-22-ai-proxy-design.md`), deployed
> and verified.

## Goal

Let a technician tap a 🎤 button on the Add Job form, speak a
job naturally, and have the form auto-fill from the speech.
Voice **speeds up** logging — it never replaces, gates, or
auto-saves the workflow.

## Background

Mobile-service technicians log completed jobs on the Add Job form.
On a roadside, in a loud environment, one-thumb, fast — typing is
the bottleneck. Speaking a job ("Two tire replacement on a BMW X5
in Aventura, cash") is faster. Web browsers expose
`SpeechRecognition` for transcription; the AI proxy can broker the
**parse** step that turns the transcript into structured fields.

## Hard constraints

- Mobile-first; one-thumb-reachable; works under noise / haste
- **Two gestures supported equivalently:** press-and-hold (walkie-talkie
  ergonomics — start on press, stop on release) AND quick tap-to-toggle
- Never auto-saves a job; the existing Save button is the only commit
- Never overwrites a field without the tech's explicit Apply tap
- AI unavailable → manual form unaffected; the mic stays hidden
- Browser without SpeechRecognition → mic stays hidden, no error
- **Tech safe mode** — when role is `technician`, the parser still
  extracts pricing fields but the UI omits the `revenue` chip; techs
  enter revenue manually as today
- Haiku only · concise system prompt · `maxTokens: 300` ·
  no conversation memory · no chat history · one call per tap
- Validation is strict — only fields that pass an allow-list / type
  check survive; partial extraction is the norm, not the exception
- No live streaming transcription, no chatbot, no chained AI calls,
  no auto-trigger of pricing AI

## Architecture

Four units, each with one responsibility:

1. **Speech-to-text source** — the browser's `SpeechRecognition` API
   (Webkit-prefixed on iOS). No audio leaves the device through our
   proxy. The hook **only** does STT.
2. **`src/lib/useVoiceRecorder.ts`** (new hook) — wraps
   `SpeechRecognition`. Reports `supported`, `listening`, and emits
   `onResult(transcript)` / `onError(reason)`.
3. **`src/lib/voiceParser.ts`** (new, pure) — `buildVoiceParseInput()`
   packages the transcript with the active vertical's enums;
   `parseVoiceParseResponse()` parses Claude's JSON and validates
   every field against those enums. No React, no I/O — testable.
4. **Proxy task** (`ai-proxy/worker.js`) — a new `voice_parse` entry
   in the `TASKS` map. Owns the prompt server-side; returns
   Claude's text via the generic `{ ok, text }` shape.

`callAI` (`src/lib/aiClient.ts`, existing) is the transport.

## Data flow

1. Add Job page mounts. If `isAIConfigured()` and the
   `useVoiceRecorder` hook reports `supported: true`, render the
   **🎤 Voice fill** button at the top of the form.
2. **Press-and-hold OR quick-tap** the button. Mic permission (first
   time) → `recorder.start()`. While listening, the button reads
   **🎤 Listening — release / tap to stop**.
3. Tech speaks. The browser stops on **release** (hold gesture),
   on the **next tap** (toggle gesture), or after the browser
   detects silence (~5 s). `onResult(transcript)` fires.
4. Add Job sets local state `voiceStatus = 'parsing'`,
   calls `callAI('voice_parse', buildVoiceParseInput(transcript, opts))`
   where `opts = { vertical, services, vehicleTypes }`.
5. On reply: `parseVoiceParseResponse(result.text, opts)` →
   `{ ok: true, fields }` or `{ ok: false, error }`.
6. **`VoicePreviewSheet`** (bottom sheet) opens with one chip per
   extracted field — `service: Tire Replacement`, `qty: 2`,
   `vehicle: BMW X5`, `city: Aventura`, `pay: cash`, `revenue: $240`,
   etc. Each chip is ✕-removable. Chips whose field already has a
   value on the form carry a small **"overwrites X"** indicator so
   the tech sees the conflict before tapping Apply.
7. **Apply** — all surviving chips fill their target fields. Each
   filled `<input>` / `<select>` gets a `.field-just-filled` class
   that fades over ~1.5 s. Sheet closes. The tech reviews, edits any
   field manually, and taps the existing **Save** button as normal.
8. **Cancel** / **any failure** at any step — sheet closes (if open),
   form untouched.

## Proxy task contract

`TASKS.voice_parse(input)` returns `{ system, user, maxTokens }`. It
validates that `input` is an object and throws otherwise.

**Input** (`VoiceParseInput`, sent by the client):

```ts
interface VoiceParseInput {
  transcript: string;                       // the spoken text
  vertical: string;                         // 'tire' | 'mechanic' | 'detailing'
  allowed: {
    services: string[];                     // ids in the active vertical
    vehicleTypes: string[];                 // configured vehicle types
    paymentMethods: string[];               // ['cash','card','zelle','venmo','cashapp','check']
    conditions: string[];                   // ['emergency','lateNight','highway','weekend']
  };
}
```

The client embeds the allowed enums in the user message so Claude
emits valid ids, not free text.

**Prompt** (server-side):

- *System:* "You extract structured job fields from a mobile service
  technician's spoken job description. You will receive the
  transcript and the allowed enum values for this business. Return
  ONLY raw JSON, no markdown, with any of these optional fields:
  `service` (one of the allowed services), `quantity` (integer 1-20),
  `vehicleType` (one of the allowed vehicle types), `vehicleMakeModel`
  (a free-text year + make + model, e.g. '2018 Honda Accord'),
  `tireSize` (free text, e.g. '225/65R17'), `location` (the spoken
  city or area, free text), `paymentMethod` (one of the allowed
  payment methods), `revenue` (the dollar amount as a number, no $
  sign), `notes` (any free-text remainder), `conditions` (subset of
  the allowed conditions). Mappings: 'roadside' → emergency,
  'overnight' / 'middle of the night' / '2 AM' → lateNight,
  'highway' / 'I-95' / 'I-something' → highway, 'weekend' → weekend.
  OMIT any field you cannot confidently extract — do not guess and
  do not pad. Return `{}` when nothing is extractable. Respond with
  ONLY the JSON object."
- *User:* `JSON.stringify(input)`.
- *maxTokens:* 300.

**Output:** the Worker's generic `{ ok, text }`. Validation is the
client's job (`parseVoiceParseResponse`).

## `src/lib/voiceParser.ts`

```ts
buildVoiceParseInput(
  transcript: string,
  opts: { vertical: string; services: string[]; vehicleTypes: string[] },
): VoiceParseInput
```

Assembles the payload. `allowed.paymentMethods` is hard-coded to the
`PaymentMethod` enum (`['cash','card','zelle','venmo','cashapp','check']`),
`allowed.conditions` to `['emergency','lateNight','highway','weekend']`.

```ts
parseVoiceParseResponse(
  text: string,
  opts: { services: string[]; vehicleTypes: string[] },
): VoiceParseResult

type VoiceParseResult =
  | { ok: true; fields: VoiceParseFields }
  | { ok: false; error: string };

interface VoiceParseFields {
  service?: string;
  quantity?: number;
  vehicleType?: string;
  vehicleMakeModel?: string;
  tireSize?: string;
  location?: string;                                // → applied to Job.city
  paymentMethod?: PaymentMethod;
  revenue?: number;
  notes?: string;
  conditions?: Array<'emergency' | 'lateNight' | 'highway' | 'weekend'>;
}
```

1. Extract the first `{ … }` block from `text`. `JSON.parse` it. On
   failure → `{ ok: false, error: 'unparseable' }`.
2. Result must be an object → else `{ ok: false, error: 'malformed' }`.
3. Walk the keys, **dropping** any that fail their validator:

| Field | Validator |
|---|---|
| `service` | must equal an id in `opts.services` (case-insensitive trim) |
| `vehicleType` | must equal a value in `opts.vehicleTypes` (case-insensitive trim) |
| `paymentMethod` | must be in `['cash','card','zelle','venmo','cashapp','check']` |
| `conditions` | array; keep only members of `['emergency','lateNight','highway','weekend']`; drop the field if the array becomes empty |
| `revenue` | finite number, `0 < revenue <= 10000` |
| `quantity` | integer, `1 <= quantity <= 20` |
| `tireSize` | non-empty string, ≤ 30 chars after trim |
| `vehicleMakeModel` | non-empty string, ≤ 80 chars after trim |
| `location` | non-empty string, ≤ 80 chars after trim |
| `notes` | non-empty string, ≤ 500 chars after trim |

4. If at least one field survives → `{ ok: true, fields }`. If none
   do → `{ ok: false, error: 'empty_result' }`.

This is the user's "never trust AI blindly" + "reject malformed
payloads safely" gate — partial extractions are kept, anything else
is dropped silently.

## `src/lib/useVoiceRecorder.ts`

```ts
useVoiceRecorder(opts?: {
  lang?: string;                             // default 'en-US'
  onResult?: (transcript: string) => void;
  onError?: (reason: 'no_speech' | 'denied' | 'unsupported' | 'other') => void;
}): {
  supported: boolean;                        // SpeechRecognition is on window
  listening: boolean;
  start: () => void;
  stop: () => void;
}
```

- Detects `window.SpeechRecognition || window.webkitSpeechRecognition`.
  When neither exists, `supported = false` and `start()` is a no-op.
- Configures `continuous: false`, `interimResults: false`, `lang`.
- `start()` instantiates a fresh recogniser, wires `onresult` /
  `onerror` / `onend`, calls `.start()`, sets `listening = true`.
- `stop()` calls `.stop()` on the live recogniser (the final
  `onresult` still fires).
- `onresult` collects the highest-confidence final transcript and
  fires `opts.onResult(transcript)`.
- `onerror` maps the browser's error event to one of the four reasons
  above and fires `opts.onError`.
- Cleanup on unmount.

## Add Job UI

A new prominent block at the top of the Add Job form, above the
existing live-quote box:

- **🎤 Voice fill** button — full-width, gold-tinted, only rendered
  when `isAIConfigured() && supported`. **Press-and-hold** starts on
  `onPointerDown` and stops on `onPointerUp`/`onPointerLeave`
  (walkie-talkie ergonomics). A **quick tap** (release before 300 ms)
  toggles: start on the first tap, stop on the next. The button
  measures press duration to disambiguate; consumers wire both
  pointer events, the rest is deterministic. While `listening`, the
  label is **🎤 Listening — release / tap to stop**. While `parsing`,
  label is **Parsing…** and the button is disabled.
- **Helper text** below the button (only when `voiceStatus === 'idle'`):
  one short line — *"Say service, vehicle, location, payment. e.g.
  'Two tire replacement on a BMW X5 in Aventura, cash.'"* Compact,
  mobile-friendly, never wraps to more than two lines.
- On parse success → **`VoicePreviewSheet`** opens. On parse failure
  → an inline `.voice-error` line ("Couldn't read the voice fill —
  try again."), no sheet.

**`VoicePreviewSheet`** — a bottom sheet (mobile-first):

- Title: **Voice picked these — review and apply.**
- A list of chips, one per non-empty field in `fields`. Each chip:
  - left side: label + value (e.g. `Service · Tire Replacement`,
    `Revenue · $240`),
  - right side: a small ✕ that drops the chip from the apply set,
  - if the target form field is already populated, an
    **"overwrites: …current value…"** sublabel renders below (for
    `notes`, which appends by default, the sublabel reads
    **"appends to: …current value…"** with a small **Replace** toggle
    to switch that one chip from append → replace).
- **Mobile-polished:** each chip row has a ≥44 px tap target;
  a **swipe-left** gesture removes the chip (in addition to the ✕);
  spacing is compact (8 px between chips).
- Footer: **Apply** (primary) and **Cancel** buttons. The footer is
  **sticky** to the bottom of the sheet so it remains reachable when
  the chip list is long. Apply uses the current chip set; Cancel
  discards everything.
- Tapping a row anywhere except ✕ toggles it on a single tap (so a
  tech can quickly drop several with their thumb).
- **Tech safe mode** — when `membership.role === 'technician'`, the
  `revenue` chip is hidden from the sheet entirely (the parser may
  have extracted it; the UI does not offer it to apply). Techs enter
  revenue manually in the form. Owners/admins see every chip.

**Field highlight** — when Apply fills a field, the corresponding
`<input>` / `<select>` / chip gets `.field-just-filled` for ~1500 ms
(amber border fade). One class, dropped on the next interaction or
on timer.

**Field mapping** (parser field → Add Job form field):
- `service` → `job.service`
- `quantity` → `job.qty`
- `vehicleType` → `job.vehicleType`
- `vehicleMakeModel` → `job.vehicleMakeModel`
- `tireSize` → `job.tireSize` (tire vertical only; chip is hidden on
  mechanic/detailing)
- `location` → `job.city`
- `paymentMethod` → `job.paymentMethod`
- `revenue` → `job.revenue`
- `notes` → `job.note`. **Appends by default** when `job.note` is
  non-empty: `${job.note} • ${voiceNotes}` (a ` • ` separator).
  The chip's sublabel reads **"appends to: …current value…"** with a
  small **Replace** toggle the tech can flip to overwrite instead.
  Empty `job.note` is just set, no separator. Append is the default
  because losing a previous note to a voice fill is a real
  destructive surprise.
- `conditions[k] === true` → flip `job[k]` (the existing boolean
  flags emergency/lateNight/highway/weekend)

## Speech-to-text source — Web Speech API

Free, browser-native, runs through the OS-level speech engine; no
audio leaves the device through our proxy. **iOS Safari** has
supported `webkitSpeechRecognition` since iOS 14.5, but **PWA**
installed-to-home-screen mode can be unreliable — the design treats
that path defensively: `supported` is the runtime feature check,
not a static assumption, and an unsupported environment simply
hides the mic. Real-device verification is a manual step in the
implementation plan.

## Error handling

`callAI` never throws — every failure is `{ ok: false, error }`. All
failure paths — not configured (mic hidden), STT unsupported (mic
hidden), STT denied / no-speech / other (inline error toast),
proxy network / non-2xx / `llm_error`, `unparseable` / `malformed` /
`empty_result` from the parser — collapse to the single inline error
state plus the sheet not opening. The form is never blocked, never
overwritten without Apply, never auto-saved.

## Performance

- The voice modules (`useVoiceRecorder`, `voiceParser`,
  `VoicePreviewSheet`) are **dynamically imported on first mic tap**
  via `import()`, so AddJob's initial render does not pay for
  `SpeechRecognition` wrapping code that most mounts never use.
- Voice state is local to the AddJob mic block — the rest of the
  Add Job form does not re-render while voice is in `listening` /
  `parsing` / `done`. Apply triggers exactly one batched setter call
  per filled field.
- Local sub-1 s parsing is a Phase 2 goal (the deterministic
  pre-pass); v1 ships AI-only with a ~3 s end-to-end target on a
  good network.

## Cost & efficiency

Per call: ~250 in (system prompt) + ~150 in (user transcript +
allowed enums) + ~150 out (JSON) ≈ 550 tokens. At Haiku rates
(~$1 / $5 per million in/out), one call costs roughly **$0.0006**.
At realistic field volumes — say 30 voice fills per tech per day
across 10,000 techs — about **$5/day** in AI cost. The Anthropic
spend cap on the proxy is the backstop.

## Validation summary

- The proxy validates `input` is an object (`400 bad_input`).
- The client embeds the allowed enums in the user message so Claude
  has nothing to invent.
- `parseVoiceParseResponse` enforces type and allow-list checks on
  every field — drops what doesn't pass. Returns `empty_result`
  when nothing survives.
- The UI's Apply step is the final gate — the tech sees every chip
  before any form mutation happens.

## Edge cases

- **Tech speaks total gibberish** → Claude returns `{}` → parser
  returns `empty_result` → "Couldn't read the voice fill — try
  again." The form is untouched.
- **Tech speaks for 30 seconds** → the browser STT auto-stops or the
  tech taps stop. Transcript is whatever it captured; sent as-is.
- **Mic permission denied** → `onError('denied')` → inline
  "Microphone permission required" notice; mic button stays.
- **No SpeechRecognition** (older browser) → button is hidden; no
  user-visible error.
- **Mid-flow tab switch / unmount** → hook's cleanup stops the
  recogniser; any in-flight `callAI` resolves into a no-op (the
  component is unmounted).
- **Conflicting field already populated** → the chip carries an
  "overwrites: …" sublabel (or "appends to: …" for notes) so the
  tech sees it before Apply.
- **Tech role** → the `revenue` chip is hidden from the preview
  sheet (the field mapper never applies revenue for techs); every
  other field flows the same way.
- **Press-and-hold pointer leaves the button mid-listen** →
  `onPointerLeave` stops the recogniser; the standard "stop → parse"
  path runs (or surfaces `no_speech` if nothing was captured).

## Future-proofing

The pipeline splits cleanly: **transcript source → `buildVoiceParseInput`
→ proxy → `parseVoiceParseResponse` → field mapper → UI Apply**.
Each is independently extensible:

- **Multilingual** — pass `lang` to `useVoiceRecorder`; the proxy
  prompt accepts non-English transcripts as-is (Claude handles
  multilingual). v1 ships `en-US`.
- **CSR / dispatch / call-centre intake** — feed a typed or
  recorded transcript into `parseVoiceParseResponse` directly; no
  mic needed. The parser is source-agnostic.
- **Photo + voice combined intake** — a future intake helper can
  call an OCR step, concatenate with a voice transcript, and pass
  the combined text through the same parser.
- **Bluetooth headset** — uses the OS's audio input; no code change.

## Testing

`tests/voiceParser.test.ts` (hand-rolled `tsx` runner):

- **buildVoiceParseInput** — packages transcript, vertical, and
  allowed enums; payment methods and conditions are hard-coded; the
  services and vehicleTypes pass through from opts.
- **parseVoiceParseResponse** —
  - clean JSON parsed into validated fields;
  - JSON inside markdown fences extracted;
  - non-JSON → `unparseable`;
  - non-object → `malformed`;
  - `{}` → `empty_result`;
  - **tire-job phrasing** ("Two tire replacement on a BMW X5 in
    Aventura cash") returns service / qty / vehicleType /
    vehicleMakeModel / location / paymentMethod populated;
  - **mechanic-job phrasing** ("Brake pads and rotors on a 2018
    Honda Accord. Customer paid 420 card") returns service /
    vehicleMakeModel / revenue / paymentMethod;
  - **detailing-job phrasing** ("Full detail on a Tesla in Miami
    Gardens") returns service / vehicleMakeModel / location;
  - **incomplete speech** ("Flat tire") returns just service;
  - **noisy wording** ("uhh so like a battery thing in Miami
    Gardens") still extracts the service and city;
  - **multiple quantities mentioned** — only the integer is used;
  - **highway wording** ("I-95") → `conditions: ['highway']`;
  - **emergency / roadside wording** → `conditions: ['emergency']`;
  - **late-night wording** ("at 2 AM") → `conditions: ['lateNight']`;
  - **invalid service id** (Claude returns "barbecue") → service
    dropped, other fields kept;
  - **out-of-range revenue** (50000 or -5) → revenue dropped;
  - **out-of-range quantity** (0 or 99) → quantity dropped;
  - **malformed JSON** (extra prose around the object) → still
    extracts via the `{ … }` regex;
  - **append behaviour** — when existing notes are `"Customer
    requested rear tires"` and voice extracts notes `"Valve stem
    replacement needed"`, the mapper produces `"Customer requested
    rear tires • Valve stem replacement needed"` by default; the
    replace branch overwrites.

UI-level behaviour verified manually (no component-test harness for
`SpeechRecognition`-driven flows): the press-and-hold gesture
(pointer-down/up/leave), the quick-tap toggle, swipe-to-remove on a
chip, the sticky Apply footer on a long sheet, the tech-safe hiding
of the revenue chip, and the helper-text rendering when idle.

The `voice_parse` proxy task gets a `curl` smoke test in the plan.
`useVoiceRecorder` and the UI are verified manually (no component
test harness for `SpeechRecognition`-driven flows).

## Files

- Modify `ai-proxy/worker.js` — add the `voice_parse` task.
- Create `src/lib/voiceParser.ts` — `VoiceParseInput`,
  `VoiceParseFields`, `VoiceParseResult`, `buildVoiceParseInput`,
  `parseVoiceParseResponse`.
- Create `src/lib/useVoiceRecorder.ts` — the STT hook.
- Modify `src/pages/AddJob.tsx` — 🎤 button, voice-flow state,
  field mapper, field-highlight wiring.
- Create `src/components/VoicePreviewSheet.tsx` — the chip-based
  review-before-apply bottom sheet.
- Modify `src/styles/app.css` — `.voice-mic-btn`, `.voice-error`,
  `.voice-sheet`, `.voice-chip`, `.field-just-filled` styles.
- Create `tests/voiceParser.test.ts` — logic tests.

## Out of scope (YAGNI)

- Live streaming transcription.
- Conversation memory or follow-up turns.
- Auto-triggering pricing AI from the parsed result.
- Multi-step AI workflows (parse → ask clarifying question → parse
  again).
- A chatbot UI of any kind.
- Multilingual v1 — the structure supports it but the prompt and
  test fixtures are `en-US` only.
- Audio sent through our proxy — STT stays in the browser.

## Future work (Phase 2 — committed, not in v1)

After v1 ships and is verified on real techs' phones, a separate
brainstorm → spec → plan cycle adds:

- **Local deterministic parser + confidence system** — regex /
  keyword extraction (tire sizes, dollar amounts, payment methods,
  conditions, phone numbers, common cities) runs **before** any AI
  call. When confidence is high enough across enough fields, the AI
  call is skipped entirely. Every field carries a `high | medium |
  low` confidence which the chip UI surfaces with green / amber /
  gray accents. Target: cut AI calls 40–60%.
- **Recent local memory** — last-seen cities / tire sizes / services
  / payment methods stored on-device (no AI memory). Used for typo
  correction, fuzzy validation, confidence boosting.
- **Voice shortcuts** — *"same customer"*, *"same location"*,
  *"same tire size"*, *"repeat job"* — resolved against the device's
  recent-job context, no AI.
- **Duplicate job detection** — after Apply, a lightweight
  same-phone / same-city / same-service / recent-timeframe check
  surfaces a **non-blocking** "Possible duplicate" warning. Never
  blocks save.
- **Offline queue** — if the network is unavailable, the transcript
  is captured locally; the AI parse retries automatically when the
  device reconnects. Transcript is never lost.

These items are sequenced after v1 because (a) the local parser
needs to know what AI actually gets wrong on this exact catalogue
to be designed well, (b) recent memory needs real usage to
populate, (c) shortcuts and duplicate detection build on that
memory, and (d) the offline queue is a real new persistence layer
deserving its own design.
