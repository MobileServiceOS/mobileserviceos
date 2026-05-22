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
