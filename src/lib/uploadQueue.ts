import { arrayUnion, doc, setDoc } from 'firebase/firestore';
import {
  _db, _storage,
  uploadJobPhoto, uploadReceipt as storageUploadReceipt, uploadLogo as storageUploadLogo,
} from '@/lib/firebase';
import { noteWriteIssued, noteWriteAcked, noteWriteFailed } from '@/lib/syncState';
import { captureMessage } from '@/lib/errorMonitor';

// ─────────────────────────────────────────────────────────────────────
//  Offline upload queue — persistent across reload via IndexedDB.
//
//  Firebase Storage's uploadBytes() fails immediately when offline; it
//  has no equivalent of Firestore's local-cache write queue. This
//  module fills that gap for ALL user-initiated storage uploads:
//
//    - 'job-photo'  → businesses/{bid}/job-photos/{jid}/...  | patches job.photos[]
//    - 'receipt'    → businesses/{bid}/receipts/{jid}-...    | patches job.tireReceiptUrl
//    - 'logo'       → businesses/{bid}/branding/logo.{ext}   | patches settings/main.logoUrl
//
//  Flow:
//    1. Online: enqueueX → tries the real upload first. Success →
//       patches the destination doc → resolves with URL.
//    2. Offline / network error: stash the blob in IndexedDB, return
//       null (queued). The sync-state counter surfaces "queued" UI.
//    3. On 'online' event: drainUploadQueue runs everything in order.
//       Failures bump attempts; >= MAX_ATTEMPTS drops the entry so a
//       permanently-broken file can't block healthy ones forever.
//
//  Survives reload: queue lives in IDB at db 'msos-upload-queue',
//  store 'queue'. Closing the tab does not destroy the queue.
// ─────────────────────────────────────────────────────────────────────

const DB_NAME    = 'msos-upload-queue';
// v2 — added 'receipt' and 'logo' kinds. Existing 'job-photo' entries
// from v1 carry forward unchanged (same object store, same schema).
const DB_VERSION = 2;
const STORE      = 'queue';
const MAX_ATTEMPTS = 5;

interface BaseEntry {
  id?: number;
  queuedAt: string;
  attempts: number;
}
interface JobPhotoEntry extends BaseEntry {
  kind: 'job-photo';
  businessId: string;
  jobId: string;
  blob: Blob;
}
interface ReceiptEntry extends BaseEntry {
  kind: 'receipt';
  businessId: string;
  jobId: string;
  blob: Blob;
  contentType: string;
  fileName: string;
}
interface LogoEntry extends BaseEntry {
  kind: 'logo';
  businessId: string;
  blob: Blob;
  contentType: string;
  fileName: string;
}
type QueueEntry = JobPhotoEntry | ReceiptEntry | LogoEntry;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Distributive Omit so the union narrows per branch (otherwise
// `Omit<A | B | C, 'id'>` only keeps keys common to all three).
type QueueInput = QueueEntry extends infer T ? (T extends QueueEntry ? Omit<T, 'id'> : never) : never;

async function addToQueue(entry: QueueInput): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(entry);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

async function readAllQueue(): Promise<QueueEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueueEntry[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromQueue(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function bumpAttempts(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const entry = get.result as QueueEntry | undefined;
      if (!entry) { resolve(); return; }
      entry.attempts = (entry.attempts || 0) + 1;
      const put = store.put(entry);
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
    };
    get.onerror = () => reject(get.error);
  });
}

// ── Per-kind post-upload patches ───────────────────────────────────
async function patchJobPhoto(businessId: string, jobId: string, url: string): Promise<void> {
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');
  await setDoc(
    doc(db, 'businesses', businessId, 'jobs', jobId),
    { photos: arrayUnion(url) },
    { merge: true },
  );
}

async function patchJobReceipt(businessId: string, jobId: string, url: string): Promise<void> {
  // Skip pending temp IDs — the parent form wasn't saved yet, so we
  // have no real job doc to patch. The storage file is orphaned but
  // intentionally so; the caller surfaces the URL back into the form
  // synchronously on the online path.
  if (jobId.startsWith('pending-')) return;
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');
  await setDoc(
    doc(db, 'businesses', businessId, 'jobs', jobId),
    { tireReceiptUrl: url },
    { merge: true },
  );
}

async function patchBrandLogo(businessId: string, url: string): Promise<void> {
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');
  await setDoc(
    doc(db, 'businesses', businessId, 'settings', 'main'),
    { logoUrl: url },
    { merge: true },
  );
}

// ── Public enqueue helpers — one per kind ──────────────────────────

/**
 * Try to upload a job photo. Falls back to the offline queue on
 * network failure. Returns the real download URL on success, null
 * when queued so the caller can decide how to surface state.
 */
