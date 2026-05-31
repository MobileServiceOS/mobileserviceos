import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { StoredSessionEnvelope } from './cookieParsers';

// Single shared client. Lazy initialization defers credential lookup
// until the first call — Cloud Functions provides ADC automatically.
let _client: SecretManagerServiceClient | null = null;
function client(): SecretManagerServiceClient {
  if (!_client) _client = new SecretManagerServiceClient();
  return _client;
}

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!id) throw new Error('Project ID not available in runtime env');
  return id;
}

export interface SessionReadResult {
  envelope: StoredSessionEnvelope;
  versionName: string;       // full resource name including version number
  versionId: string;         // just the numeric suffix
}

// Read the latest version of a session secret. Returns null when the
// secret doesn't exist yet (first-ever connect attempt). Throws on
// other errors. Bypasses defineSecret() caching by calling the SDK
// directly — guarantees we always read the freshest version after a
// reconnect.
export async function readLatestSession(
  secretName: string
): Promise<SessionReadResult | null> {
  const name = `projects/${projectId()}/secrets/${secretName}/versions/latest`;
  let response;
  try {
    [response] = await client().accessSecretVersion({ name });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    // NOT_FOUND — secret or version absent → caller treats as "missing"
    if (code === 5) return null;
    throw err;
  }
  const data = response.payload?.data;
  if (!data) return null;
  const payload = data.toString();

  let envelope: StoredSessionEnvelope;
  try {
    envelope = JSON.parse(payload) as StoredSessionEnvelope;
  } catch {
    throw new Error('Stored session is malformed');
  }
  if (envelope.version !== 1) {
    throw new Error(`Unsupported session envelope version: ${envelope.version}`);
  }

  const versionName = response.name ?? '';
  const versionId = versionName.split('/').pop() ?? '0';
  return { envelope, versionName, versionId };
}

// Write a new version of a session secret. Creates the secret on
// first use. Returns the new version's numeric ID. Old versions are
// retained by Secret Manager (manual destroy required) — useful for
// rollback if the new cookies turn out to be malformed.
export async function writeNewSession(
  secretName: string,
  envelope: StoredSessionEnvelope
): Promise<{ versionId: string }> {
  const c = client();
  const parent = `projects/${projectId()}`;
  const secretPath = `${parent}/secrets/${secretName}`;

  // Ensure the secret exists. CreateSecret is idempotent only via
  // explicit existence-check — re-creating throws ALREADY_EXISTS (6).
  try {
    await c.getSecret({ name: secretPath });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code !== 5) throw err;
    await c.createSecret({
      parent,
      secretId: secretName,
      secret: { replication: { automatic: {} } },
    });
  }

  const payload = JSON.stringify(envelope);
  const [version] = await c.addSecretVersion({
    parent: secretPath,
    payload: { data: Buffer.from(payload, 'utf8') },
  });
  const versionName = version.name ?? '';
  const versionId = versionName.split('/').pop() ?? '0';
  return { versionId };
}

export const SUPPLIER_SECRET_NAMES = {
  'U.S. AutoForce': 'WHEELRUSH_USAUTOFORCE_SESSION',
} as const;
