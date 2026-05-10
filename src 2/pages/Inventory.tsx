import { useMemo, useRef, useState } from 'react';
import type { InventoryItem } from '@/types';
import { money, sanitizeInvItem, uid } from '@/lib/utils';
import { addToast } from '@/lib/toast';

interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
}

const CSV_HEADERS = ['tireSize', 'condition', 'quantity', 'cost', 'sellingPrice', 'vendor', 'notes'];
const CSV_TEMPLATE = `${CSV_HEADERS.join(',')}\n225/60R18,New,4,85,140,Discount Tire,Premium SUV\n245/40R19,Used,2,55,110,Local Wholesaler,Tread 7/32\n`;

interface ParsedRow {
  tireSize: string;
  condition: string;
  quantity: number;
  cost: number;
  sellingPrice: number;
  vendor: string;
  notes: string;
  _row: number;
  _error?: string;
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const head = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const idx = (name: string) => head.indexOf(name.toLowerCase());
  const ix = {
    tireSize: idx('tireSize'),
    condition: idx('condition'),
    quantity: idx('quantity'),
    cost: idx('cost'),
    sellingPrice: idx('sellingPrice'),
    vendor: idx('vendor'),
    notes: idx('notes'),
  };
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const get = (k: number) => (k >= 0 && k < cols.length ? cols[k].trim() : '');
    const tireSize = get(ix.tireSize);
    if (!tireSize) continue;
    const condition = get(ix.condition) || 'New';
    const quantity = Number(get(ix.quantity)) || 0;
    const cost = Number(get(ix.cost)) || 0;
    const sellingPrice = Number(get(ix.sellingPrice)) || 0;
    let error: string | undefined;
    if (quantity < 0) error = 'Negative quantity';
    if (cost < 0) error = 'Negative cost';
    rows.push({
      tireSize,
      condition: condition === 'Used' ? 'Used' : 'New',
      quantity,
      cost,
      sellingPrice,
      vendor: get(ix.vendor),
      notes: get(ix.notes),
      _row: i + 1,
      _error: error,
    });
  }
  return rows;
}

