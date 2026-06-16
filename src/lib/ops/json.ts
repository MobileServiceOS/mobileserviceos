// src/lib/ops/json.ts
// ═══════════════════════════════════════════════════════════════════
//  Safe JSON parsing for model output.
//
//  The model is PROMPTED to return JSON only, but a language model is
//  not a guarantee — it may wrap the JSON in ```fences```, prepend a
//  sentence ("Here is the JSON:"), or emit something unparseable. We
//  NEVER render raw model text as structured data. Every loop pipes the
//  raw text through safeParseJson, then validates the shape before use.
//
//  Pure + dependency-free so it is trivially unit-tested against
//  malformed input.
// ═══════════════════════════════════════════════════════════════════

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Strip a leading/trailing Markdown code fence if present. Handles
 * ```json … ``` and bare ``` … ``` and leaves un-fenced text untouched.
 */
export function stripCodeFences(raw: string): string {
  let s = (raw ?? '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z0-9]*[ \t]*\r?\n?/, '');
    s = s.replace(/\r?\n?```[ \t]*$/, '');
  }
  return s.trim();
}

/**
 * Best-effort extraction of the first balanced-looking JSON value when
 * the model wrapped it in prose. Finds the first `{`/`[` and the last
 * matching `}`/`]`. Not a full parser — JSON.parse still validates.
 */
function extractJsonSubstring(s: string): string | null {
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  if (firstObj === -1 && firstArr === -1) return null;

  let start: number;
  let close: string;
  if (firstArr === -1 || (firstObj !== -1 && firstObj < firstArr)) {
    start = firstObj;
    close = '}';
  } else {
    start = firstArr;
    close = ']';
  }
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  return s.slice(start, end + 1);
}

/**
 * Parse model output into JSON without ever throwing. Returns a tagged
 * result so callers branch on `ok` instead of wrapping in try/catch.
 * Tries: (1) the cleaned string directly, (2) an extracted JSON
 * substring if prose surrounds it.
 */
export function safeParseJson<T = unknown>(raw: string | null | undefined): ParseResult<T> {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, error: 'empty response' };
  }
  const cleaned = stripCodeFences(String(raw));

  const tryParse = (s: string): ParseResult<T> | null => {
    try {
      return { ok: true, value: JSON.parse(s) as T };
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  const extracted = extractJsonSubstring(cleaned);
  if (extracted) {
    const viaExtract = tryParse(extracted);
    if (viaExtract) return viaExtract;
  }

  return { ok: false, error: 'response was not valid JSON' };
}

/** Coerce an unknown to a finite number, or fall back. */
export function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

/** Coerce an unknown to a trimmed string, or fall back. */
export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return fallback;
  return String(v).trim();
}
