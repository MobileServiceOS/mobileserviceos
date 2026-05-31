// Parsing utilities for the "Copy as cURL" output from Chrome / Edge /
// Firefox DevTools. The owner pastes that string into MSOS; the
// callable extracts the Cookie header from it and stores a normalized
// JSON array in Secret Manager.
//
// Why cURL and not raw cookie header: the cURL form is what every
// browser's DevTools natively offers ("Copy → Copy as cURL"). It also
// carries the request URL, which we use as a sanity check to make
// sure the owner copied from a shop.usautoforce.com request and not
// some other site.

export interface ParsedCookie {
  name: string;
  value: string;
}

export interface StoredSessionEnvelope {
  version: 1;
  supplier: string;
  cookies: ParsedCookie[];
  savedAt: string;   // ISO timestamp
  savedBy: string;   // Firebase Auth uid
}

// Extract the Cookie header value from a "Copy as cURL" string. Handles
// both POSIX (single-quote) and Windows-cmd (double-quote) cURL forms,
// and tolerates the line-continuation backslashes browsers emit. Case-
// insensitive on the header name.
export function extractCookieHeaderFromCurl(curl: string): string | null {
  // Match: -H 'cookie: ...' or -H "cookie: ..." or --header 'cookie: ...'
  // Try single-quoted form first (POSIX / Linux / macOS)
  const singleMatch = /(?:-H|--header)\s+'(?:[Cc]ookie):\s*([^']*)'/.exec(curl);
  if (singleMatch) return singleMatch[1];

  // Try double-quoted form (Windows cmd)
  const doubleMatch = /(?:-H|--header)\s+"(?:[Cc]ookie):\s*([^"]*)"/.exec(curl);
  if (doubleMatch) return doubleMatch[1];

  return null;
}

// Confirm the cURL was copied from a shop.usautoforce.com request.
// Tolerant: matches with or without trailing path/query.
export function curlTargetsUsAutoForce(curl: string): boolean {
  return /shop\.usautoforce\.com/i.test(curl);
}

// Parse a "name=value; name=value; ..." header value into discrete
// cookie pairs. Tolerates trailing/leading whitespace and skips
// malformed entries silently.
export function parseCookieHeaderString(header: string): ParsedCookie[] {
  if (!header || typeof header !== 'string') return [];
  const out: ParsedCookie[] = [];
  const seen = new Set<string>();
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value });
  }
  return out;
}

// One-shot: cURL string → cookies. Returns empty array if the cURL
// doesn't contain a Cookie header.
export function parseCurlCookies(curl: string): ParsedCookie[] {
  const header = extractCookieHeaderFromCurl(curl);
  if (!header) return [];
  return parseCookieHeaderString(header);
}

// Heuristic: the U.S. AutoForce dealer portal is ASP.NET Core Identity.
// Real authenticated sessions always carry an
// `.AspNetCore.Identity.Application` cookie (or a customized variant
// matching `.AspNetCore.Cookies` / `.AspNetCore.Identity.*`).
//
// If the owner copies cookies from the login page BEFORE submitting,
// they'll have a `.AspNetCore.Antiforgery.*` cookie but NOT the
// Identity cookie. We reject that case to prevent storing useless
// sessions.
export function isLikelyAuthenticatedUsAutoForce(cookies: ParsedCookie[]): boolean {
  return cookies.some((c) =>
    c.name === '.AspNetCore.Cookies' ||
    c.name === '.AspNetCore.Identity.Application' ||
    c.name.startsWith('.AspNetCore.Identity.')
  );
}

// Serialize as RFC 6265 cookie request header
export function serializeCookieHeader(cookies: ParsedCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
