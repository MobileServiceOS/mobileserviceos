import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  CACHE_SIZE_UNLIMITED,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  type Firestore,
  type CollectionReference,
  type DocumentData,
  type QuerySnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage,
} from 'firebase/storage';

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

const HARDCODED_CFG = {
  apiKey: 'AIzaSyDpe9pVejH1EFZmQYv04sgtZBoLxqM6lW0',
  authDomain: 'mobile-service-os.firebaseapp.com',
  projectId: 'mobile-service-os',
  storageBucket: 'mobile-service-os.firebasestorage.app',
  messagingSenderId: '77527561910',
  appId: '1:77527561910:web:4a0c65c0203d403f4f5817',
} as const;

function pick(envVal: string | undefined, fallback: string): string {
  return envVal && envVal.trim() ? envVal.trim() : fallback;
}

const FB_CFG = {
  apiKey: pick(env.VITE_FIREBASE_API_KEY, HARDCODED_CFG.apiKey),
  authDomain: pick(env.VITE_FIREBASE_AUTH_DOMAIN, HARDCODED_CFG.authDomain),
  projectId: pick(env.VITE_FIREBASE_PROJECT_ID, HARDCODED_CFG.projectId),
  storageBucket: pick(env.VITE_FIREBASE_STORAGE_BUCKET, HARDCODED_CFG.storageBucket),
  messagingSenderId: pick(env.VITE_FIREBASE_MESSAGING_SENDER_ID, HARDCODED_CFG.messagingSenderId),
  appId: pick(env.VITE_FIREBASE_APP_ID, HARDCODED_CFG.appId),
};

if (typeof window !== 'undefined') {
  console.info(`[firebase] project=${FB_CFG.projectId} authDomain=${FB_CFG.authDomain}`);
}

let app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;
let _storage: FirebaseStorage | undefined;
export let initError: Error | null = null;

try {
  app = initializeApp(FB_CFG);
  try {
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      }),
    });
  } catch (e) {
    console.warn('[firebase] persistent cache failed, falling back to memory:', e);
    _db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
  _auth = getAuth(app);
  void setPersistence(_auth, browserLocalPersistence).catch((e) => console.warn('[firebase] auth persistence:', e));
  _storage = getStorage(app);
} catch (e) {
  console.error('[firebase] initialization failed:', e);
  initError = e as Error;
}

export { _db, _auth, _storage };

export const scopedCol = (
  bId: string,
  name: string
): CollectionReference<DocumentData> | null => (_db ? collection(_db, `businesses/${bId}/${name}`) : null);

// ─────────────────────────────────────────────────────────────
//  Retry helper for transient Firestore failures
// ─────────────────────────────────────────────────────────────
//
// Mobile technicians work in driveways, parking lots, garages with bad
// WiFi. Without retries, a single dropped packet during a settings save
// becomes a "Settings save failed" toast and lost work. With retries,
// the same blip is invisible — the call just takes an extra ~500ms.
//
// We retry ONLY on transient errors (network/server). User errors like
// permission-denied or invalid-argument are not retried — those need
// user attention and silent retry would just delay the inevitable.

/** Firestore error codes that are safe to retry — they're transient by definition. */
const TRANSIENT_FIRESTORE_CODES = new Set<string>([
  'unavailable',         // Server temporarily unreachable
  'deadline-exceeded',   // Request timed out
  'aborted',             // Transaction collision or RPC abort
  'internal',            // Server-side transient issue
  'resource-exhausted',  // Quota throttle (usually transient)
  'cancelled',           // RPC cancelled mid-flight
]);

/** Pull the Firestore error code out of any thrown value. Defensive — some
 *  errors come through as plain strings or non-Error objects. */
function getFirestoreErrorCode(e: unknown): string | null {
  if (!e) return null;
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === 'string') return code.replace(/^firestore\//, '');
  }
  return null;
}

function isTransientError(e: unknown): boolean {
  const code = getFirestoreErrorCode(e);
  if (!code) return false;
  return TRANSIENT_FIRESTORE_CODES.has(code);
}

/** Sleep with ±20% jitter so simultaneous failures across tabs don't all
 *  retry at the same instant (thundering herd). */
