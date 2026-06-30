import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  CACHE_SIZE_UNLIMITED,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  collection,
  connectFirestoreEmulator,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  type Firestore,
  type CollectionReference,
  type DocumentData,
  type Query,
  type QuerySnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage,
} from 'firebase/storage';
import { noteWriteIssued, noteWriteAcked, noteWriteFailed } from '@/lib/syncState';

// `import.meta.env` is injected by Vite. In a tsx test runner (Node)
// there's no Vite, so the property is undefined — without a fallback,
// any test that transitively imports this module crashes on the first
// property read below. Default to {} so the HARDCODED_CFG path is
// used as the fallback (which is correct for tests — they don't need
// real Firebase auth).
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

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

  // ─── App Check (P1-1 audit fix, 2026-06-03) ─────────────────────
  // Server-side attestation that the request comes from this app +
  // a real browser. When App Check is enforced on the project (via
  // Firebase Console → App Check → APIs → Enforce), Firestore /
  // Functions / Storage reject any request whose token isn't signed
  // by a registered attestation provider. This closes the errorLogs
  // flood attack path completely — even a signed-in attacker writing
  // via the raw Web SDK can't bypass App Check from a headless
  // environment, because reCAPTCHA v3 silently fails the bot fight.
  //
  // The init is gated on VITE_FIREBASE_APPCHECK_SITE_KEY being set
  // at build time. When the secret is absent (local dev, branches
  // without the secret wired), App Check is silently skipped — the
  // app still works as long as enforcement isn't turned on in the
  // Console. Once the operator (a) sets the GitHub repo secret AND
  // (b) flips enforcement on in the Console, the request path is
  // gated end-to-end.
  //
  // Setup order matters: ALWAYS deploy the client SDK with the key
  // first, wait for the GH Pages workflow to ship, then enforce on
  // the backend. Reversing the order locks out every active session
  // until they hard-refresh.
  // App Check is OPT-IN via VITE_APPCHECK_ENABLED === '1' (in addition to
  // the site key). Reason: a misconfigured reCAPTCHA key (wrong key, or a
  // domain not registered for it) makes every token fetch fail with a
  // reCAPTCHA 400, and isTokenAutoRefreshEnabled retries forever — which
  // floods the console and adds request overhead while providing NO
  // protection (it only protects once enforcement is ON in the Console,
  // and a failing token can't enforce anything). Gating behind an explicit
  // flag means the broken init is skipped by default; flip the flag only
  // after the key + domain are verified AND you're ready to enforce.
  const appCheckKey = (env.VITE_FIREBASE_APPCHECK_SITE_KEY ?? '').trim();
  const appCheckEnabled = (env.VITE_APPCHECK_ENABLED ?? '').trim() === '1';
  if (appCheckKey && appCheckEnabled && typeof window !== 'undefined') {
    try {
      // Dynamic import keeps the App Check SDK out of the critical-
      // path bundle. ~15 KB gzip stays in a separate chunk.
      void import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
        try {
          initializeAppCheck(app!, {
            provider: new ReCaptchaV3Provider(appCheckKey),
            // No auto-refresh: a failing reCAPTCHA must not retry in a
            // tight loop and spam the console / network.
            isTokenAutoRefreshEnabled: false,
          });
          console.info('[firebase] App Check initialized');
        } catch (err) {
          console.warn('[firebase] App Check init failed:', err);
        }
      }).catch((err) => {
        console.warn('[firebase] App Check module load failed:', err);
      });
    } catch (err) {
      console.warn('[firebase] App Check setup threw:', err);
    }
  }
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
  // ─── Auth persistence — hardened for the Capacitor native WebView ──
  // Previously: getAuth(app) + an async setPersistence(browserLocalPersistence).
  // Firebase serializes EVERY auth operation behind persistence init, so in a
  // capacitor://localhost WKWebView — where the localStorage probe can stall —
  // the very first signInWithEmailAndPassword() queues behind it and never
  // resolves: the button spins, no error, no navigation (exactly the reported
  // symptom). initializeAuth sets persistence synchronously at creation with an
  // explicit fallback chain; IndexedDB is the most reliable store inside a
  // WebView, then localStorage, session, and finally in-memory so auth ALWAYS
  // initializes (even in the Node test runner, which has none of the browser
  // stores). popupRedirectResolver preserves the web Google-popup flow.
  // The DOM-backed persistences (IndexedDB/localStorage/session) only exist in
  // a browser/WebView; in the Node test runner they reference undefined globals
  // and trip a Firebase "Expected a class definition" assertion. Scope them to
  // the browser and fall back to in-memory in Node.
  _auth =
    typeof window !== 'undefined'
      ? initializeAuth(app, {
          persistence: [
            indexedDBLocalPersistence,
            browserLocalPersistence,
            browserSessionPersistence,
            inMemoryPersistence,
          ],
          popupRedirectResolver: browserPopupRedirectResolver,
        })
      : initializeAuth(app, { persistence: inMemoryPersistence });
  if (typeof window !== 'undefined') {
    console.info('[firebase] auth ready — persistence chain: indexedDB → local → session → memory');
  }
  _storage = getStorage(app);

  // ─── Firebase Emulator Suite connection (DEV + localhost only) ──
  // Connects the Auth, Firestore, and Storage clients to the local
  // Firebase Emulator Suite when:
  //   - Vite DEV build (import.meta.env.DEV is true; production
  //     builds get this replaced with the literal `false`, which
  //     dead-code-eliminates this entire block via tree-shaking)
  //   - Running on localhost / 127.0.0.1
  //   - VITE_USE_FIREBASE_EMULATOR env flag set to '1' (default off
  //     so a fresh `npm run dev` against the real dev Firebase
  //     project keeps working)
  //
  // Activation: `VITE_USE_FIREBASE_EMULATOR=1 npm run dev` then
  // `npm run emulator:start` in a second shell. The connect calls
  // below are idempotent within a single page load but throw if
  // the SDK has already issued any non-emulator request — which is
  // why this block runs RIGHT AFTER the SDKs are initialized, before
  // any auth state listeners or Firestore listeners are attached.
  //
  // Production safety:
  //   - import.meta.env.DEV is statically replaced with `false` by
  //     Vite in production builds → entire block is dead code.
  //   - Even if it somehow ran in prod (it can't), the localhost
  //     hostname check would fail on app.mobileserviceos.app.
  //   - Even if BOTH gates somehow failed (they can't), the
  //     VITE_USE_FIREBASE_EMULATOR flag is unset in .env.production.
  const useEmulator =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';

  if (useEmulator) {
    try {
      // Emulator default ports (firebase.json):
      //   auth      9099
      //   firestore 8080
      //   storage   9199
      //   functions 5001
      connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(_db, '127.0.0.1', 8080);
      if (_storage) connectStorageEmulator(_storage, '127.0.0.1', 9199);
      console.info('[firebase] EMULATOR MODE — auth/firestore/storage routed to 127.0.0.1');
    } catch (err) {
      console.error('[firebase] emulator connect failed:', err);
    }
  }
} catch (e) {
  console.error('[firebase] initialization failed:', e);
  initError = e as Error;
}

