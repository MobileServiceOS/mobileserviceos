// ═══════════════════════════════════════════════════════════════════
//  tests/zettleCrypto.test.ts
//  Run: npx tsx tests/zettleCrypto.test.ts   (also runs via `npm test`)
//
//  Round-trip + tamper tests for the AES-256-GCM token encryption used
//  to store Zettle OAuth tokens at rest.
// ═══════════════════════════════════════════════════════════════════

import { randomBytes } from 'crypto';

// 32-byte base64 key BEFORE importing the module functions use it lazily.
process.env.ZETTLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64');

import { encryptToken, decryptToken } from '../functions/src/lib/zettleCrypto';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── round trip ──');
{
  const secret = 'refresh-token-abc.123_XYZ-with-special/=chars';
  const enc = encryptToken(secret);
  check('ciphertext differs from plaintext', enc !== secret);
  check('ciphertext is base64', /^[A-Za-z0-9+/]+=*$/.test(enc));
  check('decrypts back to original', decryptToken(enc) === secret, decryptToken(enc));
}

console.log('\n── unique IV per call ──');
{
  const a = encryptToken('same');
  const b = encryptToken('same');
  check('two encryptions differ (random IV)', a !== b);
  check('both decrypt to same plaintext', decryptToken(a) === 'same' && decryptToken(b) === 'same');
}

console.log('\n── tamper detection ──');
{
  const enc = encryptToken('tamper-me');
  const raw = Buffer.from(enc, 'base64');
  raw[raw.length - 1] ^= 0x01; // flip a ciphertext bit
  const tampered = raw.toString('base64');
  let threw = false;
  try { decryptToken(tampered); } catch { threw = true; }
  check('tampered ciphertext throws (GCM auth)', threw);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} zettleCrypto: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
