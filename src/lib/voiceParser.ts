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
  // First, try to parse the full trimmed text as JSON to catch non-object
  // types (e.g. arrays) and return 'malformed' rather than 'unparseable'.
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('"') || trimmed === 'null' || trimmed === 'true' || trimmed === 'false') {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object') {
        // Covers arrays and other non-plain-object types
        return { ok: false, error: 'malformed' };
      }
    } catch {
      // fall through to regex extraction
    }
  }
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
