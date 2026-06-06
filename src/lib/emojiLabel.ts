// src/lib/emojiLabel.ts
// ═══════════════════════════════════════════════════════════════════
//  splitEmojiLabel — split "🚨 Emergency" → { emoji: "🚨", text: "Emergency" }
//  ────────────────────────────────────────────────────────────────────
//  Background:
//  Several chip labels in the app live as a single string with a
//  decorative emoji prefix (e.g. tire.ts conditions: "🚨 Emergency").
//  Sighted users see the icon as a visual hint; screen-reader users
//  get the emoji read aloud first — "fire engine emoji Emergency",
//  "moon emoji Late Night", "world map emoji Highway" — which is
//  noise that obscures the meaningful word.
//
//  This helper extracts a leading emoji (with its optional variation
//  selector U+FE0F or skin-tone modifier) so the chip render site can
//  wrap the emoji in <span aria-hidden="true"> and leave the trailing
//  text bare. Visual output stays identical; AT announcement becomes
//  "Emergency" instead of "fire engine emoji Emergency".
//
//  Scope:
//  Strict leading-emoji parse. We do NOT try to strip emoji from the
//  middle/end of a string — chip labels in this codebase only ever
//  have the emoji at the start. If a label has no leading emoji we
//  return it unchanged so callers can use this helper unconditionally.
//
//  Pinned by tests/emojiLabel.test.ts.
// ═══════════════════════════════════════════════════════════════════

/**
 * Match a single leading Extended_Pictographic glyph, optionally
 * followed by:
 *   • U+FE0F variation selector (forces emoji presentation, e.g. 🛣️)
 *   • a skin-tone modifier (U+1F3FB–U+1F3FF)
 *   • ZWJ-joined continuation pictographs (e.g. 👨‍👩‍👧)
 *
 * The `u` flag enables \p{…} property escapes (Unicode-aware regex).
 * Capture group 1 is the emoji cluster; we then take the remainder
 * after stripping a single leading whitespace separator.
 */
const LEADING_EMOJI_RE =
  /^(\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*)\s*(.*)$/u;

export interface EmojiLabelParts {
  /** Leading emoji cluster, or '' if none. */
  emoji: string;
  /** Remaining label text (trimmed), or the original string when no leading emoji. */
  text: string;
}

/**
 * Split a chip label like "🚨 Emergency" into its decorative emoji
 * prefix and the spoken text. Inputs without a leading pictograph
 * pass through with `emoji: ''` and the original `text` so callers
 * can render unconditionally.
 *
 * @example
 *   splitEmojiLabel('🚨 Emergency')  // { emoji: '🚨', text: 'Emergency' }
 *   splitEmojiLabel('🛣️ Highway')   // { emoji: '🛣️', text: 'Highway' }
 *   splitEmojiLabel('Plain')        // { emoji: '', text: 'Plain' }
 *   splitEmojiLabel('')             // { emoji: '', text: '' }
 */
export function splitEmojiLabel(label: string): EmojiLabelParts {
  if (!label) return { emoji: '', text: '' };
  const m = LEADING_EMOJI_RE.exec(label);
  if (!m || !m[1]) return { emoji: '', text: label };
  return { emoji: m[1], text: (m[2] ?? '').trim() };
}
