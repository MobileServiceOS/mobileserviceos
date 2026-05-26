import { useMemo, useRef, useState } from 'react';
import type { InventoryItem, Job, Settings } from '@/types';
import { money, normalizeTireSize, sanitizeInvItem, uid } from '@/lib/utils';
import {
  availableQty, reservedQty, addReservation, removeReservation,
} from '@/lib/inventoryReservations';
import { addToast } from '@/lib/toast';
import { NumberField } from '@/components/NumberField';
import { useActiveVertical } from '@/lib/useActiveVertical';
import type { BusinessTypeInventoryField, BusinessTypeConfig } from '@/config/businessTypes/registry';
import { MechanicInventoryView } from '@/components/inventory/MechanicInventoryView';
import { SMART_CHIPS, matchesSmartChip, type SmartChip } from '@/lib/inventoryFilters';
import { TODAY } from '@/lib/defaults';
import {
  HEALTH_BUCKETS, categorizeInventoryHealth, inventoryHealthCounts,
  type InventoryHealthBucket,
} from '@/lib/inventoryHealth';
import { useMembership } from '@/context/MembershipContext';
import { callAI, isAIConfigured } from '@/lib/aiClient';
import {
  buildInventoryInsightsInput, parseInventoryInsightsResponse,
} from '@/lib/aiInventoryInsights';

interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  settings: Settings;
  jobs: Job[];
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

// Dispatcher: picks which inventory view renders based on the active
// business type. This is the only thing exported as `Inventory`.
//
// Tire (vertical.features.inventoryDeduction === true) renders the
// bespoke compact-card UI with hot sizes, CSV upload, condition
// chips, and the inventory-deduction interlock — byte-identical to
// pre-Phase-2.1.
//
// Mechanic + detailing render GenericInventoryView, which reads
// vertical.inventoryFields and produces a generic dynamic-field
// editor over the same InventoryItem shape (now widened with
// optional partNumber/partName/supplier/unitCost/chemicalName/
// category/dilutionRatio fields).
export function Inventory({ inventory, onSave, settings, jobs }: Props) {
  const vertical = useActiveVertical();
  if (vertical.key === 'mechanic') {
    return (
      <MechanicInventoryView
        inventory={inventory}
        onSave={onSave}
        vertical={vertical}
        settings={settings}
      />
    );
  }
  if (!vertical.features.inventoryDeduction) {
    return <GenericInventoryView inventory={inventory} onSave={onSave} vertical={vertical} />;
  }
  return <TireInventoryView inventory={inventory} onSave={onSave} jobs={jobs} />;
}

// Inline form to add a new reservation against an InventoryItem.
// Disabled when qty input is invalid or exceeds availableQty(item).
function ReservationAdder({
  item,
  onAdd,
}: {
  item: InventoryItem;
  onAdd: (qty: number, label: string) => void;
}) {
  const [qty, setQty] = useState<number | ''>(1);
  const [label, setLabel] = useState('');
  const avail = availableQty(item);
  const n = typeof qty === 'number' ? qty : 0;
  const disabled = n <= 0 || n > avail;
  return (
    <div className="inv-reservation-add">
      <input
        className="qty-input"
        type="number"
        inputMode="numeric"
        min={1}
        max={avail}
        value={qty}
        onChange={(e) => {
          const v = e.target.value;
          setQty(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0));
        }}
      />
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. 5 PM Smith job)"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onAdd(n, label);
          setQty(1);
          setLabel('');
        }}
      >
        Reserve
      </button>
    </div>
  );
}

// ─── Tire-bespoke view (pre-Phase-2.1 component, renamed) ──────────
interface InternalViewProps {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  jobs: Job[];
}

