// functions/src/lib/zettleClient.ts
// ═══════════════════════════════════════════════════════════════════
//  zettleClient — PayPal Zettle REST client (OAuth + Purchase + Pusher).
//
//  Server-only. Reads the MSOS app credentials from process.env
//  (ZETTLE_CLIENT_ID / ZETTLE_CLIENT_SECRET) and acts on behalf of a
//  connected merchant using that merchant's access token.
//
//  ⚠️ ENDPOINTS / SCOPES TO CONFIRM AT ACTIVATION. These match Zettle's
//  documented hosts (oauth.zettle.com, purchase.izettle.com,
//  pusher.izettle.com) but the OAuth reference page is JS-rendered and
//  wasn't machine-readable during research. Verify the exact paths,
//  grant parameters, scope strings, and pagination cursor against a live
//  sandbox before flipping the feature on. The integration ships dormant
//  (see zettleEnabled.ts) so nothing calls these until then.
// ═══════════════════════════════════════════════════════════════════

const OAUTH_TOKEN_URL = 'https://oauth.zettle.com/token';
const OAUTH_AUTHORIZE_URL = 'https://oauth.zettle.com/authorize';
const PURCHASE_BASE = 'https://purchase.izettle.com/purchases/v2';
const PUSHER_SUBSCRIPTIONS_URL = 'https://pusher.izettle.com/organizations/self/subscriptions';
const USERINFO_URL = 'https://oauth.zettle.com/users/me';

export const ZETTLE_SCOPES = 'READ:PURCHASE READ:FINANCE READ:USERINFO';

export interface ZettleTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAtMs: number;
}

export interface RawZettlePayment {
  uuid?: string;
  type?: string;
  amount?: number;          // minor units
  gratuityAmount?: number;  // minor units
  attributes?: {
    maskedPan?: string;
    cardType?: string;
    applicationName?: string;
  };
}

export interface RawZettlePurchase {
  purchaseUUID?: string;
  purchaseUUID1?: string;
  purchaseNumber?: string | number;
  amount?: number;          // gross, minor units
  vatAmount?: number;       // minor units
  currency?: string;
  timestamp?: string;
  created?: string;
  userDisplayName?: string;
  gpsCoordinates?: { latitude?: number; longitude?: number; accuracyMeters?: number };
  payments?: RawZettlePayment[];
}

function basicAuthHeader(): string {
  const id = process.env.ZETTLE_CLIENT_ID ?? '';
  const secret = process.env.ZETTLE_CLIENT_SECRET ?? '';
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function tokenRequest(body: URLSearchParams): Promise<ZettleTokens> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`zettle token request failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token || !json.refresh_token) {
    throw new Error('zettle token response missing tokens');
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAtMs: Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000,
  };
}

/** Build the merchant-facing authorization URL (PKCE). */
export function buildAuthorizeUrl(args: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ZETTLE_CLIENT_ID ?? '',
    scope: ZETTLE_SCOPES,
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${OAUTH_AUTHORIZE_URL}?${p.toString()}`;
}

/** Exchange an authorization code for tokens (merchant connect). */
export function exchangeAuthCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<ZettleTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  }));
}

/** Refresh an access token using the stored refresh token. */
export function refreshAccessToken(refreshToken: string): Promise<ZettleTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
}

