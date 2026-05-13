import { useEffect, useRef, useState } from 'react';

// Structural ref type — avoids depending on `RefObject` being exported
// (it is in real React, but the stub env we use for type-check guard
// rejects the named import).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldRef = { current: any };

interface Props {
  /** Underlying numeric value held by the parent. */
  value: number | string;
  /** Called with the parsed number (or 0 when blank). */
  onChange: (n: number) => void;
  placeholder?: string;
  /** Allow decimals. Default true. Set false for qty/integer-only fields. */
  decimals?: boolean;
  disabled?: boolean;
  id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: Record<string, any>;
  tabIndex?: number;
  /** Select all text on focus so user can immediately overtype. */
  selectOnFocus?: boolean;
  /** External ref to the underlying <input>. Parents pass this when they
   *  want to focus this field programmatically (e.g. from another field's
   *  Enter key). */
  inputRef?: FieldRef;
  /** Auto-focus the field that this ref points to when the user presses
   *  Enter / Next. Forms the "miles → tire $ → qty" chain in Quick Quote. */
  nextFieldRef?: FieldRef;
  /** Hint to mobile keyboards for what the Return key should say. Use
   *  `'next'` when a `nextFieldRef` exists, `'done'` for terminal fields.
   *  iOS Safari + Android Chrome both honor this in 2024+. */
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
}

/**
 * Mobile-first numeric input with optional Enter-to-next chaining.
 *
 * Behavior:
 *   - Renders blank when value is 0 + not focused. Placeholder fills the gap.
 *   - On focus: if value is 0 or blank, displayed text clears so the user
 *     can type immediately. Numbers > 0 are shown (and selected if requested).
 *   - On typing: characters are gated (digits + one dot + leading minus).
 *     Parent's onChange fires with the parsed number — or 0 for blank/./-.
 *   - On blur: state holds the last committed number.
 *   - On Enter/Return: if `nextFieldRef` is set, focus that field. Otherwise
 *     no-op (we don't auto-submit per the spec).
 *
 * The chain pattern in Quick Quote:
 *   <NumberField inputRef={milesRef}  nextFieldRef={tireRef}  enterKeyHint="next" />
 *   <NumberField inputRef={tireRef}   nextFieldRef={qtyRef}   enterKeyHint="next" />
 *   <NumberField inputRef={qtyRef}                            enterKeyHint="done" />
 */
export function NumberField({
  value, onChange, placeholder, decimals = true, disabled, id, style, tabIndex,
  selectOnFocus, inputRef, nextFieldRef, enterKeyHint,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>('');
  // Local fallback ref so the internal element is always reachable even
  // when the parent didn't pass one in.
  const localRef = useRef<HTMLInputElement | null>(null);
  // The ref we actually attach to the <input>. Prefers the parent's ref.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachRef = (el: HTMLInputElement | null) => {
    localRef.current = el;
    if (inputRef) {
      // RefObject is typed `readonly` in some React versions; cast to
      // bypass the strictness — it's a standard cross-version idiom.
      (inputRef as { current: HTMLInputElement | null }).current = el;
    }
  };

  // Display when NOT focused: empty string for 0/blank, number-as-string otherwise.
  const displayWhenIdle = (() => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return String(n);
  })();

  // Keep internal text in sync if the parent changes value while focused
  // (e.g. an auto-fill effect runs mid-edit).
  useEffect(() => {
    if (!editing) return;
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed === Number(value)) return;
    setText(displayWhenIdle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFocus = (e: any) => {
    setEditing(true);
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) {
      setText('');
    } else {
      setText(String(n));
      if (selectOnFocus) {
        // rAF so select happens after focus settles (mobile Safari quirk).
        requestAnimationFrame(() => {
          try { e?.target?.select?.(); } catch { /* ignore */ }
        });
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChange = (e: any) => {
    let v: string = e?.target?.value ?? '';
    if (decimals) {
      v = v.replace(/[^0-9.\-]/g, '');
      const firstDot = v.indexOf('.');
      if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
      }
    } else {
      v = v.replace(/[^0-9\-]/g, '');
    }
    setText(v);
    const parsed = Number(v);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
    } else if (v === '' || v === '.' || v === '-') {
      onChange(0);
    }
  };

  const handleBlur = () => setEditing(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleKeyDown = (e: any) => {
    if (e?.key !== 'Enter') return;
    // Prevent the form from submitting (we're in a card, not a form,
    // but this is also what stops the browser's default action).
    if (typeof e.preventDefault === 'function') e.preventDefault();

    // If a next-field target was provided, focus it. This is what creates
    // the "miles → tire $ → qty" rapid-entry chain. If no target, just
    // blur the keyboard down — that's the natural "I'm done" signal.
    const target = nextFieldRef?.current;
    if (target && typeof target.focus === 'function') {
      target.focus();
    } else if (typeof e?.target?.blur === 'function') {
      e.target.blur();
    }
  };

  return (
    <input
      ref={attachRef}
      id={id}
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      pattern={decimals ? '[0-9]*\\.?[0-9]*' : '[0-9]*'}
      enterKeyHint={enterKeyHint}
      value={editing ? text : displayWhenIdle}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder ?? '0'}
      disabled={disabled}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={style as any}
      tabIndex={tabIndex}
      autoComplete="off"
    />
  );
}
