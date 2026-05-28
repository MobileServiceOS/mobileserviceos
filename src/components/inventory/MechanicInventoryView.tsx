// src/components/inventory/MechanicInventoryView.tsx
// ═══════════════════════════════════════════════════════════════════
//  Mechanic-vertical inventory surface. Mobile-first: search,
//  category-grouped collapsible list, low-stock badge, full-screen
//  add/edit sheet. Reads/writes the canonical InventoryItem shape —
//  no shadow types, no parallel store.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import type { InventoryItem, Settings } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/registry';
import { uid } from '@/lib/utils';

interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  vertical: BusinessTypeConfig;
  settings: Settings;
}

export function MechanicInventoryView({ inventory, onSave, vertical, settings }: Props) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [supplierFilter, setSupplierFilter] = useState<string>('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InventoryItem | null>(null);

  const lowStockThreshold = Number(settings.lowStockThreshold ?? 2);

  const categoryOptions = useMemo(() => {
    const f = vertical.inventoryFields.find((x) => x.key === 'category');
    return f?.options ?? [];
  }, [vertical]);
  const conditionOptions = useMemo(() => {
    const f = vertical.inventoryFields.find((x) => x.key === 'condition');
    return f?.options ?? ['New', 'Used'];
  }, [vertical]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return inventory.filter((it) => {
      if (lowStockOnly && Number(it.qty || 0) > lowStockThreshold) return false;
      if (categoryFilter && it.category !== categoryFilter) return false;
      if (supplierFilter && it.supplier !== supplierFilter) return false;
      if (term) {
        const hay = [it.partName, it.partNumber, it.brand, it.supplier]
          .filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [inventory, search, categoryFilter, supplierFilter, lowStockOnly, lowStockThreshold]);

  const grouped = useMemo(() => {
    const buckets: Record<string, InventoryItem[]> = {};
    for (const it of filtered) {
      const key = it.category || 'Uncategorized';
      (buckets[key] = buckets[key] || []).push(it);
    }
    // Sort items within each bucket alphabetically by partName
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => String(a.partName || '').localeCompare(String(b.partName || '')));
    }
    return buckets;
  }, [filtered]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    for (const it of inventory) if (it.supplier) set.add(it.supplier);
    return Array.from(set).sort();
  }, [inventory]);

  const totalQty = useMemo(
    () => inventory.reduce((s, it) => s + Number(it.qty || 0), 0),
    [inventory],
  );
  const lowStockCount = useMemo(
    () => inventory.filter((it) => Number(it.qty || 0) <= lowStockThreshold).length,
    [inventory, lowStockThreshold],
  );

  const openNew = (): void => {
    setEditingId(null);
    setDraft({
      id: uid(),
      size: '',
      qty: 0,
      cost: 0,
      partName: '',
      partNumber: '',
      brand: '',
      supplier: '',
      category: '',
      subcategory: '',
      unitCost: 0,
      retailPrice: 0,
      condition: 'New',
      laborHoursDefault: undefined,
      warrantyDays: undefined,
      locationBin: '',
      compatibleVehicles: [],
      notes: '',
      _isNew: true,
    });
  };

  const openEdit = (it: InventoryItem): void => {
    setEditingId(it.id);
    setDraft({ ...it });
  };

  const close = (): void => {
    setEditingId(null);
    setDraft(null);
  };

  const persist = (): void => {
    if (!draft) return;
    // Mirror unitCost → cost so the existing tire-shape deduction
    // engine reads the cost basis without modification.
    const finalItem: InventoryItem = {
      ...draft,
      cost: Number(draft.unitCost ?? draft.cost ?? 0),
    };
    delete (finalItem as InventoryItem & { _isNew?: boolean })._isNew;
    const next = editingId
      ? inventory.map((i) => (i.id === editingId ? finalItem : i))
      : [...inventory, finalItem];
    onSave(next);
    close();
  };

  const remove = (): void => {
    if (!editingId) return;
    onSave(inventory.filter((i) => i.id !== editingId));
    close();
  };

  return (
    <div className="page page-enter">
      <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <h2 style={{ margin: 0 }}>{vertical.copy.inventoryLabel || 'Parts'}</h2>
        <button className="btn xs primary" onClick={openNew}>＋ Add Part</button>
      </div>

      <div className="kpi-grid three">
        <div className="kpi"><div className="kpi-label">SKUs</div><div className="kpi-value">{inventory.length}</div></div>
        <div className="kpi"><div className="kpi-label">Total Qty</div><div className="kpi-value">{totalQty}</div></div>
        <div className="kpi"><div className="kpi-label">Low Stock</div><div className="kpi-value" style={{ color: lowStockCount > 0 ? 'var(--amber)' : undefined }}>{lowStockCount}</div></div>
      </div>

      <input
        type="text"
        placeholder="🔍 Search part #, name, brand, supplier"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 10, fontSize: 16, marginBottom: 8, borderRadius: 8 }}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
          <option value="">All categories</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="chip sm" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} style={{ marginRight: 4 }} />
          Low stock only
        </label>
      </div>

      {Object.keys(grouped).length === 0 && (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--t3)' }}>
          {inventory.length === 0
            ? 'No parts yet — tap "＋ Add Part" to start your catalog.'
            : 'No parts match your filters.'}
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => {
        const isCollapsed = !!collapsed[cat];
        return (
          <div key={cat} style={{ marginBottom: 10 }}>
            <button
              onClick={() => setCollapsed((m) => ({ ...m, [cat]: !isCollapsed }))}
              className="btn sm secondary"
              style={{ width: '100%', textAlign: 'left', fontWeight: 700 }}
            >
              {isCollapsed ? '▸' : '▾'} {cat.toUpperCase()} ({items.length})
            </button>
            {!isCollapsed && (
              <div style={{ marginTop: 4 }}>
                {items.map((it) => {
                  const onHand = Number(it.qty || 0);
                  const isLow = onHand <= lowStockThreshold;
                  const retail = Number(it.retailPrice ?? 0);
                  const cost = Number(it.unitCost ?? it.cost ?? 0);
                  return (
                    <button
                      key={it.id}
                      onClick={() => openEdit(it)}
                      className="card card-pad card-anim"
                      style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontWeight: 600 }}>
                          {it.partName || '(unnamed)'}
                          {it.partNumber && <span style={{ color: 'var(--t3)', fontSize: 12, marginLeft: 6 }}>{it.partNumber}</span>}
                        </div>
                        {isLow && <span style={{ color: 'var(--amber)', fontSize: 12, fontWeight: 700 }}>⚠ LOW</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 2 }}>
                        qty {onHand} · ${retail.toFixed(2)} retail · ${cost.toFixed(2)} cost
                        {it.brand && <span style={{ color: 'var(--t3)', marginLeft: 6 }}>· {it.brand}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {draft && (
        <EditSheet
          draft={draft}
          setDraft={setDraft}
          categoryOptions={categoryOptions}
          conditionOptions={conditionOptions}
          markupDefault={Number(settings.partsMarkupDefault ?? 1.5)}
          onSave={persist}
          onCancel={close}
          onDelete={editingId ? remove : undefined}
        />
      )}
    </div>
  );
}

interface SheetProps {
  draft: InventoryItem;
  setDraft: (it: InventoryItem) => void;
  categoryOptions: ReadonlyArray<string>;
  conditionOptions: ReadonlyArray<string>;
  markupDefault: number;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function EditSheet({
  draft, setDraft, categoryOptions, conditionOptions, markupDefault,
  onSave, onCancel, onDelete,
}: SheetProps) {
  const num = (s: string): number | undefined => {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const update = (patch: Partial<InventoryItem>): void => setDraft({ ...draft, ...patch });

  const handleUnitCost = (raw: string): void => {
    const u = num(raw) ?? 0;
    const suggested = Math.round(u * markupDefault * 100) / 100;
    const retailEmpty = !Number(draft.retailPrice);
    update({ unitCost: u, retailPrice: retailEmpty ? suggested : draft.retailPrice });
  };

  const isValid =
    !!draft.partName &&
    !!draft.partNumber &&
    Number(draft.qty) >= 0 &&
    Number(draft.unitCost) >= 0 &&
    Number(draft.retailPrice) >= 0 &&
    !!draft.category;

  // Escape key dismisses the sheet (matches MoreSheet pattern).
  // Bluetooth-keyboard users + accessibility tools were trapped
  // here previously — only path out was the Cancel button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      // Backdrop click dismisses. Inner card stops propagation
      // (below) so tapping inside the form doesn't close.
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 100, display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1, overflowY: 'auto', padding: 16, margin: 0,
          borderRadius: 0,
        }}
      >
        <h3 style={{ marginTop: 0 }}>{draft._isNew ? 'Add part' : 'Edit part'}</h3>

        <Row label="Part name *"><input value={draft.partName || ''} onChange={(e) => update({ partName: e.target.value })} /></Row>
        <Row label="Part number *"><input value={draft.partNumber || ''} onChange={(e) => update({ partNumber: e.target.value })} /></Row>
        <Row label="Brand"><input value={draft.brand || ''} onChange={(e) => update({ brand: e.target.value })} /></Row>
        <Row label="Supplier"><input value={draft.supplier || ''} onChange={(e) => update({ supplier: e.target.value })} /></Row>
        <Row label="Category *">
          <select value={draft.category || ''} onChange={(e) => update({ category: e.target.value })}>
            <option value="">(select)</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row label="Subcategory"><input value={draft.subcategory || ''} onChange={(e) => update({ subcategory: e.target.value })} /></Row>
        <Row label="Quantity *"><input type="number" inputMode="numeric" value={draft.qty ?? 0} onChange={(e) => update({ qty: num(e.target.value) ?? 0 })} /></Row>
        <Row label="Unit cost ($) *"><input type="number" inputMode="decimal" value={draft.unitCost ?? 0} onChange={(e) => handleUnitCost(e.target.value)} /></Row>
        <Row label={`Retail price ($) * — markup ${markupDefault}× applied`}>
          <input type="number" inputMode="decimal" value={draft.retailPrice ?? 0} onChange={(e) => update({ retailPrice: num(e.target.value) ?? 0 })} />
        </Row>
        <Row label="Condition">
          <select value={draft.condition || 'New'} onChange={(e) => update({ condition: e.target.value })}>
            {conditionOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row label="Default labor hours"><input type="number" inputMode="decimal" value={draft.laborHoursDefault ?? ''} onChange={(e) => update({ laborHoursDefault: num(e.target.value) })} /></Row>
        <Row label="Warranty days"><input type="number" inputMode="numeric" value={draft.warrantyDays ?? ''} onChange={(e) => update({ warrantyDays: num(e.target.value) })} /></Row>
        <Row label="Location / bin"><input value={draft.locationBin || ''} onChange={(e) => update({ locationBin: e.target.value })} /></Row>
        <Row label="Compatible vehicles (comma-separated)">
          <input
            value={(draft.compatibleVehicles ?? []).join(', ')}
            onChange={(e) => update({
              compatibleVehicles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
            })}
          />
        </Row>
        <Row label="Notes"><textarea value={draft.notes || ''} onChange={(e) => update({ notes: e.target.value })} rows={3} /></Row>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 12, background: 'var(--s2)' }}>
        <button className="btn secondary" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
        {onDelete && <button className="btn danger" onClick={onDelete} style={{ flex: 1 }}>Delete</button>}
        <button className="btn primary" onClick={onSave} disabled={!isValid} style={{ flex: 2 }}>Save</button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
