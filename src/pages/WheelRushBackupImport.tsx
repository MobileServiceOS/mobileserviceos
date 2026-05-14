import { useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { _auth } from '@/lib/firebase';
import { addToast } from '@/lib/toast';

// ─────────────────────────────────────────────────────────────────────
//  WheelRushBackupImport — owner-only one-time migration button.
//
//  Purpose: import the legacy Wheel Rush backup JSON (jobs +
//  inventory) into the current Wheel Rush MSOS tenant. Lives in
//  Settings as a hidden owner-only section.
//
//  UX:
//    1. Pick file (native iOS/Android/desktop file picker)
//    2. Tap "Dry run" — analyzes, shows counts, no writes
//    3. Tap "Commit" — writes 161 jobs + 55 inventory items
//    4. Records every write with migrationBatchId for rollback
//
//  Safety:
//    - Refuses to run for non-owners (canManageBilling check —
//      same gate as Lifetime Pro Access panel)
//    - Refuses to run if businessId is missing
//    - Skips duplicates by legacyWheelRushId OR composite key
//      (date + revenue + phone + service)
//    - Sets historicalInventoryDeducted=true so live inventory is
//      NOT decremented again
//    - Tags every write with migrationBatchId — rollback deletes
//      only docs with that ID, nothing else
//
//  This is intentionally rough-edged — it's a one-time tool. Once
//  the import is done it can be removed in a follow-up commit.
// ─────────────────────────────────────────────────────────────────────

interface BackupJob {
  id?: string;
  date?: string;
  service?: string;
  vehicleType?: string;
  area?: string;
  payment?: string;
  status?: string;
  source?: string;
  customerName?: string;
  customerPhone?: string;
  tireSize?: string;
  tireBrand?: string;
  tireModel?: string;
  tireSource?: string;
  tireVendor?: string;
  qty?: number | string;
  revenue?: number | string;
  tireCost?: number | string;
  miscCost?: number | string;
  miles?: number | string;
  mileage?: number | string;
  note?: string;
  emergency?: boolean;
  lateNight?: boolean;
  highway?: boolean;
  weekend?: boolean;
  inventoryDeductions?: unknown;
  inventoryUsed?: unknown;
  inventoryDeducted?: boolean;
}

interface BackupInventoryItem {
  id?: string;
  size?: string;
  brand?: string;
  model?: string;
  condition?: string;
  qty?: number | string;
  cost?: number | string;
  sellPrice?: number | string;
  notes?: string;
  treadDepth?: string;
  dotCode?: string;
  createdAt?: number;
}

interface BackupFile {
  version?: number;
  exportedAt?: string;
  jobs?: BackupJob[];
  inventory?: BackupInventoryItem[];
  expenses?: unknown[];
  settings?: unknown;
}

interface DryRunReport {
  batchId: string;
  jobs: {
    total: number;
    ready: number;
    skippedByLegacyId: number;
    skippedByCompositeKey: number;
    warnings: string[];
  };
  inventory: {
    total: number;
    ready: number;
    skippedByLegacyId: number;
    warnings: string[];
  };
  expenses: number;
  customers: number;
}

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePhone(p: unknown): string {
  if (!p) return '';
  return String(p).replace(/[^\d+]/g, '');
}

function jobDedupeKey(j: { date?: string; revenue?: unknown; customerPhone?: unknown; service?: string }): string {
  return [
    j.date || '',
    num(j.revenue).toFixed(2),
    normalizePhone(j.customerPhone),
    String(j.service || '').trim().toLowerCase(),
  ].join('|');
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers — RFC4122-ish, good enough for a batch ID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function mapJob(src: BackupJob, batchId: string, now: string): Record<string, unknown> {
  const invDeductions = src.inventoryDeductions ?? null;
  const invUsed = src.inventoryUsed ?? null;
  return {
    id: src.id || '',
    date: src.date || '',
    service: src.service || '',
    vehicleType: src.vehicleType || '',
    area: src.area || '',
    payment: src.payment || '',
    status: src.status || 'Completed',
    source: src.source || '',
    customerName: src.customerName || '',
    customerPhone: src.customerPhone || '',
    tireSize: src.tireSize || '',
    tireBrand: src.tireBrand || '',
    tireModel: src.tireModel || '',
    tireSource: src.tireSource || '',
    tireVendor: src.tireVendor || '',
    qty: num(src.qty, 1),
    revenue: num(src.revenue),
    tireCost: num(src.tireCost),
    materialCost: 0,
    miscCost: num(src.miscCost),
    miles: num(src.miles ?? src.mileage),
    note: src.note || '',
    emergency: Boolean(src.emergency),
    lateNight: Boolean(src.lateNight),
    highway: Boolean(src.highway),
    weekend: Boolean(src.weekend),
    // fbSet's contract: stringify nested objects/arrays. The Job
    // type has `inventoryDeductions: InventoryDeduction[] | string |
    // null` so the deserializer handles both shapes.
    inventoryDeductions: invDeductions ? JSON.stringify(invDeductions) : null,
    inventoryUsed: invUsed ? JSON.stringify(invUsed) : null,
    // Historical jobs DO NOT re-deduct live inventory.
    historicalInventoryDeducted: Boolean(src.inventoryDeducted),
    paymentStatus: 'paid',
    paidAt: src.date ? `${src.date}T12:00:00Z` : now,
    invoiceGenerated: false,
    invoiceSent: false,
    reviewRequested: false,
    importedFrom: 'wheel-rush-backup',
    importedAt: now,
    legacyWheelRushId: src.id || '',
    migrationBatchId: batchId,
  };
}

function mapInventoryItem(src: BackupInventoryItem, batchId: string, now: string): Record<string, unknown> {
  return {
    id: src.id || '',
    size: src.size || '',
    brand: src.brand || '',
    model: src.model || '',
    condition: src.condition || '',
    qty: num(src.qty),
    cost: num(src.cost),
    sellPrice: num(src.sellPrice),
    notes: src.notes || '',
    treadDepth: src.treadDepth || '',
    dotCode: src.dotCode || '',
    createdAt: typeof src.createdAt === 'number' ? src.createdAt : Date.now(),
    importedFrom: 'wheel-rush-backup',
    importedAt: now,
    legacyWheelRushId: src.id || '',
    migrationBatchId: batchId,
  };
}

export function WheelRushBackupImport() {
  const { businessId, brand } = useBrand();
  const permissions = usePermissions();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [readyJobs, setReadyJobs] = useState<Record<string, unknown>[]>([]);
  const [readyInventory, setReadyInventory] = useState<Record<string, unknown>[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [committedBatchId, setCommittedBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState('');

  // Owner-only gate — same permission used for Lifetime Pro Access panel.
  if (!permissions.canManageBilling) {
    return null;
  }
  if (!businessId) return null;

  const reset = () => {
    setBackup(null);
    setReport(null);
    setReadyJobs([]);
    setReadyInventory([]);
    setBatchId(null);
    setErr(null);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as BackupFile;
      if (!parsed || !Array.isArray(parsed.jobs)) {
        throw new Error('File does not look like a Wheel Rush backup (missing jobs array)');
      }
      setBackup(parsed);
      addToast(`Loaded ${parsed.jobs?.length || 0} jobs + ${parsed.inventory?.length || 0} inventory items`, 'success');
    } catch (e2) {
      const msg = (e2 as Error).message || 'Could not read file';
      setErr(msg);
      addToast(msg, 'error');
    } finally {
      // Reset input so re-selecting the same file re-fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runDryRun = async () => {
    if (!backup || !businessId) return;
    setBusy(true); setErr(null);
    try {
      const db = getFirestore();
      const jobsCol = collection(db, `businesses/${businessId}/jobs`);
      const invCol = collection(db, `businesses/${businessId}/inventory`);

      // Existing data — used for dedupe.
      const [existingJobsSnap, existingInvSnap] = await Promise.all([
        getDocs(jobsCol),
        getDocs(invCol),
      ]);

      const existingJobs: Record<string, unknown>[] = [];
      existingJobsSnap.forEach((d) => existingJobs.push({ id: d.id, ...d.data() }));
      const existingInv: Record<string, unknown>[] = [];
      existingInvSnap.forEach((d) => existingInv.push({ id: d.id, ...d.data() }));

      const existingLegacy = new Set<string>(
        existingJobs
          .map((j) => (j.legacyWheelRushId as string) || (j.importedFrom === 'wheel-rush-backup' ? (j.id as string) : ''))
          .filter(Boolean),
      );
      const existingDedupe = new Set<string>(
        existingJobs.map((j) => jobDedupeKey(j as { date?: string; revenue?: unknown; customerPhone?: unknown; service?: string })),
      );
      const existingInvLegacy = new Set<string>(
        existingInv
          .map((i) => (i.legacyWheelRushId as string) || (i.importedFrom === 'wheel-rush-backup' ? (i.id as string) : ''))
          .filter(Boolean),
      );

      const newBatchId = generateUuid();
      const now = new Date().toISOString();

      const jobsWarnings: string[] = [];
      const jReady: Record<string, unknown>[] = [];
      let jSkippedLegacy = 0;
      let jSkippedKey = 0;
      const customerKeys = new Set<string>();

      for (const src of backup.jobs || []) {
        if (!src.id) {
          jobsWarnings.push(`Job without id: ${src.date} / ${src.service}`);
          continue;
        }
        if (existingLegacy.has(src.id)) { jSkippedLegacy++; continue; }
        const key = jobDedupeKey(src);
        if (existingDedupe.has(key)) { jSkippedKey++; continue; }

        const mapped = mapJob(src, newBatchId, now);

        // ID collision handling: vanishingly rare with 16-hex IDs.
        const idTaken = existingJobs.some((j) => j.id === src.id);
        if (idTaken) {
          mapped.id = generateUuid();
          jobsWarnings.push(`ID collision on ${src.id} — assigned new id`);
        }

        if (!mapped.date) jobsWarnings.push(`Job ${src.id}: missing date`);
        if (!mapped.service) jobsWarnings.push(`Job ${src.id}: missing service`);

        // Track unique customers for the report.
        const cKey = normalizePhone(src.customerPhone) || src.customerName || '';
        if (cKey) customerKeys.add(cKey);

        jReady.push(mapped);
      }

      const invWarnings: string[] = [];
      const iReady: Record<string, unknown>[] = [];
      let iSkippedLegacy = 0;

      for (const src of backup.inventory || []) {
        if (!src.id) {
          invWarnings.push(`Inventory item without id: ${src.size}`);
          continue;
        }
        if (existingInvLegacy.has(src.id)) { iSkippedLegacy++; continue; }
        const mapped = mapInventoryItem(src, newBatchId, now);
        const idTaken = existingInv.some((i) => i.id === src.id);
        if (idTaken) {
          mapped.id = generateUuid();
          invWarnings.push(`ID collision on ${src.id} — assigned new id`);
        }
        iReady.push(mapped);
      }

      setReadyJobs(jReady);
      setReadyInventory(iReady);
      setBatchId(newBatchId);
      setReport({
        batchId: newBatchId,
        jobs: {
          total: backup.jobs?.length || 0,
          ready: jReady.length,
          skippedByLegacyId: jSkippedLegacy,
          skippedByCompositeKey: jSkippedKey,
          warnings: jobsWarnings,
        },
        inventory: {
          total: backup.inventory?.length || 0,
          ready: iReady.length,
          skippedByLegacyId: iSkippedLegacy,
          warnings: invWarnings,
        },
        expenses: backup.expenses?.length || 0,
        customers: customerKeys.size,
      });

      addToast('Dry-run complete. Review the report below.', 'success');
    } catch (e2) {
      const msg = (e2 as Error).message || 'Dry-run failed';
      setErr(msg);
      addToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    if (!report || !batchId || !businessId) return;
    const ok = window.confirm(
      `Import ${readyJobs.length} jobs + ${readyInventory.length} inventory items into ${brand.businessName || 'this business'}?\n\nBatch ID: ${batchId}\n\nThis will write to Firestore. Save the batch ID for rollback if needed.`,
    );
    if (!ok) return;

    setBusy(true); setErr(null);
    try {
      const db = getFirestore();

      // Firestore WriteBatch is capped at 500 operations per commit.
      const CHUNK = 400;
      const chunks = <T,>(arr: T[]): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
        return out;
      };

      const writeChunked = async (colName: string, items: Record<string, unknown>[]) => {
        let written = 0;
        for (const chunk of chunks(items)) {
          const batch = writeBatch(db);
          for (const item of chunk) {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(item)) {
              if (v === undefined) continue;
              if (v === null) { clean[k] = null; continue; }
              if (typeof v === 'object') { clean[k] = JSON.stringify(v); continue; }
              clean[k] = v;
            }
            clean.id = String(item.id);
            batch.set(doc(db, `businesses/${businessId}/${colName}`, String(item.id)), clean, { merge: true });
          }
          await batch.commit();
          written += chunk.length;
        }
        return written;
      };

      const writtenJobs = await writeChunked('jobs', readyJobs);
      const writtenInv = await writeChunked('inventory', readyInventory);

      setCommittedBatchId(batchId);
      addToast(`Imported ${writtenJobs} jobs + ${writtenInv} inventory items`, 'success');
    } catch (e2) {
      const msg = (e2 as Error).message || 'Import failed';
      setErr(msg);
      addToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runRollback = async () => {
    const id = rollbackId.trim();
    if (!id || !businessId) return;
    const ok = window.confirm(
      `Delete ALL docs with migrationBatchId = ${id}?\n\nThis cannot be undone (but it only affects docs imported with that exact batch ID).`,
    );
    if (!ok) return;

    setBusy(true); setErr(null);
    try {
      const db = getFirestore();
      let totalDeleted = 0;
      for (const colName of ['jobs', 'inventory'] as const) {
        const q = query(
          collection(db, `businesses/${businessId}/${colName}`),
          where('migrationBatchId', '==', id),
        );
        const snap = await getDocs(q);
        // Batch delete in chunks of 400.
        let i = 0;
        let batch = writeBatch(db);
        for (const d of snap.docs) {
          batch.delete(d.ref);
          i++;
          if (i % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        if (i % 400 !== 0) await batch.commit();
        totalDeleted += snap.size;
      }
      addToast(`Rolled back ${totalDeleted} docs`, 'success');
      setRollbackId('');
    } catch (e2) {
      const msg = (e2 as Error).message || 'Rollback failed';
      setErr(msg);
      addToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      padding: 14,
      background: 'var(--s2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: 14,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--t1)', marginBottom: 4 }}>
        🛠️ Wheel Rush backup import
      </div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.5 }}>
        Owner-only one-time tool. Imports a Wheel Rush backup JSON
        into <strong>{brand.businessName || 'this business'}</strong>. Runs in
        dry-run mode first; you must explicitly commit after review.
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      <button
        className="btn secondary sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        style={{ width: '100%', marginBottom: 10 }}
      >
        {backup ? `Loaded: ${backup.jobs?.length || 0} jobs · ${backup.inventory?.length || 0} inventory` : 'Pick backup JSON…'}
      </button>

      {backup && !report && (
        <button
          className="btn primary"
          onClick={runDryRun}
          disabled={busy}
          style={{ width: '100%', marginBottom: 10 }}
        >
          {busy ? 'Analyzing…' : 'Run dry-run'}
        </button>
      )}

      {report && (
        <div style={{
          padding: 10,
          background: 'var(--s1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 10,
          fontSize: 12,
          color: 'var(--t1)',
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Dry-run report</div>
          <div>Batch ID: <code style={{ fontSize: 10, wordBreak: 'break-all' }}>{report.batchId}</code></div>
          <div style={{ marginTop: 8, fontWeight: 700, color: 'var(--brand-primary)' }}>Jobs</div>
          <div>Total in backup: {report.jobs.total}</div>
          <div>Ready to import: <strong>{report.jobs.ready}</strong></div>
          <div>Skipped (already imported): {report.jobs.skippedByLegacyId}</div>
          <div>Skipped (duplicate by date+revenue+phone+service): {report.jobs.skippedByCompositeKey}</div>
          <div style={{ marginTop: 8, fontWeight: 700, color: 'var(--brand-primary)' }}>Inventory</div>
          <div>Total in backup: {report.inventory.total}</div>
          <div>Ready to import: <strong>{report.inventory.ready}</strong></div>
          <div>Skipped (already imported): {report.inventory.skippedByLegacyId}</div>
          <div style={{ marginTop: 8, fontWeight: 700, color: 'var(--brand-primary)' }}>Customers</div>
          <div>Unique (derived from jobs): {report.customers}</div>
          <div style={{ fontSize: 10, color: 'var(--t3)' }}>
            (no separate collection — names + phones stay on each job)
          </div>
          <div style={{ marginTop: 8, fontWeight: 700, color: 'var(--brand-primary)' }}>Expenses</div>
          <div>{report.expenses} in backup — <strong>SKIPPED</strong> (schema differs)</div>
          {(report.jobs.warnings.length > 0 || report.inventory.warnings.length > 0) && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--t2)' }}>
                Warnings ({report.jobs.warnings.length + report.inventory.warnings.length})
              </summary>
              <ul style={{ fontSize: 10, marginTop: 6, paddingLeft: 18, color: 'var(--t3)' }}>
                {[...report.jobs.warnings, ...report.inventory.warnings].slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {report && !committedBatchId && (
        <button
          className="btn primary"
          onClick={runCommit}
          disabled={busy || (readyJobs.length === 0 && readyInventory.length === 0)}
          style={{ width: '100%', marginBottom: 10 }}
        >
          {busy ? 'Importing…' : `Commit import (${readyJobs.length} jobs + ${readyInventory.length} inventory)`}
        </button>
      )}

      {committedBatchId && (
        <div style={{
          padding: 12,
          background: 'rgba(34,197,94,.1)',
          border: '1px solid rgba(34,197,94,.3)',
          borderRadius: 8,
          marginBottom: 10,
          fontSize: 12,
          color: 'var(--t1)',
        }}>
          <div style={{ fontWeight: 700, color: 'rgb(34,197,94)', marginBottom: 4 }}>
            ✓ Import complete
          </div>
          <div style={{ fontSize: 11 }}>
            Save this batch ID for rollback if needed:
          </div>
          <code style={{
            display: 'block',
            padding: '6px 8px',
            background: 'var(--s2)',
            borderRadius: 4,
            fontSize: 10,
            wordBreak: 'break-all',
            marginTop: 4,
          }}>
            {committedBatchId}
          </code>
        </div>
      )}

      {err && (
        <div style={{
          padding: 10,
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 8,
          fontSize: 12,
          color: 'rgb(239,68,68)',
          marginBottom: 10,
        }}>
          {err}
        </div>
      )}

      <details style={{ marginTop: 14, fontSize: 11, color: 'var(--t3)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Rollback</summary>
        <div style={{ marginTop: 8, lineHeight: 1.5 }}>
          Deletes all jobs + inventory items written with a specific
          migrationBatchId. Safe — never touches anything else.
        </div>
        <input
          type="text"
          value={rollbackId}
          onChange={(e) => setRollbackId(e.target.value)}
          placeholder="paste batch ID…"
          style={{
            width: '100%', marginTop: 8,
            padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--s1)', color: 'var(--t1)',
            fontSize: 12,
          }}
        />
        <button
          className="btn danger sm"
          onClick={runRollback}
          disabled={busy || !rollbackId.trim()}
          style={{ width: '100%', marginTop: 8 }}
        >
          Roll back this batch
        </button>
      </details>
    </div>
  );
}
