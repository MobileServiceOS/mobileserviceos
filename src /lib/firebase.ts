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
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, type FirebaseStorage } from 'firebase/storage';

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

// Production Firebase config for the `mobile-service-os` project.
// Web API keys are public-by-design (security comes from Auth domain allowlist
// + Firestore Security Rules), so committing them is the standard practice.
//
// Env vars (set in GitHub Actions secrets or .env.local) optionally override
// these at build time, but only when explicitly non-empty — useful for
// white-label deploys that target a different Firebase project without
// touching this file.
const HARDCODED_CFG = {
  apiKey: 'AIzaSyDpe9pVejH1EFZmQYv04sgtZBoLxqM6lW0',
  authDomain: 'mobile-service-os.firebaseapp.com',
  projectId: 'mobile-service-os',
  storageBucket: 'mobile-service-os.firebasestorage.app',
  messagingSenderId: '77527561910',
  appId: '1:77527561910:web:4a0c65c0203d403f4f5817',
} as const;

function pick(envVal: string | undefined, fallback: string): string {
  // Empty string from unset CI secret should NOT win over the hardcoded value.
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

// One-line confirmation in the browser console so you can verify the deployed
// build is pointing at the right project.
if (typeof window !== 'undefined') {
  console.info(
    `[firebase] project=${FB_CFG.projectId} authDomain=${FB_CFG.authDomain}`
  );
}

let app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;
let _storage: FirebaseStorage | undefined;
let initError: Error | null = null;

function safeInit() {
  try {
    app = initializeApp(FB_CFG);
  } catch (e) {
    initError = e as Error;
    console.error('[firebase] app init failed:', e);
    return;
  }

  // Firestore — try persistent cache, fall back if IndexedDB unavailable (Safari private, embedded webviews, etc.)
  try {
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      }),
    });
  } catch (e) {
    console.warn('[firebase] persistent cache unavailable, falling back to memory:', e);
    try {
      _db = initializeFirestore(app, { localCache: memoryLocalCache() });
    } catch (e2) {
      try {
        _db = initializeFirestore(app, {});
      } catch (e3) {
        console.error('[firebase] firestore init failed entirely:', e3);
      }
    }
  }

  try {
    _auth = getAuth(app);
    setPersistence(_auth, browserLocalPersistence).catch((e) => {
      console.warn('[firebase] auth persistence failed (non-fatal):', e);
    });
  } catch (e) {
    console.error('[firebase] auth init failed:', e);
    initError = initError || (e as Error);
  }

  try {
    _storage = getStorage(app);
  } catch (e) {
    console.warn('[firebase] storage init failed (non-fatal):', e);
  }
}

safeInit();

export { app, _db, _auth, _storage, initError };

export const scopedCol = (
  bId: string,
  name: string
): CollectionReference<DocumentData> | null => (_db ? collection(_db, `businesses/${bId}/${name}`) : null);

/**
 * Write a doc to a scoped collection. Throws on real Firestore errors so the
 * caller can show a toast / mark sync as failed.
 *
 * Important: when the device is offline, Firestore's persistent cache resolves
 * setDoc successfully and queues the write — that is NOT an error. Real errors
 * here come from permission denials, malformed data, or network timeouts after
 * the cache layer.
 */
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
    if (v === null) {
      clean[k] = null;
      return;
    }
    if (typeof v === 'object') {
      clean[k] = JSON.stringify(v);
      return;
    }
    clean[k] = v;
  });
  clean.id = String(id);
  try {
    await setDoc(doc(col, String(id)), clean, { merge: true });
  } catch (e) {
    console.error('[firebase] fbSet failed:', { path: col.path, id, error: e });
    throw e;
  }
}

export async function fbDelete(col: CollectionReference<DocumentData> | null, id: string): Promise<void> {
  if (!col) throw new Error('Firestore not initialized');
  try {
    await deleteDoc(doc(col, String(id)));
  } catch (e) {
    console.error('[firebase] fbDelete failed:', { path: col.path, id, error: e });
    throw e;
  }
}

/**
 * Listen to a collection. The optional onError callback lets the caller flip
 * sync status to "sync_failed" when permission denials or network errors
 * happen — silently ignoring listener errors leaves the UI looking "synced"
 * while data is actually frozen.
 */
export function fbListen(
  col: CollectionReference<DocumentData> | null,
  cb: (docs: Array<Record<string, unknown> & { id: string }>) => void,
  onError?: (e: Error) => void
): () => void {
  if (!col) {
    cb([]);
    return () => {};
  }
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

/**
 * Bulk delete every doc in a collection. Used by Inventory's "Delete All".
 * Returns the count actually deleted; throws if any single delete fails after
 * a few retries.
 */
export async function fbDeleteAll(
  col: CollectionReference<DocumentData> | null,
  ids: string[]
): Promise<number> {
  if (!col || !ids.length) return 0;
  let deleted = 0;
  const errors: unknown[] = [];
  for (const id of ids) {
    try {
      await deleteDoc(doc(col, String(id)));
      deleted++;
    } catch (e) {
      console.error('[firebase] fbDeleteAll item failed:', { path: col.path, id, error: e });
      errors.push(e);
    }
  }
  if (errors.length) {
    throw new Error(
      `Failed to delete ${errors.length} of ${ids.length} items — see console for details`
    );
  }
  return deleted;
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
