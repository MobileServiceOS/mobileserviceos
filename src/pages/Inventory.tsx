import { useMemo, useRef, useState } from 'react';
import type { InventoryItem } from '@/types';
import { money, sanitizeInvItem, uid } from '@/lib/utils';
import { addToast } from '@/lib/toast';
import { NumberField } from '@/components/NumberField';

interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
}

type CondFilter = 'all' | 'New' | 'Used';

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

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (c === ',' && !inQuotes) { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
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
      quantity, cost, sellingPrice,
      vendor: get(ix.vendor), notes: get(ix.notes),
      _row: i + 1, _error: error,
    });
  }
  return rows;
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

  // Track which cards are expanded by id. Compact-by-default UX — tapping
  // a card or hitting Edit flips the expanded state. New items (_isNew)
  // auto-expand below so the user can fill them in right away.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Conditional filter chips (All / New / Used). Reduces clutter when a
  // shop carries mixed stock and the operator is hunting for a specific
  // condition (insurance jobs are often "new only", e.g.).
  const [condFilter, setCondFilter] = useState<CondFilter>('all');

  const isExpanded = (id: string, item: InventoryItem) => item._isNew || expanded.has(id);
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const update = (next: InventoryItem[]) => { setList(next); setDirty(true); };
  const add = () => {
    const newId = uid();
    update([
      { id: newId, size: '', qty: 0, cost: 0, condition: 'New', brand: '', model: '', notes: '', _isNew: true },
      ...list,
    ]);
    setExpanded((prev) => new Set(prev).add(newId));
  };

  /**
   * Hot-size quick-add (carry-forward from prior batch). Pre-fills size +
   * best-guess brand/cost from the last entry that used the same size,
   * leaving the operator to confirm qty and save. Auto-expands the new
   * card so it's immediately editable.
   */
  const addHotSize = (size: string) => {
    const lastWithSize = [...list].reverse().find((i) => i.size === size && (i.brand || '').trim());
    const lastWithSizeForCost = [...list].reverse().find((i) => i.size === size && i.cost > 0);
    const newId = uid();
    update([
      {
        id: newId,
        size,
        qty: 1,
        cost: lastWithSizeForCost?.cost ?? 0,
        condition: 'New',
        brand: lastWithSize?.brand || '',
        model: lastWithSize?.model || '',
        notes: '',
        _isNew: true,
      },
      ...list,
    ]);
    setExpanded((prev) => new Set(prev).add(newId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = (id: string) => update(list.filter((i) => i.id !== id));
  const change = <K extends keyof InventoryItem>(id: string, key: K, value: InventoryItem[K]) =>
    update(list.map((i) => (i.id === id ? { ...i, [key]: value } : i)));

  const save = () => {
    const cleaned = list.filter((i) => (i.size || '').trim()).map(sanitizeInvItem);
    onSave(cleaned);
    setList(cleaned);
    setDirty(false);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventory-template.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const rows = parseCsv(text);
      if (!rows.length) { addToast('No rows found in CSV', 'warn'); return; }
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
        notes: [r.vendor && `Vendor: ${r.vendor}`, r.sellingPrice ? `Sell: $${r.sellingPrice}` : '', r.notes].filter(Boolean).join(' · '),
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

  /**
   * Smart inventory search.
   *
   * Three-tier ranking by how well the query matches the size:
   *   1. Exact size match (operator typed full "225/35R18")
   *   2. Size prefix or substring match (typed "225", "225/35", "35R18")
   *   3. Brand or notes match (fallback so they still find tires by maker)
   *
   * Within each tier, original list order is preserved. Empty query =
   * unranked list. Brand/notes-only matches sort last so the tire-size
   * scanners aren't drowned out.
   *
   * The condition filter is applied BEFORE search so the search only
   * considers in-condition items.
   */
  const filtered = useMemo(() => {
    let base = list;
    if (condFilter !== 'all') {
      base = base.filter((i) => (i.condition || 'New') === condFilter);
    }
    // Always show new (unsaved) cards regardless of condition filter so
    // the operator doesn't lose track of a card they just added.
    if (condFilter !== 'all') {
      const newOnes = list.filter((i) => i._isNew);
      const seen = new Set(base.map((i) => i.id));
      for (const n of newOnes) if (!seen.has(n.id)) base = [n, ...base];
    }

    const q = search.trim().toLowerCase();
    if (!q) return base;

    type Ranked = { item: InventoryItem; tier: number; idx: number };
    const ranked: Ranked[] = [];
    base.forEach((i, idx) => {
      const size = (i.size || '').toLowerCase();
      const brand = (i.brand || '').toLowerCase();
      const notes = (i.notes || '').toLowerCase();
      let tier = -1;
      if (size === q) tier = 0;
      else if (size.includes(q)) tier = 1;
      else if (brand.includes(q) || notes.includes(q)) tier = 2;
      if (tier !== -1) ranked.push({ item: i, tier, idx });
    });
    ranked.sort((a, b) => a.tier - b.tier || a.idx - b.idx);
    return ranked.map((r) => r.item);
  }, [list, search, condFilter]);

  /**
   * Hot Sizes — most-stocked sizes, ranked by total qty. Renders as chip
   * strip for quick-add. Carry-forward from prior batch.
   */
  const hotSizes = useMemo(() => {
    const totals = new Map<string, number>();
    for (const i of list) {
      const s = (i.size || '').trim();
      if (!s) continue;
      totals.set(s, (totals.get(s) || 0) + Number(i.qty || 0));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([size]) => size);
  }, [list]);

  /**
   * Known brands for native autocomplete via <datalist>. Carry-forward.
   */
  const knownBrands = useMemo(() => {
    const set = new Set<string>();
    for (const i of list) {
      const b = (i.brand || '').trim();
      if (b) set.add(b);
    }
    return Array.from(set).sort();
  }, [list]);

  const totalQty = list.reduce((t, i) => t + Number(i.qty || 0), 0);
  const lowStock = list.filter((i) => Number(i.qty || 0) <= 1).length;

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Inventory</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn xs secondary" onClick={downloadTemplate}>⬇ Template</button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); if (fileInputRef.current) fileInputRef.current.value = ''; }} />
          <button className="btn xs secondary" onClick={() => fileInputRef.current?.click()}>⬆ Bulk Upload</button>
          {list.length > 0 && <button className="btn xs danger" onClick={() => setShowDeleteAll(true)}>Delete All</button>}
          <button className="btn xs primary" onClick={add}>＋ Add Tire</button>
        </div>
      </div>

      <div className="kpi-grid three">
        <div className="kpi"><div className="kpi-label">SKUs</div><div className="kpi-value">{list.length}</div></div>
        <div className="kpi"><div className="kpi-label">Total Qty</div><div className="kpi-value">{totalQty}</div></div>
        <div className="kpi"><div className="kpi-label">Low Stock</div><div className="kpi-value" style={{ color: lowStock > 0 ? 'var(--amber)' : undefined }}>{lowStock}</div></div>
      </div>

      <div className="field" style={{ marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search size (225, 225/35, 35R18), brand, notes…"
          autoComplete="off"
          inputMode="search"
        />
      </div>

      {/* Condition filter chips. Sticky-feel: applied before search so
          the operator can narrow first, then type. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'New', 'Used'] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={'chip sm' + (condFilter === c ? ' active' : '')}
            onClick={() => setCondFilter(c)}
          >
            {c === 'all' ? 'All' : c}
          </button>
        ))}
      </div>

      {/* Hot Sizes — quick-add chip strip for repeat-stock sizes. */}
      {hotSizes.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: 'var(--t3)',
            textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6,
          }}>
            🔥 Hot Sizes · tap to add
          </div>
          <div style={{
            display: 'flex', gap: 6, overflowX: 'auto',
            paddingBottom: 4, WebkitOverflowScrolling: 'touch',
            marginLeft: -2, marginRight: -2, paddingLeft: 2, paddingRight: 2,
          }}>
            {hotSizes.map((size) => (
              <button
                key={size}
                onClick={() => addHotSize(size)}
                className="chip"
                style={{
                  flexShrink: 0,
                  fontWeight: 700,
                  background: 'linear-gradient(160deg, rgba(200,164,74,.12) 0%, var(--s2) 80%)',
                  borderColor: 'rgba(200,164,74,.3)',
                  color: 'var(--brand-primary)',
                }}
              >
                + {size}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Native browser autocomplete source for Brand inputs below. */}
      <datalist id="known-brands">
        {knownBrands.map((b) => <option key={b} value={b} />)}
      </datalist>

      <div className="stack">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🛞</div>
            <div className="empty-state-title">No tires in inventory</div>
            <div className="empty-state-sub">
              {search.trim() ? 'No matches. Try a different search.' : 'Add tires individually or upload a CSV.'}
            </div>
          </div>
        ) : filtered.map((i) => {
          const open = isExpanded(i.id, i);
          const qty = Number(i.qty || 0);
          const cost = Number(i.cost || 0);
          const value = qty * cost;
          const low = qty > 0 && qty <= 1;
          const outOfStock = qty === 0;

          return (
            <div key={i.id} className="card card-anim" style={{ overflow: 'hidden' }}>
              {/* Compact header — always visible. Tap anywhere on the
                  header to toggle expansion. Quantity is the visual
                  anchor on the right; size is bold on the left. */}
              <button
                type="button"
                onClick={() => toggleExpanded(i.id)}
                aria-expanded={open}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--t1)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  minHeight: 64,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--t1)' }}>
                      {i.size || <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>(new tire)</span>}
                    </div>
                    {/* Inline badges: condition, low stock, out of stock. */}
                    {i.condition && i.condition !== 'New' && (
                      <span className="pill" style={{ fontSize: 9, padding: '2px 6px' }}>
                        {i.condition}
                      </span>
                    )}
                    {outOfStock && (
                      <span className="pill red" style={{ fontSize: 9, padding: '2px 6px' }}>
                        Out
                      </span>
                    )}
                    {low && (
                      <span className="pill amber" style={{ fontSize: 9, padding: '2px 6px' }}>
                        Low
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                    {(i.brand || 'No brand').trim() || 'No brand'}
                    {' · '}
                    {i.condition || 'New'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 56 }}>
                  <div style={{
                    fontSize: 22, fontWeight: 800,
                    color: outOfStock ? 'var(--red)' : low ? 'var(--amber)' : 'var(--t1)',
                    lineHeight: 1,
                  }}>
                    {qty}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    in stock
                  </div>
                </div>
                <div
                  aria-hidden
                  style={{
                    fontSize: 12,
                    color: 'var(--t3)',
                    transition: 'transform .2s ease',
                    transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                    marginLeft: 4,
                  }}
                >
                  ▸
                </div>
              </button>

              {/* Expanded edit form — same fields as before but now hidden
                  by default so the compact view stays scannable. */}
              {open && (
                <div className="card-pad" style={{ paddingTop: 4, borderTop: '1px solid var(--border2)' }}>
                  <div className="field-row" style={{ marginTop: 10 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Size</label>
                      <input value={i.size} onChange={(e) => change(i.id, 'size', e.target.value)} placeholder="225/65R17" />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Qty</label>
                      <NumberField
                        value={i.qty}
                        onChange={(n) => change(i.id, 'qty', n)}
                        decimals={false}
                        placeholder="0"
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Cost</label>
                      <NumberField
                        value={i.cost}
                        onChange={(n) => change(i.id, 'cost', n)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="field-row" style={{ marginTop: 10 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Condition</label>
                      <select value={i.condition || 'New'} onChange={(e) => change(i.id, 'condition', e.target.value)}>
                        <option>New</option><option>Used</option>
                      </select>
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Brand</label>
                      <input
                        value={i.brand || ''}
                        onChange={(e) => change(i.id, 'brand', e.target.value)}
                        placeholder="Michelin"
                        list="known-brands"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Notes</label>
                    <input value={i.notes || ''} onChange={(e) => change(i.id, 'notes', e.target.value)} placeholder="Optional notes" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Value: {money(value)}</div>
                    <button className="btn xs danger" onClick={() => remove(i.id)}>Remove</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dirty && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, background: 'linear-gradient(to top, var(--bg) 60%, transparent)' }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={save}>Save Inventory</button>
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
                <span>Size</span><span>Qty</span><span>Cost</span><span>Sell</span><span>Vendor</span>
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
              <button className="btn secondary" onClick={() => setBulkRows(null)}>Cancel</button>
              <button className="btn primary" onClick={applyBulk}>Add {bulkRows.filter((r) => !r._error).length} Tires</button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteAll ? (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteAll(false); setDeleteConfirm(''); } }}>
          <div className="modal">
            <div className="modal-title" style={{ color: 'var(--red)' }}>Delete entire inventory?</div>
            <div className="modal-sub">
              This permanently removes all {list.length} SKU{list.length === 1 ? '' : 's'} from your records
              and syncs the deletion to Firestore. This cannot be undone.
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Type <strong style={{ color: 'var(--red)' }}>DELETE</strong> to confirm</label>
              <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => { setShowDeleteAll(false); setDeleteConfirm(''); }}>Cancel</button>
              <button className="btn danger" onClick={confirmDeleteAll} disabled={deleteConfirm !== 'DELETE'}>Delete All</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