export async function enqueueJobPhotoUpload(
  businessId: string,
  jobId: string,
  blob: Blob,
): Promise<string | null> {
  if (navigator.onLine) {
    try {
      const url = await uploadJobPhoto(businessId, jobId, blob);
      if (url) await patchJobPhoto(businessId, jobId, url);
      return url;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info('[uploadQueue] photo online upload failed, queueing', err);
    }
  }
  await addToQueue({
    kind: 'job-photo',
    businessId, jobId, blob,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  noteWriteIssued();
  return null;
}

/**
 * Try to upload a tire receipt. Falls back to the offline queue on
 * network failure. Returns the download URL on success, null when
 * queued. When queued, the caller should still store the local blob
 * URL in form state so the user sees a thumbnail until drain.
 */
export async function enqueueReceiptUpload(
  businessId: string,
  jobId: string,
  file: File,
): Promise<string | null> {
  if (navigator.onLine) {
    try {
      const url = await storageUploadReceipt(businessId, jobId, file);
      if (url) await patchJobReceipt(businessId, jobId, url);
      return url;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info('[uploadQueue] receipt online upload failed, queueing', err);
    }
  }
  await addToQueue({
    kind: 'receipt',
    businessId, jobId,
    blob: file,
    contentType: file.type || 'image/jpeg',
    fileName: file.name || 'receipt.jpg',
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  noteWriteIssued();
  return null;
}

/**
 * Try to upload a brand logo. Falls back to the offline queue on
 * network failure. Returns the download URL on success, null when
 * queued. On drain success the queue itself patches settings/main
 * with the new logoUrl, so the caller doesn't need to re-save.
 */
export async function enqueueLogoUpload(
  businessId: string,
  file: File,
): Promise<string | null> {
  if (navigator.onLine) {
    try {
      const url = await storageUploadLogo(businessId, file);
      if (url) await patchBrandLogo(businessId, url);
      return url;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info('[uploadQueue] logo online upload failed, queueing', err);
    }
  }
  await addToQueue({
    kind: 'logo',
    businessId,
    blob: file,
    contentType: file.type || 'image/png',
    fileName: file.name || 'logo.png',
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  noteWriteIssued();
  return null;
}

let draining = false;

/**
 * Drain everything in the queue. Safe to call repeatedly — guards
 * against concurrent drains via the `draining` latch. Returns the
 * number of successful uploads in this drain.
 */
export async function drainUploadQueue(): Promise<number> {
  if (draining) return 0;
  if (!_storage) return 0;
  draining = true;
  let succeeded = 0;
  try {
    const entries = await readAllQueue();
    for (const entry of entries) {
      if (entry.id == null) continue;
      try {
        const url = await uploadEntry(entry);
        if (url) {
          await patchEntry(entry, url);
          await deleteFromQueue(entry.id);
          noteWriteAcked();
          succeeded++;
        } else {
          await bumpAttempts(entry.id);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[uploadQueue] drain attempt failed', { id: entry.id, kind: entry.kind, err });
        await bumpAttempts(entry.id);
        if ((entry.attempts || 0) + 1 >= MAX_ATTEMPTS) {
          await deleteFromQueue(entry.id);
          noteWriteFailed();
          // Dropped a queued upload after MAX_ATTEMPTS failures. Surface
          // to the in-house error log so the operator can see that an
          // upload was permanently lost (vs the much louder "queue
          // grew but nothing uploaded" diagnostic from a stuck network).
          captureMessage('error', '[uploadQueue] entry dropped after max attempts', {
            kind: entry.kind,
            id: entry.id,
            businessId: entry.businessId,
            attempts: (entry.attempts || 0) + 1,
            error: (err as Error)?.message || String(err),
          });
        }
      }
    }
  } finally {
    draining = false;
  }
  return succeeded;
}

function blobToFile(entry: ReceiptEntry | LogoEntry): File {
  // uploadReceipt / uploadLogo expect File for content-type + ext
  // sniffing. Reconstruct deterministically from the stored Blob.
  return new File([entry.blob], entry.fileName, { type: entry.contentType });
}

async function uploadEntry(entry: QueueEntry): Promise<string | null> {
  switch (entry.kind) {
    case 'job-photo':
      return uploadJobPhoto(entry.businessId, entry.jobId, entry.blob);
    case 'receipt':
      return storageUploadReceipt(entry.businessId, entry.jobId, blobToFile(entry));
    case 'logo':
      return storageUploadLogo(entry.businessId, blobToFile(entry));
  }
}

async function patchEntry(entry: QueueEntry, url: string): Promise<void> {
  switch (entry.kind) {
    case 'job-photo':
      return patchJobPhoto(entry.businessId, entry.jobId, url);
    case 'receipt':
      return patchJobReceipt(entry.businessId, entry.jobId, url);
    case 'logo':
      return patchBrandLogo(entry.businessId, url);
  }
}

/** Count of currently-queued items. Drives "3 uploads queued" UI. */
export async function queuedCount(): Promise<number> {
  const items = await readAllQueue();
  return items.length;
}

/**
 * One-time setup, called from main.tsx. Attaches an 'online' handler
 * that drains the queue when the network returns, and kicks off an
 * initial drain in case the queue had items left over from the last
 * session.
 */
export function installUploadQueueDrain(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void drainUploadQueue();
  });
  if (navigator.onLine) {
    void drainUploadQueue();
  }
}
