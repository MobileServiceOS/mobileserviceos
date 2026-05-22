// tests/components/useDirtyDraft.test.tsx
// Integration test for the dirty-aware draft hook.
//
// This is the test the plain-tsx runner structurally COULD NOT
// write: it needs a real React renderer to simulate the
// effect-timing interaction — a parent re-emitting new props while
// the user has unsaved edits. That interaction is the Wheel Rush
// "I edit settings and it goes right back" bug. renderHook +
// rerender reproduces it exactly.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDirtyDraft } from '@/lib/useDirtyDraft';

interface Brand { name: string; color: string }

describe('useDirtyDraft', () => {
  it('mirrors upstream on mount and starts clean', () => {
    const { result } = renderHook(() =>
      useDirtyDraft<Brand>({ name: 'Wheel Rush', color: '#f4b400' }));
    expect(result.current.draft).toEqual({ name: 'Wheel Rush', color: '#f4b400' });
    expect(result.current.dirty).toBe(false);
  });

  it('set() updates one field and marks the draft dirty', () => {
    const { result } = renderHook(() =>
      useDirtyDraft<Brand>({ name: 'A', color: '#fff' }));
    act(() => result.current.set('name', 'B'));
    expect(result.current.draft.name).toBe('B');
    expect(result.current.draft.color).toBe('#fff');
    expect(result.current.dirty).toBe(true);
  });

  it('patch() updates multiple fields and marks dirty', () => {
    const { result } = renderHook(() =>
      useDirtyDraft<Brand>({ name: 'A', color: '#fff' }));
    act(() => result.current.patch({ name: 'B', color: '#000' }));
    expect(result.current.draft).toEqual({ name: 'B', color: '#000' });
    expect(result.current.dirty).toBe(true);
  });

  it('re-syncs from upstream when the form is CLEAN', () => {
    const { result, rerender } = renderHook(
      ({ up }: { up: Brand }) => useDirtyDraft<Brand>(up),
      { initialProps: { up: { name: 'A', color: '#fff' } } },
    );
    // Parent emits new state — clean form, so it flows through.
    rerender({ up: { name: 'A-updated', color: '#000' } });
    expect(result.current.draft).toEqual({ name: 'A-updated', color: '#000' });
  });

  it('PRESERVES in-flight edits when upstream re-emits while DIRTY', () => {
    // ── The production bug, encoded ──
    // A settings form holds a local draft. The parent (BrandContext /
    // App settings) re-emits on every Firestore snapshot. Before the
    // dirty guard, that re-emit clobbered whatever the user was
    // typing. This test fails loudly if the guard ever regresses.
    const { result, rerender } = renderHook(
      ({ up }: { up: Brand }) => useDirtyDraft<Brand>(up),
      { initialProps: { up: { name: 'A', color: '#fff' } } },
    );
    act(() => result.current.set('name', 'USER IS TYPING THIS'));
    // Snapshot listener fires mid-edit with different server data.
    rerender({ up: { name: 'SERVER VALUE', color: '#000' } });
    expect(result.current.draft.name).toBe('USER IS TYPING THIS');
  });

  it('markClean() lets the next upstream emit through (post-save)', () => {
    const { result, rerender } = renderHook(
      ({ up }: { up: Brand }) => useDirtyDraft<Brand>(up),
      { initialProps: { up: { name: 'A', color: '#fff' } } },
    );
    act(() => result.current.set('name', 'EDITED'));
    expect(result.current.dirty).toBe(true);
    // Simulate a successful save → markClean().
    act(() => result.current.markClean());
    expect(result.current.dirty).toBe(false);
    // Now an upstream emit (the saved value arriving back) syncs.
    rerender({ up: { name: 'EDITED', color: '#fff' } });
    expect(result.current.draft.name).toBe('EDITED');
  });

  it('replace(next) swaps the draft and marks dirty (default)', () => {
    // markDirty defaults true — dirty blocks re-sync, so the
    // replaced value sticks regardless of upstream.
    const { result } = renderHook(
      ({ up }: { up: Brand }) => useDirtyDraft<Brand>(up),
      { initialProps: { up: { name: 'A', color: '#fff' } } },
    );
    act(() => result.current.replace({ name: 'Z', color: '#111' }));
    expect(result.current.draft).toEqual({ name: 'Z', color: '#111' });
    expect(result.current.dirty).toBe(true);
  });

  it('replace(next, false) clears dirty — post-save with the saved value', () => {
    // The real-app use: BrandSection.save() calls replace(savedValue,
    // false) AFTER persisting, where savedValue is what upstream is
    // about to become. A clean form mirrors upstream, so replacing
    // with the soon-to-match value + clearing dirty is consistent.
    const { result } = renderHook(
      ({ up }: { up: Brand }) => useDirtyDraft<Brand>(up),
      { initialProps: { up: { name: 'A', color: '#fff' } } },
    );
    act(() => result.current.set('name', 'edited'));
    expect(result.current.dirty).toBe(true);
    // Save handler replaces with a value that equals upstream.
    act(() => result.current.replace({ name: 'A', color: '#fff' }, false));
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft).toEqual({ name: 'A', color: '#fff' });
  });

  it('a dirty edit survives MULTIPLE upstream emits, then markClean releases', () => {
    const { result, rerender } = renderHook(
      ({ up }: { up: Brand }) => useDirtyDraft<Brand>(up),
      { initialProps: { up: { name: 'A', color: '#fff' } } },
    );
    act(() => result.current.set('name', 'MINE'));
    rerender({ up: { name: 'srv1', color: '#111' } });
    rerender({ up: { name: 'srv2', color: '#222' } });
    rerender({ up: { name: 'srv3', color: '#333' } });
    expect(result.current.draft.name).toBe('MINE');
    act(() => result.current.markClean());
    rerender({ up: { name: 'srv4', color: '#444' } });
    expect(result.current.draft.name).toBe('srv4');
  });
});
