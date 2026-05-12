import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Underlying numeric value held by the parent. Use `number | ''` to
   *  allow the "cleared while editing" state cleanly. */
  value: number | string;
  /** Called with the parsed number (or 0 when blank on blur). */
  onChange: (n: number) => void;
  placeholder?: string;
  /** Allow decimals. Default true. Set false for qty/integer-only fields. */
  decimals?: boolean;
  disabled?: boolean;
  /** Forwarded for accessibility / styling. */
  id?: string;
  /** Visual width override. */
  style?: Record<string, unknown>;
  /** Tab order */
  tabIndex?: number;
  /** When true, picks the field's text on focus so the user can immediately
   *  overtype the existing value instead of tapping-and-erasing. */
  selectOnFocus?: boolean;
}

/**
 * Mobile-first numeric input.
 *
 * Problems this solves:
 *   - Native <input type="number" value={0}> shows "0" which forces the
 *     operator to tap-and-erase before they can type. Field workflows
 *     hate this.
 *   - Manual parseFloat patterns scatter NaN-safety logic across the codebase.
 *   - Cursor jumps when re-rendering numbers that round-trip through
 *     `Number()` then back to string.
 *
 * Behavior:
 *   - Renders the value as text. When the underlying number is 0 (and the
 *     user isn't currently typing), the input shows empty. The placeholder
 *     fills the visual gap.
 *   - On focus: if value is 0 or empty, the displayed text clears so the
 *     user can type without erasing first. Numbers > 0 are shown normally
 *     and (optionally) selected.
 *   - While editing: the user types freely — including a lone "." for a
 *     decimal in progress. We don't fight the keystroke.
 *   - On blur: parse the typed text. If valid → fire onChange with the
 *     number. If blank or invalid → fire onChange(0) so the parent state
 *     never holds NaN.
 *
 * The internal `text` state exists ONLY during the focused editing
 * window. When unfocused, we always render from props so the parent's
 * source-of-truth wins (important for auto-fill / programmatic updates).
 */
export function NumberField({
  value, onChange, placeholder, decimals = true, disabled, id, style, tabIndex, selectOnFocus,
}: Props) {
  const [editing, setEditing] = useState(false);
  // Mid-edit text. Allowed to be any string ("", "1.", "1.5"). Only consulted
  // while `editing` is true.
  const [text, setText] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Display value when NOT focused: empty string for 0/blank so the user
  // sees the placeholder. Number-as-string otherwise.
  const displayWhenIdle = (() => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    // Strip trailing ".0" — looks cleaner.
    return String(n);
  })();

  // Keep internal text in sync if the parent changes value while focused
  // (e.g. auto-fill effect runs). We don't want to overwrite user typing
  // mid-keystroke, so only sync when the parent value differs from what
  // the current text parses to.
  useEffect(() => {
    if (!editing) return;
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed === Number(value)) return;
    setText(displayWhenIdle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleFocus = (e: { target: HTMLInputElement }) => {
    setEditing(true);
    const n = Number(value);
    // Clear the visible "0" so the operator can immediately type. Keep
    // real numbers visible (and select them if requested).
    if (!Number.isFinite(n) || n === 0) {
      setText('');
    } else {
      setText(String(n));
      if (selectOnFocus) {
        // Use rAF so the select happens after the focus event settles —
        // Mobile Safari otherwise loses the selection.
        requestAnimationFrame(() => e.target.select());
      }
    }
  };

  const handleChange = (e: { target: HTMLInputElement }) => {
    let v = e.target.value;
    // Block stray characters; allow digits, one optional dot (when decimals=true),
    // and a leading minus. Don't reformat — just gate.
    if (decimals) {
      // First strip everything except digits, dot, minus.
      v = v.replace(/[^0-9.\-]/g, '');
      // Keep only the first dot.
      const firstDot = v.indexOf('.');
      if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
      }
    } else {
      v = v.replace(/[^0-9\-]/g, '');
    }
    setText(v);
    // Fire parent onChange with whatever's typeable as a number RIGHT NOW.
    // "" and "." and "-" don't parse — those fire onChange(0) so the
    // parent doesn't see NaN. We don't lose the user's keystrokes because
    // `text` is the source of truth while editing.
    const parsed = Number(v);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
    } else if (v === '' || v === '.' || v === '-') {
      onChange(0);
    }
  };

  const handleBlur = () => {
    setEditing(false);
    // On blur, the parent already has the correct number from the last
    // change event. Nothing more to do — the displayed value will come
    // from `displayWhenIdle` on next render.
  };

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      // Hint to mobile keyboards that this is a number field. iOS still
      // shows the full keyboard but suggests digits.
      pattern={decimals ? '[0-9]*\\.?[0-9]*' : '[0-9]*'}
      value={editing ? text : displayWhenIdle}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder ?? '0'}
      disabled={disabled}
      style={style as never}
      tabIndex={tabIndex}
      autoComplete="off"
    />
  );
}
