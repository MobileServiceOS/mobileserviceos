import { SupplierConnector, SupplierTireResult } from './supplierTypes';
import { readLatestSession, SUPPLIER_FIELD_KEYS } from './sessionStore';
import { serializeCookieHeader, ParsedCookie } from './cookieParsers';
import {
  SessionExpiredError,
  SessionMissingError,
  ParserNotCalibratedError,
  scrubError,
} from './sessionErrors';

// U.S. AutoForce connector — Phase 2a (real session-based).
//
// The flow:
//   1. Read the latest session envelope from Secret Manager
//   2. Serialize cookies into a request header
//   3. Hit shop.usautoforce.com root with the session
//   4. Detect expiry via redirect URL / body markers / status code
//   5. Throw a typed error that supplierSearchService maps to a
//      specific user-facing warning
//
// Phase 2a does NOT include the catalog parser. The search endpoint
// + response shape need to be calibrated against a real authenticated
// session — the public web has no clues. Once the owner connects, we
// run one real search, capture the URL + response, and add the parser
// in Phase 2b. Until then, this connector throws
// ParserNotCalibratedError after verifying the session is valid.
//
// SECURITY:
//   - Cookies are read from Secret Manager on every call (no caching
//     of the raw payload outside the request scope)
//   - Errors are scrubbed before being thrown — see sessionErrors.ts
//   - No console.log of cookie payloads anywhere in this file

const BASE_URL = 'https://shop.usautoforce.com';
const FIELD_KEY = SUPPLIER_FIELD_KEYS['U.S. AutoForce'];

// Stealth-friendly UA. Real browsers in the field. NOT a "headless"
// signature.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Stored-session lookup helper exposed for the verify callable's
// cache layer (cache key includes savedAt → callable needs the stored
// timestamp). Returns null when no session exists yet.
export async function loadUsAutoForceSessionMeta(): Promise<
  { cookies: ParsedCookie[]; savedAt: string } | null
> {
  const session = await readLatestSession(FIELD_KEY);
  if (!session || session.envelope.cookies.length === 0) return null;
  return {
    cookies: session.envelope.cookies,
    savedAt: session.envelope.savedAt,
  };
}

// Issue the real authenticated request to the portal and interpret
// the response. Exposed so the verify callable can call this directly
// (with its own cache layer) without re-reading the session doc.
export async function fetchUsAutoForceSessionStatus(
  cookies: ParsedCookie[]
): Promise<'valid' | 'expired'> {
  const cookieHeader = serializeCookieHeader(cookies);
  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/`, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (err) {
    // Network-level failure isn't an expiry signal — surface as expired
    // so the UI prompts a reconnect (worst-case false positive).
    console.log(JSON.stringify({
      fn: 'fetchUsAutoForceSessionStatus',
      event: 'network-error',
      err: scrubError(err),
    }));
    return 'expired';
  }
  return interpretSessionResponse(resp);
}

// Verify the stored session is still valid by hitting the portal root.
// Returns 'valid' | 'expired' | 'missing' — never throws on the happy
// paths. Used by the search path via the connector; the verify
// callable composes loadUsAutoForceSessionMeta + cache lookup +
// fetchUsAutoForceSessionStatus directly so it can short-circuit on
// cache hits.
export async function verifyUsAutoForceSession(): Promise<
  'valid' | 'expired' | 'missing'
> {
  const meta = await loadUsAutoForceSessionMeta();
  if (!meta) return 'missing';
  return fetchUsAutoForceSessionStatus(meta.cookies);
}

// Shared expiry-detection logic. Three independent signals; any one
// trips. Returns 'valid' if all three look authenticated.
async function interpretSessionResponse(
  resp: Response
): Promise<'valid' | 'expired'> {
  if (resp.status === 401 || resp.status === 403) return 'expired';
  if (resp.url.includes('/Account/Login') || resp.url.includes('/login')) {
    return 'expired';
  }
  let body = '';
  try {
    body = await resp.text();
  } catch {
    return 'expired';
  }
  if (
    body.includes('name="Input.UserName"') ||
    body.includes('id="frmLogin"') ||
    body.includes('id="userName"')
  ) {
    return 'expired';
  }
  return 'valid';
}

async function searchByTireSize(
  _normalizedSize: string,
  _quantity: number
): Promise<SupplierTireResult[]> {
  const status = await verifyUsAutoForceSession();
  if (status === 'missing') throw new SessionMissingError('U.S. AutoForce');
  if (status === 'expired') throw new SessionExpiredError('U.S. AutoForce');

  // Session is valid. Phase 2a stops here — the catalog parser
  // (search URL + response shape) requires a one-time calibration
  // against a live authenticated session. The orchestrator surfaces
  // this as a distinct warning so the UI can prompt "calibration
  // pending" instead of "supplier unavailable".
  throw new ParserNotCalibratedError('U.S. AutoForce');
}

export const usAutoForceConnector: SupplierConnector = {
  name: 'U.S. AutoForce',
  searchByTireSize,
};