function jitteredDelay(baseMs: number): Promise<void> {
  const jitter = 0.8 + Math.random() * 0.4; // 0.8x → 1.2x
  return new Promise((resolve) => setTimeout(resolve, Math.round(baseMs * jitter)));
}

/**
 * Run an async operation with exponential backoff retry on transient
 * Firestore errors. Non-transient errors throw immediately so callers
 * still get useful user-facing errors fast.
 *
 * Backoff: 500ms → 1500ms → 4500ms. Worst case = ~6.5s before failure
 * is surfaced. That's acceptable for "save settings" but would be too
 * slow for any user-blocking hot path (we don't have any of those
 * going through this helper).
 *
 * Exposed as a generic so it can wrap things beyond setDoc/deleteDoc
 * in future batches (transactions, etc.) without changing the helper.
 */
async function withRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
  const delays = [500, 1500, 4500];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastError = e;
      if (!isTransientError(e) || attempt === delays.length) {
        // Either non-transient (throw immediately) OR out of retries
        // (throw the last error so the caller sees a real failure).
        throw e;
      }
      const delay = delays[attempt];
      console.warn(
        `[firebase] ${label} transient error on attempt ${attempt + 1}/${delays.length + 1}, ` +
        `retrying in ~${delay}ms:`,
        getFirestoreErrorCode(e)
      );
      await jitteredDelay(delay);
    }
  }
  // Unreachable — the loop above either returns or throws — but TS needs it.
  throw lastError;
}

export async function fbSet(
  col: CollectionReference<DocumentData> | null,
  id: string,
  data: Record<string, unknown> | object
): Promise<void> {
  if (!col) throw new Error('Firestore not initialized');
  const src = data as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  Object.keys(src).forEach((k) => {
    const v = src[k];
    if (v === undefined) return;
    if (v === null) { clean[k] = null; return; }
    if (typeof v === 'object') { clean[k] = JSON.stringify(v); return; }
    clean[k] = v;
  });
  clean.id = String(id);
  try {
    await withRetry(
      () => setDoc(doc(col, String(id)), clean, { merge: true }),
      `fbSet(${col.path}/${id})`
    );
  } catch (e) {
    console.error('[firebase] fbSet failed:', { path: col.path, id, error: e });
    throw e;
  }
}

export async function fbDelete(col: CollectionReference<DocumentData> | null, id: string): Promise<void> {
  if (!col) throw new Error('Firestore not initialized');
  try {
    await withRetry(
      () => deleteDoc(doc(col, String(id))),
      `fbDelete(${col.path}/${id})`
    );
  } catch (e) {
    console.error('[firebase] fbDelete failed:', { path: col.path, id, error: e });
    throw e;
  }
}

export function fbListen(
  col: CollectionReference<DocumentData> | null,
  cb: (docs: Array<Record<string, unknown> & { id: string }>) => void,
  onError?: (e: Error) => void
): () => void {
  if (!col) { cb([]); return () => {}; }
  return onSnapshot(
    col,
    (s: QuerySnapshot<DocumentData>) =>
      cb(s.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ ...d.data(), id: d.id }))),
    (e: Error) => {
      console.error('[firebase] fbListen error on', col.path, ':', e);
      if (onError) onError(e);
    }
  );
}

export async function uploadLogo(businessId: string, file: File): Promise<string | null> {
  if (!_storage || !businessId || !file) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error('Logo must be under 5MB');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ref = storageRef(_storage, `businesses/${businessId}/branding/logo.${ext || 'png'}`);
  await uploadBytes(ref, file, { contentType: file.type });
  return await getDownloadURL(ref);
}

export async function uploadReceipt(
  businessId: string,
  jobId: string,
  file: File
): Promise<string | null> {
  if (!_storage || !businessId || !jobId || !file) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error('Receipt must be under 8MB');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `businesses/${businessId}/receipts/${jobId}-${Date.now()}.${ext}`;
  const ref = storageRef(_storage, path);
  await uploadBytes(ref, file, { contentType: file.type || 'image/jpeg' });
  return await getDownloadURL(ref);
}
