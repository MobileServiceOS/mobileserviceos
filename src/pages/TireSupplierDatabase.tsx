import { useEffect, useMemo, useState } from 'react';
import type { TireSupplierPrice, TireCategory } from '@/lib/tireQuoteTypes';
import { DEFAULT_SUPPLIER_NAMES } from '@/lib/tireQuoteTypes';
import { scopedCol, fbListen, fbSetFast, fbDelete } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { useMembership } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
import { uid, money } from '@/lib/utils';
import { normalizeTireSizeQuery } from '@/lib/inventoryNotesParser';
import { mergeSupplierBulkRows, type MergeableSupplierRow } from '@/lib/tireSupplierBulkMerge';
import { TireSupplierEditSheet } from '@/components/tireSupplier/TireSupplierEditSheet';

// ─────────────────────────────────────────────────────────────────────
//  src/pages/TireSupplierDatabase.tsx — Tire Quote Engine Phase 2.
//
//  Owner/admin CRUD over businesses/{bid}/tireSupplierPrices. Each
//  business sees ONLY their own records (path scoping enforced by
//  Firestore rules — see firestore.rules:534-538).
//
//  Tech users are blocked from this page at the navigation layer
//  (MoreSheet entry uses permissions.canEditPricingSettings). If a
//  tech somehow lands here via direct URL, the early-return below
//  shows a "permission required" view rather than the catalog.
//
//  Patterns mirrored from Inventory.tsx:
//    - Lazy listener (subscribes on mount, unsubs on unmount —
//      same approach the recent Customers refactor uses)
//    - Immediate save per CRUD action (no dirty-state Save bar —
//      this is the lesson from the bulk-upload data-loss bug
//      shipped earlier this session in commit 734c43d)
//    - CSV bulk import with preview → commit, also persisting
//      immediately on commit (mirrors the applyBulk fix from
//      Inventory)
//    - Two-axis dedup via src/lib/tireSupplierBulkMerge.ts
// ─────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'supplierName', 'tireSize', 'brand', 'model', 'cost',
  'quantityAvailable', 'condition', 'treadDepth', 'category',
  'runFlat', 'evRated', 'xlLoad', 'notes',
];

const CSV_TEMPLATE = CSV_HEADERS.join(',') + '\n' +
  'ATD,225/65R17,Michelin,Defender 2,110,8,new,,midrange,false,false,false,"Bulk order $5 off"\n' +
  'ATD,245/40R18,Sentury,Touring,55,12,new,,budget,false,false,false,\n' +
  'Used Inventory,205/55R16,Goodyear,Assurance,30,4,used,7,budget,false,false,false,\n';

type ConditionFilter = 'all' | 'new' | 'used';
type CategoryFilter = 'all' | TireCategory;