export { _db, _auth, _storage };

/**
 * Asserted Firestore accessor. Returns the initialized Firestore handle
 * or throws a clear error if init failed / hasn't run yet. Prefer this
 * over `requireDb()`, which silently asserts initialization and
 * yields opaque runtime errors when `_db` is undefined. (2026-06-05
 * audit: ~48 unchecked casts across the app.)
 */
export function requireDb(): Firestore {
  if (!_db) {
    throw new Error(
      initError
        ? `Firestore not initialized: ${initError.message}`
        : 'Firestore not initialized',
    );
  }
  return _db;
}

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

/**
 * Fast-path setter for the foreground save flow.
 *
 * Firestore's `persistentLocalCache` writes to the local IndexedDB
 * cache INSTANTLY (synchronously from the caller's perspective). The
 * returned promise from `setDoc()` only resolves when the SERVER
 * acknowledges the write — which on a slow network or flaky
 * connection can take 20-40 seconds, even though the data is already
 * locally durable and the snapshot listener has fired with the new
 * value.
 *
 * For the foreground save flow (saveJob, persistInventory, etc.) we
 * don't need to block on the server ack — the listener-driven
 * optimistic UI updates are already correct. We DO need to know if
 * the write fails (auth/rules error), so we attach an error logger.
 *
 * Strategy:
 *   1. Kick off the setDoc (writes to local cache immediately, queues
 *      a server sync in background).
 *   2. Race it against a 2.5s budget — if the server hasn't acked by
 *      then, log a perf note and resolve the caller anyway. The local
 *      data is already correct; the queued write will eventually
 *      complete or fail in the background.
 *   3. If the eventual write fails (after we've already resolved),
 *      log it. The user sees the data appear correctly in their UI;
 *      a background retry will pick it up next time the listener
 *      reconnects.
 *
 * This is safe because:
 *   - Firestore guarantees offline writes are queued durably and
 *     retried with auth state.
 *   - The optimistic UI is already correct (jobs list updates from
 *     the local-cache snapshot, not from this Promise).
 *   - Permission errors will surface on the NEXT save attempt with
 *     a clear error toast, OR via the snapshot listener's error path.
 */
