import { useMemo, useState } from 'react';
import type { InventoryItem } from '@/types';
import { money, sanitizeInvItem, uid } from '@/lib/utils';
import { addToast } from '@/lib/toast';

interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
}

export function Inventory({ inventory, onSave }: Props) {
  const safe: InventoryItem[] = Array.isArray(inventory) ? inventory : [];
  const [list, setList] = useState<InventoryItem[]>(safe);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);

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

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Inventory</div>
        <button className="btn xs primary" onClick={add}>
          ＋ Add Tire
        </button>
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
    </div>
  );
}
