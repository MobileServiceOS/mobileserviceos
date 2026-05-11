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
  deleteObject,
  listAll,
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

/**
 * Accepted logo image formats. JPEG, PNG, and WEBP are universally renderable
 * in PDF (after base64 conversion) and in browsers. SVG is rejected because
 * jsPDF can't rasterize it reliably and Firebase Storage doesn't sanitize it.
 */
const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const LOGO_ACCEPTED_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

/**
 * Upload a logo image for the given business.
 *
 * The file is stored under `businesses/{businessId}/branding/logo.{ext}`.
 * Each upload overwrites the same key for the matching extension, so the
 * tenant always has at most one logo per extension. Returns the public
 * downloadable URL on success.
 *
 * Throws on validation failure so the UI can show a useful error toast.
 */
export async function uploadLogo(businessId: string, file: File): Promise<string | null> {
  if (!_storage || !businessId || !file) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error('Logo must be under 5MB');

  // Validate type — reject SVG and other formats up front instead of letting
  // the user upload something that won't render on the PDF.
  const lcType = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const typeOk = LOGO_ACCEPTED_TYPES.includes(lcType) || LOGO_ACCEPTED_EXTS.includes(ext);
  if (!typeOk) {
    throw new Error('Logo must be a PNG, JPG, or WEBP image');
  }

  // Normalize extension so we can find this file later for deletion.
  const safeExt = LOGO_ACCEPTED_EXTS.includes(ext) ? ext : (lcType === 'image/webp' ? 'webp' : lcType === 'image/png' ? 'png' : 'jpg');
  const path = `businesses/${businessId}/branding/logo.${safeExt}`;
  const ref = storageRef(_storage, path);
  await uploadBytes(ref, file, { contentType: file.type || 'image/png' });
  return await getDownloadURL(ref);
}

/**
 * Delete ALL logo files for this business from Firebase Storage.
 *
 * We list everything under `branding/` and delete each so we don't leave
 * stale `logo.png` and `logo.jpg` behind after a format swap. Best-effort —
 * individual delete failures are logged and skipped so a partial failure
 * doesn't leave the brand record pointing at a deleted file.
 */
export async function deleteLogo(businessId: string): Promise<void> {
  if (!_storage || !businessId) return;
  try {
    const folderRef = storageRef(_storage, `businesses/${businessId}/branding`);
    const listing = await listAll(folderRef);
    await Promise.all(
      listing.items.map((item) =>
        deleteObject(item).catch((e) => {
          console.warn('[firebase] deleteLogo: failed to delete', item.fullPath, e);
        })
      )
    );
  } catch (e) {
    // If listing itself fails (e.g. nothing was ever uploaded), don't surface.
    console.warn('[firebase] deleteLogo: listAll failed', e);
  }
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
