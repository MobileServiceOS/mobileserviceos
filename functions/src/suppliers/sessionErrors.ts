// Typed errors for supplier session lifecycle. The orchestrator
// (supplierSearchService) recognizes these by `name` and maps them to
// specific user-facing warnings. Generic errors fall back to the
// vague "unavailable" message.

export class SessionExpiredError extends Error {
  readonly name = 'SessionExpiredError';
  constructor(public readonly supplier: string) {
    super(`${supplier} session expired`);
  }
}

export class SessionMissingError extends Error {
  readonly name = 'SessionMissingError';
  constructor(public readonly supplier: string) {
    super(`${supplier} session not configured`);
  }
}

export class ParserNotCalibratedError extends Error {
  readonly name = 'ParserNotCalibratedError';
  constructor(public readonly supplier: string) {
    super(`${supplier} parser not yet calibrated`);
  }
}

// Scrub anything that looks like a cookie value from arbitrary strings
// before they hit logs or error messages. Defense in depth — the call
// sites already avoid logging cookie payloads, but a Playwright /
// fetch error caught at the top level could carry a stack trace with
// header values embedded.
export function scrubSensitive(input: string): string {
  let s = input;
  // ASP.NET-style auth cookies
  s = s.replace(
    /\.AspNetCore\.[A-Za-z0-9._-]+\s*=\s*[^\s;,"']+/g,
    '[REDACTED-ASPNET-COOKIE]'
  );
  // Generic "cookie:" header values
  s = s.replace(
    /(cookie\s*:\s*)[^\r\n]+/gi,
    '$1[REDACTED-COOKIE-HEADER]'
  );
  // Long opaque tokens that might be session IDs (32+ url-safe chars)
  s = s.replace(/[A-Za-z0-9_-]{60,}/g, '[REDACTED-LONG-TOKEN]');
  return s;
}

export function scrubError(err: unknown): string {
  if (err instanceof Error) return scrubSensitive(err.message);
  if (typeof err === 'string') return scrubSensitive(err);
  return 'unknown error';
}