// Minimal CSV line splitter that handles quoted fields with commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function Inventory({ inventory, onSave }: Props) {
  const safe: InventoryItem[] = Array.isArray(inventory) ? inventory : [];
  const [list, setList] = useState<InventoryItem[]>(safe);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [bulkRows, setBulkRows] = useState<ParsedRow[] | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const update = (next: InventoryItem[]) => {
    setList(next);
    setDirty(true);
  };

  const add = () =>
    update([
      { id: uid(), size: '', qty: 0, cost: 0, condition: 'New', brand: '', model: '', notes: '', _isNew: true },
      ...list,
    ]);
  const remove = (id: string) => update(list.filter((i) => i.id !== id));
  const change = <K extends keyof InventoryItem>(id: string, key: K, value: InventoryItem[K]) =>
    update(list.map((i) => (i.id === id ? { ...i, [key]: value } : i)));

  const save = () => {
    const cleaned = list.filter((i) => (i.size || '').trim()).map((i) => sanitizeInvItem(i));
    onSave(cleaned);
    setList(cleaned);
    setDirty(false);
    addToast('Inventory saved', 'success');
  };

  const filtered = useMemo(() => {
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(
      (i) =>
        (i.size || '').toLowerCase().includes(s) ||
        (i.brand || '').toLowerCase().includes(s) ||
        (i.model || '').toLowerCase().includes(s) ||
        (i.notes || '').toLowerCase().includes(s)
    );
  }, [list, search]);

  const totalValue = list.reduce((t, i) => t + Number(i.qty || 0) * Number(i.cost || 0), 0);
  const totalQty = list.reduce((t, i) => t + Number(i.qty || 0), 0);

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const rows = parseCsv(text);
      if (!rows.length) {
        addToast('No rows found in CSV', 'warn');
        return;
      }
      setBulkRows(rows);
    };
    reader.onerror = () => addToast('Could not read file', 'error');
    reader.readAsText(file);
  };

  const applyBulk = () => {
    if (!bulkRows) return;
    const ok = bulkRows.filter((r) => !r._error);
    const next: InventoryItem[] = [
      ...ok.map<InventoryItem>((r) => ({
        id: uid(),
        size: r.tireSize,
        qty: r.quantity,
        cost: r.cost,
        condition: r.condition,
        brand: '',
        model: '',
        notes: [r.vendor && `Vendor: ${r.vendor}`, r.sellingPrice ? `Sell: $${r.sellingPrice}` : '', r.notes]
          .filter(Boolean)
          .join(' · '),
      })),
      ...list,
    ];
    update(next);
    setBulkRows(null);
    addToast(`Added ${ok.length} row${ok.length === 1 ? '' : 's'}`, 'success');
  };

  const confirmDeleteAll = () => {
    if (deleteConfirm !== 'DELETE') return;
    update([]);
    onSave([]);
    setShowDeleteAll(false);
    setDeleteConfirm('');
    addToast('Inventory cleared', 'success');
  };

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Inventory</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn xs secondary" onClick={downloadTemplate}>
            ⬇ Template
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <button className="btn xs secondary" onClick={() => fileInputRef.current?.click()}>
            ⬆ Bulk Upload
          </button>
          {list.length > 0 ? (
            <button className="btn xs danger" onClick={() => setShowDeleteAll(true)}>
              Delete All
            </button>
          ) : null}
          <button className="btn xs primary" onClick={add}>
            ＋ Add Tire
          </button>
        </div>
      </div>
      <div className="kpi-grid three">
        <div className="kpi">
          <div className="kpi-label">SKUs</div>
          <div className="kpi-value">{list.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total Qty</div>
          <div className="kpi-value">{totalQty}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Value</div>
          <div className="kpi-value">{money(totalValue)}</div>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by size, brand, model..." />
      </div>
      {list.length === 0 && (
        <div className="empty">
          <div className="empty-icon">🛞</div>
          <div className="empty-title">No tires in stock</div>
          <div className="empty-sub">Add a size to start tracking inventory</div>
        </div>
      )}
      <div className="stack">
        {filtered.map((i) => (
          <div key={i.id} className="form-group">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                value={i.size}
                onChange={(e) => change(i.id, 'size', e.target.value)}
                placeholder="225/60R18"
                style={{
                  flex: 1,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r3)',
                  padding: '11px 14px',
                  background: 'var(--s3)',
                  color: 'var(--t1)',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              />
              <button className="btn xs danger" onClick={() => remove(i.id)} style={{ flexShrink: 0, minWidth: 40 }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn xs secondary"
                  onClick={() => change(i.id, 'qty', Math.max(0, Number(i.qty || 0) - 1))}
                  style={{ minWidth: 36 }}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  value={i.qty}
                  onChange={(e) => change(i.id, 'qty', Math.max(0, Number(e.target.value)))}
                  style={{
                    width: 50,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r4)',
                    padding: '8px 10px',
                    background: 'var(--s3)',
                    color: 'var(--t1)',
                    fontSize: 14,
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                />
                <button
                  className="btn xs secondary"
                  onClick={() => change(i.id, 'qty', Number(i.qty || 0) + 1)}
                  style={{ minWidth: 36 }}
                >
                  +
                </button>
              </div>
              <input
                type="number"
                inputMode="decimal"
                value={i.cost}
                onChange={(e) => change(i.id, 'cost', Number(e.target.value))}
                placeholder="$ cost"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r4)',
                  padding: '8px 10px',
                  background: 'var(--s3)',
                  color: 'var(--t1)',
                  fontSize: 14,
                }}
              />
              <select
                value={i.condition || 'New'}
                onChange={(e) => change(i.id, 'condition', e.target.value)}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r4)',
                  padding: '8px 10px',
                  background: 'var(--s3)',
                  color: 'var(--t1)',
                  fontSize: 14,
                }}
              >
                <option>New</option>
                <option>Used</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                value={i.brand || ''}
                onChange={(e) => change(i.id, 'brand', e.target.value)}
                placeholder="Brand"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r4)',
                  padding: '8px 10px',
                  background: 'var(--s3)',
                  color: 'var(--t1)',
                  fontSize: 13,
                }}
              />
              <input
                value={i.model || ''}
                onChange={(e) => change(i.id, 'model', e.target.value)}
                placeholder="Model"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r4)',
                  padding: '8px 10px',
                  background: 'var(--s3)',
                  color: 'var(--t1)',
                  fontSize: 13,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {dirty && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, background: 'linear-gradient(to top, var(--bg) 60%, transparent)' }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={save}>
            Save Inventory
          </button>
        </div>
      )}

      {bulkRows ? (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setBulkRows(null)}>
          <div className="modal modal-lg">
            <div className="modal-title">Bulk Upload Preview</div>
            <div className="modal-sub">
              {bulkRows.length} row{bulkRows.length === 1 ? '' : 's'} parsed
              {bulkRows.some((r) => r._error) ? ' · errored rows will be skipped' : ''}
            </div>
            <div className="bulk-preview">
              <div className="bulk-preview-row bulk-preview-head">
                <span>Size</span>
                <span>Qty</span>
                <span>Cost</span>
                <span>Sell</span>
                <span>Vendor</span>
              </div>
              {bulkRows.map((r) => (
                <div key={r._row} className={'bulk-preview-row' + (r._error ? ' err' : '')}>
                  <span>{r.tireSize}</span>
                  <span>{r.quantity}</span>
                  <span>{money(r.cost)}</span>
                  <span>{money(r.sellingPrice)}</span>
                  <span>{r.vendor || '—'}</span>
                  {r._error ? <span className="bulk-preview-error">⚠ {r._error}</span> : null}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setBulkRows(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={applyBulk}>
                Add {bulkRows.filter((r) => !r._error).length} Tires
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteAll ? (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDeleteAll(false);
              setDeleteConfirm('');
            }
          }}
        >
          <div className="modal">
            <div className="modal-title" style={{ color: 'var(--red)' }}>
              Delete entire inventory?
            </div>
            <div className="modal-sub">
              This permanently removes all {list.length} SKU{list.length === 1 ? '' : 's'} from
              your records and syncs the deletion to Firestore. This cannot be undone.
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>
                Type <strong style={{ color: 'var(--red)' }}>DELETE</strong> to confirm
              </label>
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn secondary"
                onClick={() => {
                  setShowDeleteAll(false);
                  setDeleteConfirm('');
                }}
              >
                Cancel
              </button>
              <button className="btn danger" onClick={confirmDeleteAll} disabled={deleteConfirm !== 'DELETE'}>
                Delete All
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
