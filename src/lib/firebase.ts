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
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  type Firestore,
  type CollectionReference,
  type DocumentData,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, type FirebaseStorage } from 'firebase/storage';

// Firebase config from Vite env. Falls back to a known dev project so the app still
// builds without a .env file (rules will deny unauthorized access regardless).
const FB_CFG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || atob('QUl6YVN5QTdxOHpyOUlJeWd1LTJXZWRzOFZPMlo5eHk5ZEs1MUhF'),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'wheel-rush-expense.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'wheel-rush-expense',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'wheel-rush-expense.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '400580006654',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:400580006654:web:b8e435c2807b51af244baf',
};

let app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;
let _storage: FirebaseStorage | undefined;

try {
  app = initializeApp(FB_CFG);
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    }),
  });
  _auth = getAuth(app);
  setPersistence(_auth, browserLocalPersistence).catch(() => {
    /* noop */
  });
  _storage = getStorage(app);
} catch (e) {
  console.warn('FB init:', e);
}

export { app, _db, _auth, _storage };

export const scopedCol = (
  bId: string,
  name: string
): CollectionReference<DocumentData> | null => (_db ? collection(_db, `businesses/${bId}/${name}`) : null);

/**
 * Set a document, JSON-stringifying any nested object fields (legacy Firestore-flat shape).
 * Mirrors the original app's persistence convention.
 */
export async function fbSet(
  col: CollectionReference<DocumentData> | null,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!col) return;
  const clean: Record<string, unknown> = {};
  Object.keys(data || {}).forEach((k) => {
    const v = data[k];
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
    (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id }))),
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
