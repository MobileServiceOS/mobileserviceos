// tests/emojiLabel.test.ts
// Run: npx tsx tests/emojiLabel.test.ts
//
// Batch E (2026-06-05): pin splitEmojiLabel so the chip-label
// accessibility fix doesn't silently regress. The helper extracts a
// leading emoji from strings like "🚨 Emergency" so the chip render
// site can wrap the emoji in <span aria-hidden="true">. If this
// helper stops detecting an emoji prefix, screen readers go back to
// reading "fire engine emoji Emergency" and we've shipped a11y debt
// for nothing.

import { splitEmojiLabel } from '@/lib/emojiLabel';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const j = JSON.stringify;

console.log('\n── tire/mechanic/detailing conditions chip labels ──');
{
  const r = splitEmojiLabel('🚨 Emergency');
  check('🚨 Emergency → emoji "🚨"', r.emoji === '🚨', `got emoji=${j(r.emoji)}`);
  check('🚨 Emergency → text "Emergency"', r.text === 'Emergency', `got text=${j(r.text)}`);
}
{
  const r = splitEmojiLabel('🌙 Late Night');
  check('🌙 Late Night → emoji "🌙"', r.emoji === '🌙', `got emoji=${j(r.emoji)}`);
  check('🌙 Late Night → text "Late Night"', r.text === 'Late Night', `got text=${j(r.text)}`);
}
{
  // Variation selector U+FE0F follows the highway glyph in tire.ts /
  // detailing.ts — it forces emoji presentation on dual-use codepoints.
  // The regex MUST swallow it as part of the emoji cluster or the
  // selector ends up at the start of `text` and reads as a stray box.
  const r = splitEmojiLabel('🛣️ Highway');
  check('🛣️ Highway → emoji includes U+FE0F', r.emoji === '🛣️', `got emoji=${j(r.emoji)} (len=${r.emoji.length})`);
  check('🛣️ Highway → text "Highway"', r.text === 'Highway', `got text=${j(r.text)}`);
}
{
  // mechanic.ts uses the bare 🛣 codepoint (no variation selector).
  // The helper must work both ways.
  const r = splitEmojiLabel('🛣 Highway');
  check('🛣 Highway (no VS) → emoji "🛣"', r.emoji === '🛣', `got emoji=${j(r.emoji)}`);
  check('🛣 Highway (no VS) → text "Highway"', r.text === 'Highway', `got text=${j(r.text)}`);
}
{
  const r = splitEmojiLabel('📅 Weekend');
  check('📅 Weekend → emoji "📅"', r.emoji === '📅', `got emoji=${j(r.emoji)}`);
  check('📅 Weekend → text "Weekend"', r.text === 'Weekend', `got text=${j(r.text)}`);
}

console.log('\n── no leading emoji (pass through) ──');
{
  const r = splitEmojiLabel('Plain Text');
  check('Plain Text → emoji ""', r.emoji === '', `got emoji=${j(r.emoji)}`);
  check('Plain Text → text unchanged', r.text === 'Plain Text', `got text=${j(r.text)}`);
}
{
  // Numeric / punctuation prefixes are not pictographs.
  const r = splitEmojiLabel('123 Main St');
  check('123 Main St → emoji ""', r.emoji === '');
  check('123 Main St → text unchanged', r.text === '123 Main St');
}

console.log('\n── empty/edge cases ──');
{
  const r = splitEmojiLabel('');
  check('"" → emoji ""', r.emoji === '', `got emoji=${j(r.emoji)}`);
  check('"" → text ""', r.text === '', `got text=${j(r.text)}`);
}
{
  // Emoji-only (no trailing text) — chip labels never look like this
  // today but the helper shouldn't blow up if a config ever ships one.
  const r = splitEmojiLabel('🚨');
  check('🚨 alone → emoji "🚨"', r.emoji === '🚨', `got emoji=${j(r.emoji)}`);
  check('🚨 alone → text ""',    r.text === '',    `got text=${j(r.text)}`);
}

console.log('\n── Unicode edge case: skin-tone modifier ──');
{
  // Skin-tone modifier (U+1F3FD) follows a base emoji. The regex's
  // optional [U+1F3FB-U+1F3FF] branch should swallow it as part of
  // the cluster, not leak into `text`.
  const r = splitEmojiLabel('👍🏽 Approved');
  check('👍🏽 Approved → emoji includes skin tone', r.emoji === '👍🏽',
    `got emoji=${j(r.emoji)} (len=${r.emoji.length})`);
  check('👍🏽 Approved → text "Approved"', r.text === 'Approved', `got text=${j(r.text)}`);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
