import { arrayUnion, doc, setDoc } from 'firebase/firestore';
import { _db, _storage, uploadJobPhoto } from '@/lib/firebase';
import { noteWriteIssued, noteWriteAcked, noteWriteFailed } from '@/lib/syncState';

// ─────────────────────────────────────────────────────────────────────
//  Offline upload queue — persistent across reload via IndexedDB.
//
//  Firebase Storage's uploadBytes() fails immediately when offline; it
//  has no equivalent of Firestore's local-cache write queue. This
//  module fills that gap for photo uploads:
//
//    1. Online: enqueueJobPhotoUpload → tries the real upload first.
//       Success → patches job.photos via arrayUnion → resolves.
//    2. Offline / network error: stash the blob in IndexedDB, return
//       'queued'. The notification + dispatch UI can show "queued"
//       state via the syncState pendingWrites counter.
//    3. On 'online' event: drainUploadQueue runs, processes everything
//       in order. Successful uploads remove themselves from the queue.
//       Failures bump attempts; if attempts exceed MAX_ATTEMPTS the
//       entry is dropped so a permanently-broken file can't block
//       healthy ones behind it forever.
//
//  Survives reload: the queue lives in IndexedDB at db 'msos-upload-queue',
//  store 'queue'. Each entry holds {kind, businessId, jobId, blob,
//  queuedAt, attempts}. Closing the tab does not destroy the queue;
//  the next page load re-attaches the drain handler and finishes any
//  pending work as soon as the network comes back.
//
//  Per-photo job-doc patch uses arrayUnion so a tech editing the SAME
//  job from another tab can't lose either the queued or the synced
//  URL — both are appended atomically when the upload eventually
//  succeeds.
// ─────────────────────────────────────────────────────────────────────

const DB_NAME    = 'msos-upload-queue';
const DB_VERSION = 1;
const STORE      = 'queue';
const MAX_ATTEMPTS = 5;

interface QueueEntry {
  id?: number;
  kind: 'job-photo';
  businessId: string;
  jobId: string;
  blob: Blob;
  queuedAt: string;
  attempts: number;
}

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

async function addToQueue(entry: Omit<QueueEntry, 'id'>): Promise<number> {
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

/**
 * Try to upload a job photo. Falls back to the offline queue on
 * network failure. Returns either the real download URL OR null
 * (queued) so the caller can decide how to surface the state.
 */
export async function enqueueJobPhotoUpload(
  businessId: string,
  jobId: string,
  blob: Blob,
): Promise<string | null> {
  // Online attempt first — same path as before, no extra latency.
  if (navigator.onLine) {
    try {
      const url = await uploadJobPhoto(businessId, jobId, blob);
      if (url) await appendPhotoUrl(businessId, jobId, url);
      return url;
    } catch (err) {
      // Fall through to queue on transient network errors. Permission
      // errors will resurface on the next drain attempt and eventually
      // exceed MAX_ATTEMPTS so they don't block forever.
      // eslint-disable-next-line no-console
      console.info('[uploadQueue] online upload failed, queueing', err);
    }
  }
  await addToQueue({
    kind: 'job-photo',
    businessId, jobId, blob,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  noteWriteIssued();  // surface in sync-state counter
  return null;
}

async function appendPhotoUrl(businessId: string, jobId: string, url: string): Promise<void> {
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');
  await setDoc(
    doc(db, 'businesses', businessId, 'jobs', jobId),
    { photos: arrayUnion(url) },
    { merge: true },
  );
}

let draining = false;

/**
 * Drain everything in the queue. Safe to call repeatedly — guards
 * against concurrent drains via the `draining` latch. Returns the
 * number of successful uploads in this drain (callers can log it).
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
        const url = await uploadJobPhoto(entry.businessId, entry.jobId, entry.blob);
        if (url) {
          await appendPhotoUrl(entry.businessId, entry.jobId, url);
          await deleteFromQueue(entry.id);
          noteWriteAcked();
          succeeded++;
        } else {
          // Defensive: unexpected null return — treat as a soft failure.
          await bumpAttempts(entry.id);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[uploadQueue] drain attempt failed', { id: entry.id, err });
        await bumpAttempts(entry.id);
        // Permanently-stuck entries (auth gone, too-big-after-retry,
        // bad blob) drop out after MAX_ATTEMPTS so they don't block
        // the rest of the queue.
        if ((entry.attempts || 0) + 1 >= MAX_ATTEMPTS) {
          await deleteFromQueue(entry.id);
          noteWriteFailed();
        }
      }
    }
  } finally {
    draining = false;
  }
  return succeeded;
}

/** Count of currently-queued items. Drives "3 photos queued" UI. */
export async function queuedCount(): Promise<number> {
  const items = await readAllQueue();
  return items.length;
}

/**
 * One-time setup, called from main.tsx. Attaches an 'online' handler
 * that drains the queue when the network returns, and kicks off an
 * initial drain in case the queue had items left over from the last
 * session (closing the tab mid-queue is safe — IDB survives).
 */
export function installUploadQueueDrain(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void drainUploadQueue();
  });
  // Initial drain — covers the "queue left over from last session"
  // case where the user reloaded into an online state and we should
  // sync immediately without waiting for an offline→online edge.
  if (navigator.onLine) {
    void drainUploadQueue();
  }
}
