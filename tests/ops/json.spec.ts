// tests/ops/json.spec.ts — safe JSON parsing of model output, incl. malformed.
import { describe, it, expect } from 'vitest';
import { safeParseJson, stripCodeFences, asNumber, asString } from '@/lib/ops/json';

describe('stripCodeFences', () => {
  it('strips ```json fences', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('strips bare ``` fences', () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('leaves un-fenced text untouched', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('safeParseJson', () => {
  it('parses plain JSON', () => {
    const r = safeParseJson<{ a: number }>('{"a":1}');
    expect(r.ok && r.value.a).toBe(1);
  });
  it('parses fenced JSON', () => {
    const r = safeParseJson<{ ok: boolean }>('```json\n{"ok":true}\n```');
    expect(r.ok && r.value.ok).toBe(true);
  });
  it('extracts JSON wrapped in prose (prefix)', () => {
    const r = safeParseJson<{ reply: string }>('Here is the JSON: {"reply":"hi"}');
    expect(r.ok && r.value.reply).toBe('hi');
  });
  it('extracts JSON with trailing prose', () => {
    const r = safeParseJson<{ a: number }>('{"a":2} hope that helps!');
    expect(r.ok && r.value.a).toBe(2);
  });
  it('parses an array root', () => {
    const r = safeParseJson<number[]>('[1,2,3]');
    expect(r.ok && r.value.length).toBe(3);
  });

  // Malformed / hostile inputs must never throw — always a tagged failure.
  it('fails on truncated JSON', () => {
    expect(safeParseJson('{"a":').ok).toBe(false);
  });
  it('fails on non-JSON prose', () => {
    expect(safeParseJson('I cannot help with that.').ok).toBe(false);
  });
  it('fails on empty / whitespace', () => {
    expect(safeParseJson('').ok).toBe(false);
    expect(safeParseJson('   ').ok).toBe(false);
  });
  it('fails on null / undefined without throwing', () => {
    expect(safeParseJson(null).ok).toBe(false);
    expect(safeParseJson(undefined).ok).toBe(false);
  });
});

describe('coercion helpers', () => {
  it('asNumber coerces strings and falls back', () => {
    expect(asNumber('5')).toBe(5);
    expect(asNumber('nope', 7)).toBe(7);
    expect(asNumber(undefined, 3)).toBe(3);
    expect(asNumber(Infinity, 0)).toBe(0);
  });
  it('asString trims and falls back', () => {
    expect(asString('  hi ')).toBe('hi');
    expect(asString(null, 'x')).toBe('x');
    expect(asString(42)).toBe('42');
  });
});