async function apiGet(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`zettle GET ${url} failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/** Fetch a single purchase by its UUID (used by the webhook handler). */
export function getPurchase(accessToken: string, purchaseUuid: string): Promise<RawZettlePurchase> {
  return apiGet(`${PURCHASE_BASE}/${encodeURIComponent(purchaseUuid)}`, accessToken) as Promise<RawZettlePurchase>;
}

/** List purchases in a date range (historical import). Returns one page;
 *  the caller paginates via the returned cursor. */
export async function listPurchases(accessToken: string, args: {
  startDate: string;   // ISO
  endDate: string;     // ISO
  limit?: number;
  lastPurchaseHash?: string;
}): Promise<{ purchases: RawZettlePurchase[]; lastPurchaseHash?: string }> {
  const p = new URLSearchParams({
    startDate: args.startDate,
    endDate: args.endDate,
    limit: String(args.limit ?? 1000),
  });
  if (args.lastPurchaseHash) p.set('lastPurchaseHash', args.lastPurchaseHash);
  const json = await apiGet(`${PURCHASE_BASE}?${p.toString()}`, accessToken) as {
    purchases?: RawZettlePurchase[];
    lastPurchaseHash?: string;
  };
  return { purchases: json.purchases ?? [], lastPurchaseHash: json.lastPurchaseHash };
}

/** Create the PurchaseCreated webhook subscription. Returns the
 *  subscription uuid + signingKey (store the key in the private path). */
export async function createPurchaseWebhook(accessToken: string, args: {
  webhookUrl: string;
  contactEmail: string;
}): Promise<{ uuid: string; signingKey: string }> {
  const res = await fetch(PUSHER_SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transportName: 'WEBHOOK',
      eventNames: ['PurchaseCreated'],
      destination: args.webhookUrl,
      contactEmail: args.contactEmail,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`zettle subscription create failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = await res.json() as { uuid?: string; signingKey?: string };
  if (!json.uuid || !json.signingKey) throw new Error('zettle subscription response missing uuid/signingKey');
  return { uuid: json.uuid, signingKey: json.signingKey };
}

/** Display name / org for the Settings UI. */
export function getUserInfo(accessToken: string): Promise<{ organizationName?: string; email?: string }> {
  return apiGet(USERINFO_URL, accessToken) as Promise<{ organizationName?: string; email?: string }>;
}

/** Convert minor units → major (dollars), rounded to cents. */
export function minorToMajor(minor: number | undefined): number {
  return Math.round((Number(minor ?? 0))) / 100;
}

/** Normalize a raw Zettle purchase into the fields we persist + match on.
 *  `matchAmountCents` excludes gratuity so it lines up with a job's
 *  revenue; `grossAmount` (major units) is the full charged total. */
export function normalizePurchase(raw: RawZettlePurchase): {
  purchaseUUID: string;
  receiptNumber?: string;
  grossAmount: number;
  matchAmountCents: number;
  tax: number;
  currency?: string;
  timestamp: string;
  processedByName?: string | null;
  cardBrand?: string | null;
  maskedPan?: string | null;
  deviceName?: string | null;
  paymentType?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
} {
  const uuid = raw.purchaseUUID1 || raw.purchaseUUID || '';
  const grossMinor = Number(raw.amount ?? 0);
  const gratuityMinor = (raw.payments ?? []).reduce((s, p) => s + Number(p.gratuityAmount ?? 0), 0);
  const card = (raw.payments ?? []).find((p) => p.attributes?.cardType) ?? raw.payments?.[0];
  const gps = raw.gpsCoordinates;
  return {
    purchaseUUID: uuid,
    receiptNumber: raw.purchaseNumber != null ? String(raw.purchaseNumber) : undefined,
    grossAmount: minorToMajor(grossMinor),
    matchAmountCents: Math.max(0, grossMinor - gratuityMinor),
    tax: minorToMajor(raw.vatAmount),
    currency: raw.currency,
    timestamp: raw.timestamp || raw.created || new Date(0).toISOString(),
    processedByName: raw.userDisplayName ?? null,
    cardBrand: card?.attributes?.cardType ?? null,
    maskedPan: card?.attributes?.maskedPan ?? null,
    deviceName: card?.attributes?.applicationName ?? null,
    paymentType: card?.type,
    latitude: typeof gps?.latitude === 'number' ? gps.latitude : undefined,
    longitude: typeof gps?.longitude === 'number' ? gps.longitude : undefined,
    accuracyMeters: typeof gps?.accuracyMeters === 'number' ? gps.accuracyMeters : undefined,
  };
}
