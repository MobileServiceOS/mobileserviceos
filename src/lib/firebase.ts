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

const FB_CFG = {
  apiKey: env.VITE_FIREBASE_API_KEY || atob('QUl6YVN5QTdxOHpyOUlJeWd1LTJXZWRzOFZPMlo5eHk5ZEs1MUhF'),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'wheel-rush-expense.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'wheel-rush-expense',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'wheel-rush-expense.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '400580006654',
  appId: env.VITE_FIREBASE_APP_ID || '1:400580006654:web:b8e435c2807b51af244baf',
};

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

export async function fbSet(
  col: CollectionReference<DocumentData> | null,
  id: string,
  data: Record<string, unknown> | object
): Promise<void> {
  if (!col) return;
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
    console.warn('fbSet:', e);
  }
}

export function fbListen(
  col: CollectionReference<DocumentData> | null,
  cb: (docs: Array<Record<string, unknown> & { id: string }>) => void
): () => void {
  if (!col) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    col,
    (s: QuerySnapshot<DocumentData>) =>
      cb(s.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ ...d.data(), id: d.id }))),
    (e) => console.warn('fbListen error:', e)
  );
}

export async function fbDelete(col: CollectionReference<DocumentData> | null, id: string): Promise<void> {
  if (!col) return;
  try {
    await deleteDoc(doc(col, String(id)));
  } catch (e) {
    console.warn('fbDelete:', e);
  }
}

export async function uploadLogo(businessId: string, file: File): Promise<string | null> {
  if (!_storage || !businessId || !file) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error('Logo must be under 5MB');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ref = storageRef(_storage, `businesses/${businessId}/branding/logo.${ext || 'png'}`);
  await uploadBytes(ref, file, { contentType: file.type });
  return await getDownloadURL(ref);
}