export function TireSupplierDatabase() {
  const { businessId, brand } = useBrand();
  const { permissions } = useMembership();

  // Permission gate — match the MoreSheet visibility check so direct-
  // URL access can't bypass the role boundary. Falls back to a polite
  // empty state for techs who somehow navigate here.
  if (!permissions.canEditPricingSettings) {
    return (
      <div className="page page-enter" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 14 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          Supplier database
        </div>
        <div style={{ fontSize: 13, color: 'var(--t3)', maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
          Only owners and admins can manage tire supplier pricing.
          Ask your owner if you need access.
        </div>
      </div>
    );
  }

  return <Inner businessId={businessId} businessName={brand.businessName || ''} />;
}

interface InnerProps {
  businessId: string | null;
  businessName: string;
}

function Inner({ businessId, businessName }: InnerProps) {
  // ─── Live data ─────────────────────────────────────────────────
  const [prices, setPrices] = useState<TireSupplierPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    const unsub = fbListen(
      scopedCol(businessId, 'tireSupplierPrices'),
      (docs) => {
        setPrices(docs as unknown as TireSupplierPrice[]);
        setLoading(false);
      },
      (err) => {
        console.warn('[tireSupplierDatabase] listener error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [businessId]);

  // ─── Filters + search ──────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState<string | 'all'>('all');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const filtered = useMemo(() => {
    let base = prices;
    if (supplierFilter !== 'all') {
      base = base.filter((p) => p.supplierName === supplierFilter);
    }
    if (conditionFilter !== 'all') {
      base = base.filter((p) => p.condition === conditionFilter);
    }
    if (categoryFilter !== 'all') {
      base = base.filter((p) => p.category === categoryFilter);
    }
    const qRaw = search.trim().toLowerCase();
    if (!qRaw) return base;
    const q = normalizeTireSizeQuery(qRaw).toLowerCase();
    return base.filter((p) => {
      const size = (p.tireSize || '').toLowerCase();
      const brand = (p.brand || '').toLowerCase();
      const model = (p.model || '').toLowerCase();
      const sup = String(p.supplierName || '').toLowerCase();
      const notes = (p.notes || '').toLowerCase();
      return size.includes(q) || brand.includes(q) || model.includes(q)
        || sup.includes(q) || notes.includes(q);
    });
  }, [prices, search, supplierFilter, conditionFilter, categoryFilter]);

  // Unique supplier names (default 5 + any custom ones in the data)
  const supplierOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_SUPPLIER_NAMES);
    for (const p of prices) set.add(String(p.supplierName));
    return Array.from(set).sort();
  }, [prices]);

  // ─── Edit sheet ────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<TireSupplierPrice | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);

  const handleSave = async (next: TireSupplierPrice) => {
    if (!businessId) return;
    const userUid = '';  // App.tsx threads this in via context normally; use empty fallback
    const finalDoc: TireSupplierPrice = {
      ...next,
      id: next.id || uid(),
      lastUpdated: new Date().toISOString(),
      createdBy: next.createdBy || userUid,
    };
    try {
      await fbSetFast(scopedCol(businessId, 'tireSupplierPrices'), finalDoc.id, finalDoc);
      addToast(editTarget ? 'Tire updated' : 'Tire added', 'success');
      setEditTarget(null);
      setShowAddSheet(false);
    } catch (e) {
      addToast(`Save failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  };

  const handleDelete = async () => {
    if (!businessId || !editTarget) return;
    try {
      await fbDelete(scopedCol(businessId, 'tireSupplierPrices'), editTarget.id);
      addToast('Tire deleted', 'success');
      setEditTarget(null);
    } catch (e) {
      addToast(`Delete failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  };

  // ─── CSV import ────────────────────────────────────────────────
  const [bulkRows, setBulkRows] = useState<MergeableSupplierRow[] | null>(null);

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow same-file re-upload
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      addToast('No rows parsed from that CSV', 'warn');
      return;
    }
    setBulkRows(rows);
  };

  const handleCsvCommit = async () => {
    if (!businessId || !bulkRows) return;
    const userUid = '';
    const now = new Date().toISOString();
    const result = mergeSupplierBulkRows(prices, bulkRows, uid, now, userUid);
    // Write every changed row. Mirrors inventoryBulkMerge applyBulk
    // pattern from src/pages/Inventory.tsx — persist immediately so
    // a tab close after the toast doesn't lose the import.
    try {
      const writes: Promise<void>[] = [];
      const col = scopedCol(businessId, 'tireSupplierPrices');
      for (const row of result.next) {
        writes.push(fbSetFast(col, row.id, row));
      }
      await Promise.all(writes);
      const parts = [
        result.addedCount ? `Added ${result.addedCount} new` : '',
        result.mergedCount ? `merged ${result.mergedCount} into existing` : '',
        result.collapsedCount ? `collapsed ${result.collapsedCount} duplicates` : '',
      ].filter(Boolean);
      addToast(parts.join(', ') || 'No changes', 'success');
      setBulkRows(null);
    } catch (err) {
      addToast(`Bulk import failed: ${humanizeFirestoreError(err)}`, 'error');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tire-supplier-template.csv';
    a.click();
  };

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        Tire Suppliers
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>
        {businessName} · Wholesale prices, owner/admin only
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => setShowAddSheet(true)} style={{ flex: 1 }}>
          + Add Tire
        </button>
        <label className="btn secondary" style={{ flex: 1, cursor: 'pointer', textAlign: 'center' }}>
          ⬆ Bulk Upload
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFile}
            style={{ display: 'none' }}
          />
        </label>
        <button className="btn secondary" onClick={downloadTemplate}>
          📥 Template
        </button>
      </div>

      {/* Search + filters */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by size, brand, model, supplier…"
        style={{
          width: '100%',
          padding: '10px 12px',
          marginBottom: 10,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--s2)',
          color: 'var(--t1)',
          fontSize: 14,
        }}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <FilterSelect label="Supplier" value={supplierFilter} options={[
          { v: 'all', l: 'All suppliers' },
          ...supplierOptions.map((s) => ({ v: s, l: s })),
        ]} onChange={(v) => setSupplierFilter(v)} />
        <FilterSelect label="Condition" value={conditionFilter} options={[
          { v: 'all', l: 'New + Used' },
          { v: 'new', l: 'New only' },
          { v: 'used', l: 'Used only' },
        ]} onChange={(v) => setConditionFilter(v as ConditionFilter)} />
        <FilterSelect label="Category" value={categoryFilter} options={[
          { v: 'all', l: 'All tiers' },
          { v: 'budget', l: 'Budget (Good)' },
          { v: 'midrange', l: 'Midrange (Better)' },
          { v: 'premium', l: 'Premium (Best)' },
        ]} onChange={(v) => setCategoryFilter(v as CategoryFilter)} />
      </div>

      {/* KPI summary */}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-label">SKUs</div><div className="kpi-value">{filtered.length}</div></div>
        <div className="kpi"><div className="kpi-label">Total Qty</div>
          <div className="kpi-value">{filtered.reduce((s, p) => s + Number(p.quantityAvailable || 0), 0)}</div>
        </div>
        <div className="kpi"><div className="kpi-label">Total Value</div>
          <div className="kpi-value">{money(filtered.reduce((s, p) => s + (Number(p.cost || 0) * Number(p.quantityAvailable || 0)), 0))}</div>
        </div>
      </div>

      {/* Tire cards */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
          Loading suppliers…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🛞</div>
          <div className="empty-state-title">No supplier tires</div>
          <div className="empty-state-sub">
            {search.trim() || supplierFilter !== 'all' || conditionFilter !== 'all' || categoryFilter !== 'all'
              ? 'No matches. Clear filters or try a different search.'
              : 'Add tires individually or bulk-upload a CSV.'}
          </div>
        </div>
      ) : (
        <div className="stack">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditTarget(p)}
              className="card card-anim"
              style={{
                width: '100%', textAlign: 'left',
                padding: '12px 14px',
                background: 'var(--s1)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                color: 'var(--t1)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{p.tireSize}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>
                  {p.brand} {p.model}
                </span>
                <span className={'pill ' + (p.condition === 'used' ? 'amber' : 'green')}
                  style={{ fontSize: 9, padding: '2px 6px' }}>
                  {p.condition === 'used' ? 'Used' : 'New'}
                </span>
                <span className="pill" style={{ fontSize: 9, padding: '2px 6px', background: 'rgba(200,164,74,0.15)', color: 'var(--brand-primary)' }}>
                  {p.category === 'budget' ? 'GOOD' : p.category === 'midrange' ? 'BETTER' : 'BEST'}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t3)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>{String(p.supplierName)}</span>
                <span>· Cost {money(p.cost)}/tire</span>
                <span>· Qty {p.quantityAvailable}</span>
                {p.runFlat && <span>· Run-flat</span>}
                {p.evRated && <span>· EV</span>}
                {p.xlLoad && <span>· XL</span>}
                {p.treadDepth !== undefined && p.condition === 'used' && (
                  <span>· {p.treadDepth}/32"</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {(editTarget || showAddSheet) && (
        <TireSupplierEditSheet
          initial={editTarget}
          onSave={handleSave}
          onDelete={editTarget ? handleDelete : undefined}
          onClose={() => { setEditTarget(null); setShowAddSheet(false); }}
        />
      )}

      {bulkRows && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setBulkRows(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="card" style={{ background: 'var(--s1)', maxWidth: 720, width: '100%', maxHeight: '85vh', overflowY: 'auto', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Bulk Upload Preview</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
              {bulkRows.length} row{bulkRows.length === 1 ? '' : 's'} parsed
            </div>
            <div style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
              {bulkRows.map((r, i) => (
                <div key={i} style={{ padding: '8px 10px', borderBottom: i < bulkRows.length - 1 ? '1px solid var(--border2)' : 'none', fontSize: 12 }}>
                  <strong>{r.tireSize}</strong> {r.brand} {r.model} · {String(r.supplierName)} · {r.condition} · {money(r.cost)}/tire · qty {r.quantityAvailable}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={handleCsvCommit} style={{ flex: 2 }}>
                Add {bulkRows.length} Tire{bulkRows.length === 1 ? '' : 's'}
              </button>
              <button className="btn secondary" onClick={() => setBulkRows(null)} style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tiny CSV parser — same shape as Inventory.tsx ────────────────

function parseCsv(text: string): MergeableSupplierRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name.toLowerCase());
  const ix = {
    supplierName: idx('supplierName'),
    tireSize: idx('tireSize'),
    brand: idx('brand'),
    model: idx('model'),
    cost: idx('cost'),
    quantityAvailable: idx('quantityAvailable'),
    condition: idx('condition'),
    treadDepth: idx('treadDepth'),
    category: idx('category'),
    runFlat: idx('runFlat'),
    evRated: idx('evRated'),
    xlLoad: idx('xlLoad'),
    notes: idx('notes'),
  };
  const out: MergeableSupplierRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (col: number): string => col >= 0 ? (cells[col] || '').trim() : '';
    const tireSize = get(ix.tireSize);
    const brand = get(ix.brand);
    const model = get(ix.model);
    const supplierName = get(ix.supplierName);
    if (!tireSize || !brand || !model || !supplierName) continue;
    const cond = (get(ix.condition).toLowerCase() === 'used' ? 'used' : 'new') as 'new' | 'used';
    const cat = (get(ix.category).toLowerCase() as 'budget' | 'midrange' | 'premium');
    out.push({
      supplierName,
      tireSize,
      brand,
      model,
      cost: Number(get(ix.cost)) || 0,
      quantityAvailable: Number(get(ix.quantityAvailable)) || 0,
      condition: cond,
      treadDepth: get(ix.treadDepth) ? Number(get(ix.treadDepth)) : undefined,
      category: ['budget', 'midrange', 'premium'].includes(cat) ? cat : 'midrange',
      runFlat: get(ix.runFlat).toLowerCase() === 'true',
      evRated: get(ix.evRated).toLowerCase() === 'true',
      xlLoad: get(ix.xlLoad).toLowerCase() === 'true',
      notes: get(ix.notes) || undefined,
    });
  }
  return out;
}

/** Minimal CSV line splitter that respects double-quoted fields
 *  (so values containing commas like notes don't break the row). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ─── Small inline component ───────────────────────────────────────

function FilterSelect<V extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: V;
  options: { v: V; l: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as V)}
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--s2)',
        color: 'var(--t1)',
        fontSize: 12,
        fontWeight: 600,
      }}
      aria-label={label}
    >
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}
