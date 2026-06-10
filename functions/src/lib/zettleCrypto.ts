// functions/src/lib/zettleCrypto.ts
// ═══════════════════════════════════════════════════════════════════
//  zettleCrypto — encrypt OAuth tokens at rest.
//
//  Zettle access/refresh tokens are stored in the Functions-only
//  private path (zettleSecure/{businessId}/private/tokens) which no
//  client can read (firestore.rules: `allow read, write: if false`).
//  Defense in
//  depth: we ALSO encrypt them at rest so a Firestore export / backup
//  leak doesn't hand over live tokens.
//
//  AES-256-GCM with a 32-byte key from ZETTLE_TOKEN_ENC_KEY (base64).
//  Output format (base64):  iv(12) || authTag(16) || ciphertext.
//
//  Pure Node `crypto` — no firebase imports, so it's unit-testable from
//  the root tsx runner (tests/zettleCrypto.test.ts) with the env key set.
// ═══════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_LEN = 12;   // GCM standard nonce length
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ZETTLE_TOKEN_ENC_KEY;
  if (!raw) throw new Error('ZETTLE_TOKEN_ENC_KEY not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`ZETTLE_TOKEN_ENC_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

/** Encrypt a plaintext token → base64(iv || tag || ciphertext). */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a value produced by encryptToken(). Throws on tamper/wrong key. */
export function decryptToken(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