function TireInventoryView({ inventory, onSave, jobs }: InternalViewProps) {
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

  // Phase 2 — health bucket filter. Single-select: either 'all' or
  // one of the four health buckets. Counts are computed once per
  // render via the memo below.
  const [healthFilter, setHealthFilter] = useState<'all' | InventoryHealthBucket>('all');
  const today = TODAY();
  const healthCounts = useMemo(
    () => inventoryHealthCounts(list, jobs, today),
    [list, jobs, today],
  );
  const healthByItem = useMemo(() => {
    const m = new Map<string, InventoryHealthBucket>();
    for (const i of list) m.set(i.id, categorizeInventoryHealth(i, jobs, today));
    return m;
  }, [list, jobs, today]);

  // Phase 4 — Inventory AI insight (owner/admin only).
  const membership = useMembership();
  const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
  const aiAvailable = isOwnerOrAdmin && isAIConfigured() && list.length > 0;
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiBullets, setAiBullets] = useState<string[]>([]);

  const handleAiInsight = async (): Promise<void> => {
    if (!aiAvailable) return;
    setAiStatus('loading');
    setAiBullets([]);
    const digest = buildInventoryInsightsInput(list, jobs, today);
    const res = await callAI('inventory_insights', digest);
    if (!res.ok || !res.text) { setAiStatus('error'); return; }
    const parsed = parseInventoryInsightsResponse(res.text, digest);
    if (!parsed.ok) { setAiStatus('error'); return; }
    setAiBullets(parsed.bullets);
    setAiStatus('done');
  };

  // Phase 1 smart filters — multi-select chip set. Each active chip
  // intersects with the others (item must match every active chip).
  const [activeChips, setActiveChips] = useState<ReadonlySet<SmartChip>>(new Set());
  const toggleChip = (c: SmartChip): void => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

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
    // Dedup against existing inventory: if an incoming row matches
    // an existing item by normalized-size + condition, ADD its qty to
    // the existing item instead of creating a parallel card. Without
    // this, re-importing the same CSV doubles every line. Match key
    // intentionally ignores cost/notes — a price update on the same
    // SKU should merge, not split.
    const keyOf = (size: string, condition: string) =>
      normalizeTireSize(size) + '|' + (condition || 'New');
    const existingByKey = new Map<string, number>();
    list.forEach((i, idx) => {
      existingByKey.set(keyOf(i.size, i.condition || 'New'), idx);
    });
    const merged = list.map((i) => ({ ...i }));
    let mergedCount = 0;
    const newRows: InventoryItem[] = [];
    for (const r of ok) {
      const k = keyOf(r.tireSize, r.condition);
      const existingIdx = existingByKey.get(k);
      if (existingIdx != null) {
        merged[existingIdx] = {
          ...merged[existingIdx],
          qty: Number(merged[existingIdx].qty || 0) + Number(r.quantity || 0),
        };
        mergedCount++;
      } else {
        const fresh: InventoryItem = {
          id: uid(),
          size: r.tireSize,
          qty: r.quantity,
          cost: r.cost,
          condition: r.condition,
          brand: '',
          model: '',
          notes: [r.vendor && `Vendor: ${r.vendor}`, r.sellingPrice ? `Sell: $${r.sellingPrice}` : '', r.notes].filter(Boolean).join(' · '),
        };
        newRows.push(fresh);
        existingByKey.set(k, merged.length + newRows.length - 1);
      }
    }
    const next: InventoryItem[] = [...newRows, ...merged];
    update(next);
    setBulkRows(null);
    const addedMsg = newRows.length ? `Added ${newRows.length} new` : '';
    const mergedMsg = mergedCount ? `merged ${mergedCount} into existing` : '';
    const parts = [addedMsg, mergedMsg].filter(Boolean).join(', ');
    addToast(parts || 'No changes', 'success');
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
    if (healthFilter !== 'all') {
      base = base.filter((i) => healthByItem.get(i.id) === healthFilter);
    }
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

    if (activeChips.size) {
      const chips = Array.from(activeChips);
      base = base.filter((i) =>
        chips.every((c) => matchesSmartChip(i, c)),
      );
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
  }, [list, search, condFilter, activeChips, healthFilter, healthByItem]);

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

      {aiAvailable && (
        <div className="inv-ai-insight">
          <button
            type="button"
            className="inv-ai-insight-btn press-scale"
            onClick={handleAiInsight}
            disabled={aiStatus === 'loading'}
          >
            {aiStatus === 'loading' ? 'Thinking…' : '✨ AI inventory insight'}
          </button>
          {aiStatus === 'done' && aiBullets.length > 0 && (
            <div className="ai-summary-card card-anim" style={{ marginTop: 8 }}>
              <div className="ai-summary-label">AI inventory insight</div>
              <ul className="ai-summary-list">
                {aiBullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          {aiStatus === 'error' && (
            <div className="ai-summary-error">Couldn't generate insight — try again.</div>
          )}
        </div>
      )}

      {/* Phase 2 — inventory health buckets. Single-select; counts
          render in parens and dim when 0. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={'chip sm' + (healthFilter === 'all' ? ' active' : '')}
          onClick={() => setHealthFilter('all')}
        >
          All
        </button>
        {HEALTH_BUCKETS.map((b) => {
          const n = healthCounts[b];
          const label = b.charAt(0).toUpperCase() + b.slice(1);
          return (
            <button
              key={b}
              type="button"
              className={'chip sm' + (healthFilter === b ? ' active' : '')}
              onClick={() => setHealthFilter(b)}
              style={n === 0 ? { opacity: .55 } : undefined}
            >
              {label} ({n})
            </button>
          );
        })}
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

      {/* Smart filter chips — multi-select. Intersect with the
          condition filter and the search query. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {SMART_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className={'chip sm' + (activeChips.has(c) ? ' active' : '')}
            onClick={() => toggleChip(c)}
          >
            {c}
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
          // Per-item reorderPoint with global default of 1 — preserves
          // current behavior for legacy items while letting an operator
          // set "warn me when this SKU drops to 4 or fewer" for hot
          // sellers.
          const threshold = Number(i.reorderPoint ?? 1);
          const low = qty > 0 && qty <= threshold;
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
                  padding: '10px 12px',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Tire size — primary scan key, bumped from 19 → 22 px. */}
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', lineHeight: 1.1, letterSpacing: '-.2px' }}>
                      {i.size || <span style={{ color: 'var(--t3)', fontStyle: 'italic', fontSize: 15 }}>(new tire)</span>}
                    </div>
                    {/* Low / Out status badges still render alongside size.
                        The "Used" condition is now in the sub-line below
                        instead of as a duplicate pill here. */}
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
                  {/* Merged sub-line: brand · condition. Always renders so
                      the absence of brand is visible at scan time. */}
                  <div className="inv-card-sub">
                    {(() => {
                      const brand = (i.brand || '').trim() || 'No brand';
                      const cond = i.condition === 'Used' ? 'Used' : '';
                      return cond ? `${brand} · ${cond}` : brand;
                    })()}
                  </div>
                  {reservedQty(i) > 0 && (
                    <div className="inv-reserve-line">
                      🔒 {reservedQty(i)} reserved · {availableQty(i)} available
                    </div>
                  )}
                </div>
                {/* Inline qty ± cluster — adjusts qty without expanding
                    the card. stopPropagation prevents the surrounding
                    button's onClick (toggleExpanded) from firing. */}
                <div className="inv-qty-cluster" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="inv-qty-btn"
                    aria-label="Increase quantity"
                    onClick={(e) => { e.stopPropagation(); change(i.id, 'qty', qty + 1); }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="inv-qty-btn"
                    aria-label="Decrease quantity"
                    disabled={qty <= 0}
                    onClick={(e) => { e.stopPropagation(); if (qty > 0) change(i.id, 'qty', qty - 1); }}
                  >
                    −
                  </button>
                </div>
                <div style={{ textAlign: 'right', minWidth: 56 }}>
                  <div style={{
                    fontSize: 28, fontWeight: 800,
                    color: outOfStock ? 'var(--red)' : low ? 'var(--amber)' : 'var(--t1)',
                    lineHeight: 1,
                  }}>
                    {qty}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                  <div className="inv-reservations">
                    <div className="inv-reservations-title">Reservations</div>
                    {(i.reservations || []).map((r) => (
                      <div key={r.id} className="inv-reservation-row">
                        <span className="label">{r.label || '—'}</span>
                        <span className="qty">×{r.qty}</span>
                        <button
                          type="button"
                          className="release"
                          onClick={() => {
                            const nextItem = removeReservation(i, r.id);
                            update(list.map((x) => (x.id === i.id ? nextItem : x)));
                          }}
                        >
                          Release
                        </button>
                      </div>
                    ))}
                    <ReservationAdder
                      item={i}
                      onAdd={(qty, label) => {
                        const nextItem = addReservation(i, qty, label);
                        update(list.map((x) => (x.id === i.id ? nextItem : x)));
                      }}
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Source <span style={{ color: 'var(--t3)', fontWeight: 400, fontSize: 11 }}>(optional)</span></label>
                    <input
                      value={i.purchaseSource || ''}
                      onChange={(e) => change(i.id, 'purchaseSource', e.target.value)}
                      placeholder="Tire Hut · Marketplace · Wholesale…"
                    />
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

// ═══════════════════════════════════════════════════════════════════
//  GenericInventoryView — config-driven editor for non-tire verticals
//  ────────────────────────────────────────────────────────────────────
//  Reads vertical.inventoryFields to render dynamic columns + form
//  inputs. Same InventoryItem data shape; widened type from
//  src/types/index.ts holds the vertical-specific fields.
//
//  What it shares with the tire view:
//    - id-based list, add/remove/edit, dirty-state Save button
//    - SKUs / Total Qty / Low Stock KPI grid (universal counts)
//    - search box (matches any string field)
//    - expandable card UI for editing
//
//  What's different vs tire:
//    - No "Hot Sizes" strip (tire-only quick-add concept)
//    - No CSV bulk upload (tire-specific template; mechanic /
//      detailing CSV format is Phase 2.2 / 2.3 polish)
//    - No condition filter chips (tire-only categorical)
//    - Fields come from vertical.inventoryFields rather than the
//      hardcoded Size/Brand/Condition/Notes block
//    - Empty-state copy + "Add" button label use vertical.copy.
// ═══════════════════════════════════════════════════════════════════
function GenericInventoryView({
  inventory, onSave, vertical,
}: {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  vertical: BusinessTypeConfig;
}) {
  const safe: InventoryItem[] = Array.isArray(inventory) ? inventory : [];
  const [list, setList] = useState<InventoryItem[]>(safe);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fields: ReadonlyArray<BusinessTypeInventoryField> = vertical.inventoryFields;
  // The first field in vertical.inventoryFields acts as the primary
  // descriptor for empty/list rendering (e.g. "Part Number" for
  // mechanic, "Item Name" for detailing). The "qty" field is the
  // universal stock counter (every vertical has one — tire has it
  // via the bespoke view, here we surface it explicitly).
  const primaryField = fields[0];

  const update = (next: InventoryItem[]) => { setList(next); setDirty(true); };
  const addItem = () => {
    const newId = uid();
    update([
      { id: newId, size: '', qty: 0, cost: 0, _isNew: true },
      ...list,
    ]);
    setExpanded((prev) => new Set(prev).add(newId));
  };
  const removeItem = (id: string) => update(list.filter((i) => i.id !== id));
  const change = <K extends keyof InventoryItem>(
    id: string, key: K, value: InventoryItem[K],
  ) => update(list.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
  const save = () => {
    // Generic items still pass through sanitizeInvItem — it trims
    // size/qty/cost defensively, which is harmless for items whose
    // primary field is partName/chemicalName/etc.
    const cleaned = list.map(sanitizeInvItem);
    onSave(cleaned);
    setList(cleaned);
    setDirty(false);
  };
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Search matches any string field on the item (case-insensitive).
  // Generic fallback — tire's tiered ranking is tire-specific and not
  // re-implemented for the generic view.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((i) => {
      const bag = i as unknown as Record<string, unknown>;
      for (const f of fields) {
        const v = bag[f.key];
        if (typeof v === 'string' && v.toLowerCase().includes(q)) return true;
      }
      if (typeof i.notes === 'string' && i.notes.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [list, search, fields]);

  const totalQty = list.reduce((t, i) => t + Number(i.qty || 0), 0);
  const lowStock = list.filter((i) => Number(i.qty || 0) <= 1).length;

  // Read the primary descriptor for a row (e.g. "Battery 12V Group 24"
  // for a mechanic part, "Wheel Cleaner" for a detailing chemical).
  const primaryDescriptor = (i: InventoryItem): string => {
    if (!primaryField) return '';
    const v = (i as unknown as Record<string, unknown>)[primaryField.key];
    return typeof v === 'string' ? v : '';
  };

  return (
    <div className="page page-enter">
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14, gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{vertical.copy.inventoryLabel}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn xs primary" onClick={addItem}>＋ Add Item</button>
        </div>
      </div>

      <div className="kpi-grid three">
        <div className="kpi"><div className="kpi-label">SKUs</div><div className="kpi-value">{list.length}</div></div>
        <div className="kpi"><div className="kpi-label">Total Qty</div><div className="kpi-value">{totalQty}</div></div>
        <div className="kpi">
          <div className="kpi-label">Low Stock</div>
          <div className="kpi-value" style={{ color: lowStock > 0 ? 'var(--amber)' : undefined }}>{lowStock}</div>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${vertical.copy.inventoryLabel.toLowerCase()}…`}
          autoComplete="off"
          inputMode="search"
        />
      </div>

      <div className="stack">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-title">No items yet</div>
            <div className="empty-state-sub">
              {search.trim()
                ? 'No matches. Try a different search.'
                : `Tap "Add Item" to start tracking ${vertical.copy.inventoryLabel.toLowerCase()}.`}
            </div>
          </div>
        ) : filtered.map((i) => {
          const open = i._isNew || expanded.has(i.id);
          const qty = Number(i.qty || 0);
          const cost = Number((i.unitCost ?? i.cost) || 0);
          const value = qty * cost;
          // Per-item reorderPoint w/ global default of 1.
          const threshold = Number(i.reorderPoint ?? 1);
          const low = qty > 0 && qty <= threshold;
          const outOfStock = qty === 0;
          const desc = primaryDescriptor(i);

          return (
            <div key={i.id} className="card card-anim" style={{ overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => toggleExpanded(i.id)}
                aria-expanded={open}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', width: '100%',
                  background: 'transparent', border: 'none',
                  color: 'var(--t1)', textAlign: 'left', cursor: 'pointer',
                  minHeight: 64,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--t1)' }}>
                      {desc || <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>(new item)</span>}
                    </div>
                    {outOfStock && (
                      <span className="pill red" style={{ fontSize: 9, padding: '2px 6px' }}>Out</span>
                    )}
                    {low && (
                      <span className="pill amber" style={{ fontSize: 9, padding: '2px 6px' }}>Low</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 56 }}>
                  <div style={{
                    fontSize: 22, fontWeight: 800,
                    color: outOfStock ? 'var(--red)' : low ? 'var(--amber)' : 'var(--t1)',
                    lineHeight: 1,
                  }}>{qty}</div>
                  <div style={{
                    fontSize: 9, color: 'var(--t3)', marginTop: 2,
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>in stock</div>
                </div>
                <div aria-hidden style={{
                  fontSize: 12, color: 'var(--t3)',
                  transition: 'transform .2s ease',
                  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                  marginLeft: 4,
                }}>▸</div>
              </button>

              {open && (
                <div className="card-pad" style={{ paddingTop: 4, borderTop: '1px solid var(--border2)' }}>
                  {/* Universal Qty (the stock counter every vertical
                      needs; the deduction engine reads `qty` directly). */}
                  <div className="field-row" style={{ marginTop: 10 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Quantity</label>
                      <NumberField value={i.qty} onChange={(n) => change(i.id, 'qty', n)} decimals={false} placeholder="0" />
                    </div>
                  </div>

                  {/* Dynamic vertical-specific fields. */}
                  {fields.map((f) => {
                    const v = (i as unknown as Record<string, unknown>)[f.key];
                    if (f.type === 'number') {
                      return (
                        <div key={f.key} className="field" style={{ marginTop: 10 }}>
                          <label>{f.label}</label>
                          <NumberField
                            value={(v as number | string | undefined) ?? 0}
                            onChange={(n) => change(i.id, f.key as keyof InventoryItem, n as InventoryItem[keyof InventoryItem])}
                            placeholder="0"
                          />
                        </div>
                      );
                    }
                    if (f.type === 'select') {
                      return (
                        <div key={f.key} className="field" style={{ marginTop: 10 }}>
                          <label>{f.label}</label>
                          <select
                            value={typeof v === 'string' ? v : ''}
                            onChange={(e) => change(i.id, f.key as keyof InventoryItem, e.target.value as InventoryItem[keyof InventoryItem])}
                          >
                            <option value="">—</option>
                            {(f.options || []).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    return (
                      <div key={f.key} className="field" style={{ marginTop: 10 }}>
                        <label>{f.label}</label>
                        <input
                          value={typeof v === 'string' ? v : ''}
                          onChange={(e) => change(i.id, f.key as keyof InventoryItem, e.target.value as InventoryItem[keyof InventoryItem])}
                          placeholder={f.label}
                        />
                      </div>
                    );
                  })}

                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Notes</label>
                    <input
                      value={i.notes || ''}
                      onChange={(e) => change(i.id, 'notes', e.target.value)}
                      placeholder="Optional notes"
                    />
                  </div>

                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 10,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Value: {money(value)}</div>
                    <button className="btn xs danger" onClick={() => removeItem(i.id)}>Remove</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dirty && (
        <div style={{
          position: 'sticky', bottom: 0, paddingTop: 12,
          background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
        }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={save}>
            Save Inventory
          </button>
        </div>
      )}
    </div>
  );
}
