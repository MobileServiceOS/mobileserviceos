// src/components/settings/ExportDataSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  Export Data — self-serve account data export (owner/admin only).
//
//  Reads the business's collections fresh from Firestore and downloads
//  them. JSON = a complete portable backup of everything; the CSV
//  buttons are spreadsheet-friendly extracts of the two collections
//  operators most often want in Excel/Sheets (jobs + inventory).
//
//  No server call — pure client reads of collections the operator can
//  already see, assembled into a file. Gated to owner/admin via
//  canViewFinancials (the export includes revenue + customer PII).
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import type { Settings } from '@/types';
import { requireDb } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { AccordionShell } from '@/components/settings/AccordionShell';

interface Props {
  settings: Settings;
  open: boolean;
  onToggle: () => void;
}

type Row = Record<string, unknown>;

/** Firestore Timestamps → ISO strings so the JSON is human-readable. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Row[], columns: string[]): string {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${head}\n${body}`;
}

function stamp(): string {
  // YYYY-MM-DD for the filename (local date).
  return new Date().toLocaleDateString('en-CA');
}

export function ExportDataSection({ settings, open, onToggle }: Props) {
  const { businessId, brand } = useBrand();
  const { canViewFinancials } = usePermissions();
  const [busy, setBusy] = useState<null | 'json' | 'jobs' | 'inventory'>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canViewFinancials || !businessId) return null;

  const readCol = async (name: string): Promise<Row[]> => {
    const snap = await getDocs(collection(requireDb(), 'businesses', businessId, name));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  const exportJson = async () => {
    setBusy('json'); setError(null);
    try {
      const [jobs, customers, inventory, leads, expenses] = await Promise.all([
        readCol('jobs'), readCol('customers'), readCol('inventory'),
        readCol('leads'), readCol('expenses'),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        businessId,
        businessName: brand?.businessName ?? '',
        counts: {
          jobs: jobs.length, customers: customers.length, inventory: inventory.length,
          leads: leads.length, expenses: expenses.length,
        },
        jobs, customers, inventory, leads, expenses,
        settings,
        brand,
      };
      downloadFile(`msos-export-${stamp()}.json`, JSON.stringify(payload, jsonReplacer, 2), 'application/json');
    } catch (e) {
      setError((e as Error).message || 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  const exportJobsCsv = async () => {
    setBusy('jobs'); setError(null);
    try {
      const jobs = await readCol('jobs');
      const cols = ['id', 'date', 'customerName', 'customerPhone', 'service', 'tireSize', 'qty',
        'revenue', 'paymentStatus', 'paymentMethod', 'paidAt', 'collectedByName', 'city', 'state', 'status'];
      downloadFile(`msos-jobs-${stamp()}.csv`, toCsv(jobs, cols), 'text/csv;charset=utf-8');
    } catch (e) {
      setError((e as Error).message || 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  const exportInventoryCsv = async () => {
    setBusy('inventory'); setError(null);
    try {
      const inv = await readCol('inventory');
      const cols = ['id', 'size', 'condition', 'qty', 'cost', 'brand', 'model', 'reorderPoint', 'notes'];
      downloadFile(`msos-inventory-${stamp()}.csv`, toCsv(inv, cols), 'text/csv;charset=utf-8');
    } catch (e) {
      setError((e as Error).message || 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AccordionShell title="Export Data" icon="⬇️" summary="Download your jobs, customers, inventory & more" open={open} onToggle={onToggle}>
      <p style={help}>
        Download a copy of your account data. The JSON file is a complete
        backup of everything; the CSV files open directly in Excel / Google
        Sheets.
      </p>

      <button type="button" className="btn primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy !== null} onClick={exportJson}>
        {busy === 'json' ? 'Preparing…' : 'Download all data (JSON)'}
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn secondary" style={{ flex: 1 }} disabled={busy !== null} onClick={exportJobsCsv}>
          {busy === 'jobs' ? 'Preparing…' : 'Jobs (CSV)'}
        </button>
        <button type="button" className="btn secondary" style={{ flex: 1 }} disabled={busy !== null} onClick={exportInventoryCsv}>
          {busy === 'inventory' ? 'Preparing…' : 'Inventory (CSV)'}
        </button>
      </div>

      {error && <p style={{ ...help, color: 'var(--danger, #f87171)', marginTop: 8 }}>Export failed: {error}</p>}
      <p style={{ ...help, marginTop: 10 }}>
        Includes jobs, customers, inventory, leads, expenses, and your settings.
        It's a snapshot from right now — re-export anytime.
      </p>
    </AccordionShell>
  );
}

const help: React.CSSProperties = { fontSize: 12, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.5 };