export function fbSetFast(
  col: CollectionReference<DocumentData> | null,
  id: string,
  data: Record<string, unknown> | object
): Promise<void> {
  if (!col) return Promise.reject(new Error('Firestore not initialized'));
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
  const t0 = performance.now();
  // Track this write in the global sync state so the UI can show
  // "3 changes queued" while offline and "Last synced X min ago"
  // when caught up. Incremented at issue time; decremented on
  // resolve OR error.
  noteWriteIssued();
  // Kick off the write. Don't await — let it propagate in background.
  const writePromise = setDoc(doc(col, String(id)), clean, { merge: true })
    .then(() => {
      noteWriteAcked();
      const dt = performance.now() - t0;
      if (dt > 2000) {
        // eslint-disable-next-line no-console
        console.info(`[firebase] fbSetFast slow ack ${dt.toFixed(0)}ms`, { path: col.path, id });
      }
    })
    .catch((e: unknown) => {
      noteWriteFailed();
      // eslint-disable-next-line no-console
      console.error('[firebase] fbSetFast background failure:', { path: col.path, id, error: e });
    });
  // Race against a 2.5s budget — long enough for fast networks to
  // get a real ack (so we surface auth errors synchronously when
  // possible), short enough that a stalled write doesn't freeze the
  // UI.
  return Promise.race([
    writePromise,
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
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
  target: CollectionReference<DocumentData> | Query<DocumentData> | null,
  cb: (docs: Array<Record<string, unknown> & { id: string }>) => void,
  onError?: (e: Error) => void
): () => void {
  if (!target) { cb([]); return () => {}; }
  // CollectionReference exposes .path; Query (e.g. a bounded
  // orderBy+limit) does not. Log the path opportunistically — for
  // bounded queries the path is implicit in the caller's stack.
  const pathForLog = (target as { path?: string }).path ?? '(query)';
  return onSnapshot(
    target,
    (s: QuerySnapshot<DocumentData>) =>
      cb(s.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ ...d.data(), id: d.id }))),
    (e: Error) => {
      console.error('[firebase] fbListen error on', pathForLog, ':', e);
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

/**
 * Upload a job photo (Phase 4). Mirrors uploadReceipt but lands in
 * a per-job-photos subfolder. Caller is expected to have already
 * compressed via compressImage(); we still cap at 8 MB as a
 * defensive ceiling. Each photo gets a unique timestamped name so
 * multiple uploads on the same job don't collide.
 */
export async function uploadJobPhoto(
  businessId: string,
  jobId: string,
  file: File | Blob,
): Promise<string | null> {
  if (!_storage || !businessId || !jobId || !file) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error('Photo must be under 8MB');
  const path = `businesses/${businessId}/job-photos/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const ref = storageRef(_storage, path);
  await uploadBytes(ref, file, { contentType: 'image/jpeg' });
  return await getDownloadURL(ref);
}
