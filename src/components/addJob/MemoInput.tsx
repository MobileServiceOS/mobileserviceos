// src/components/addJob/MemoInput.tsx
// ═══════════════════════════════════════════════════════════════════
//  Memoized input primitives for AddJob.
//
//  Perf P1-3 fix (2026-05-31): inline <input> / <textarea> / <select>
//  elements inside AddJob re-render on every keystroke even when their
//  own value is unchanged, because the parent (AddJob) re-renders
//  whenever jobDraft changes. With React.memo + a stable onChange
//  callback (useCallback in the parent), each field component skips
//  re-render when its OWN value didn't change. Typing in customerName
//  no longer reconciles the tireSize input, the qty input, etc.
//
//  Each primitive expects:
//    - value: the current value (controlled)
//    - onChange: a STABLE callback (pre-bound via useCallback in the
//      parent) that receives the new value as a plain string
//    - presentation props pass through (placeholder, autoComplete,
//      inputMode, etc.) — these are usually static, so the shallow
//      memo equality check stays cheap
//
//  These are intentionally not generic over the Job key — the parent
//  binds the field key into the onChange callback. That keeps these
//  components decoupled from the Job type so they can be reused
//  outside AddJob (Settings forms, Onboarding) if useful later.
// ═══════════════════════════════════════════════════════════════════

import { memo, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';

// ─── MemoInput ───────────────────────────────────────────────────────

interface MemoInputProps {
  value: string | number;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
  // a11y P1-2 (2026-05-31): id lets parents pair this input with its
  // visible label via htmlFor → id. AT users hear the label text
  // (e.g. "Customer name") instead of "edit text, blank".
  id?: string;
}

function MemoInputImpl({ value, onChange, onBlur, type, inputMode, placeholder, autoComplete, disabled, className, id }: MemoInputProps) {
  return (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      className={className}
    />
  );
}

export const MemoInput = memo(MemoInputImpl);

// ─── MemoTextarea ────────────────────────────────────────────────────

interface MemoTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: TextareaHTMLAttributes<HTMLTextAreaElement>['rows'];
  disabled?: boolean;
  id?: string;
}

function MemoTextareaImpl({ value, onChange, placeholder, rows, disabled, id }: MemoTextareaProps) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
    />
  );
}

export const MemoTextarea = memo(MemoTextareaImpl);

// ─── MemoSelect ──────────────────────────────────────────────────────

interface MemoSelectProps {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  id?: string;
}

function MemoSelectImpl({ value, onChange, children, disabled, id }: MemoSelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {children}
    </select>
  );
}

export const MemoSelect = memo(MemoSelectImpl);
