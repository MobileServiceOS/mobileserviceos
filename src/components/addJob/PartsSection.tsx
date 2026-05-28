// src/components/addJob/PartsSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  Mechanic AddJob parts entry block. Mobile-first: tap "+ Add part",
//  autocomplete from inventory, default source = bought_for_job for
//  unbound typed names. Inventory-bound rows auto-fill unitPrice /
//  unitCost / source / inventoryItemId from the catalog item.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { JobPartLine, InventoryItem } from '@/types';

interface Props {
  parts: ReadonlyArray<JobPartLine>;
  inventory: ReadonlyArray<InventoryItem>;
  onChange: (next: ReadonlyArray<JobPartLine>) => void;
}

export function PartsSection({ parts, inventory, onChange }: Props) {
  const [adding, setAdding] = useState(false);

  const update = (idx: number, patch: Partial<JobPartLine>): void => {
    const next = parts.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onChange(next);
  };
  const remove = (idx: number): void => {
    onChange(parts.filter((_, i) => i !== idx));
  };
  const append = (line: JobPartLine): void => {
    onChange([...parts, line]);
    setAdding(false);
  };

  const partsTotal = parts.reduce(
    (s, p) => s + Number(p.qty || 0) * Number(p.unitPrice || 0),
    0,
  );

  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>
          Parts {parts.length > 0 ? `(${parts.length})` : ''}
        </strong>
        {partsTotal > 0 && <span style={{ color: 'var(--t2)', fontSize: 13 }}>${partsTotal.toFixed(2)}</span>}
      </div>

      {parts.map((p, i) => (
        <PartRow
          key={i}
          part={p}
          inventory={inventory}
          onUpdate={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}

      {adding ? (
        <PartRowNew inventory={inventory} onCommit={append} onCancel={() => setAdding(false)} />
      ) : (
        <button
          className="btn sm secondary"
          onClick={() => setAdding(true)}
          style={{ width: '100%', marginTop: 4 }}
        >
          ＋ Add part
        </button>
      )}
    </div>
  );
}

interface RowProps {
  part: JobPartLine;
  inventory: ReadonlyArray<InventoryItem>;
  onUpdate: (patch: Partial<JobPartLine>) => void;
  onRemove: () => void;
}

function PartRow({ part, onUpdate, onRemove }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card" style={{ padding: 8, marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={part.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={{ flex: 2, padding: 6 }}
        />
        <input
          type="number"
          inputMode="numeric"
          value={part.qty}
          onChange={(e) => onUpdate({ qty: Number(e.target.value) || 0 })}
          style={{ width: 50, padding: 6 }}
        />
        <input
          type="number"
          inputMode="decimal"
          value={part.unitPrice}
          onChange={(e) => onUpdate({ unitPrice: Number(e.target.value) || 0 })}
          style={{ width: 70, padding: 6 }}
          placeholder="$"
        />
        <button
          className="btn xs secondary"
          onClick={() => setExpanded((v) => !v)}
          aria-label="Edit details"
        >⋯</button>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            Source:{' '}
            <select
              value={part.source}
              onChange={(e) => {
                const next = e.target.value as JobPartLine['source'];
                onUpdate({
                  source: next,
                  inventoryItemId: next === 'inventory' ? part.inventoryItemId : undefined,
                });
              }}
            >
              <option value="inventory">From inventory</option>
              <option value="bought_for_job">Bought for this job</option>
              <option value="special_order">Special order</option>
            </select>
          </div>
          <div>
            Unit cost:{' '}
            <input
              type="number"
              inputMode="decimal"
              value={part.unitCost}
              onChange={(e) => onUpdate({ unitCost: Number(e.target.value) || 0 })}
              style={{ width: 80, padding: 4 }}
            />
          </div>
          {part.source !== 'inventory' && (
            <div>
              Supplier:{' '}
              <input
                value={part.supplier || ''}
                onChange={(e) => onUpdate({ supplier: e.target.value })}
                style={{ padding: 4 }}
              />
            </div>
          )}
          <div>
            Warranty days:{' '}
            <input
              type="number"
              inputMode="numeric"
              value={part.warrantyDays ?? ''}
              onChange={(e) => {
                const n = Number(e.target.value);
                onUpdate({ warrantyDays: Number.isFinite(n) && n > 0 ? n : undefined });
              }}
              style={{ width: 60, padding: 4 }}
            />
          </div>
          <button
            className="btn xs danger"
            onClick={onRemove}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
          >Remove</button>
        </div>
      )}
    </div>
  );
}

interface NewRowProps {
  inventory: ReadonlyArray<InventoryItem>;
  onCommit: (line: JobPartLine) => void;
  onCancel: () => void;
}

function PartRowNew({ inventory, onCommit, onCancel }: NewRowProps) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(0);

  const suggestions = useMemo(() => {
    const term = name.trim().toLowerCase();
    if (!term) return [];
    const matches = inventory.filter((i) => {
      const hay = [i.partName, i.partNumber, i.brand]
        .filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
      return hay.includes(term);
    });
    // In-stock first, then alphabetical by partName.
    matches.sort((a, b) => {
      const aOK = Number(a.qty || 0) > 0 ? 0 : 1;
      const bOK = Number(b.qty || 0) > 0 ? 0 : 1;
      if (aOK !== bOK) return aOK - bOK;
      return String(a.partName || '').localeCompare(String(b.partName || ''));
    });
    return matches.slice(0, 5);
  }, [name, inventory]);

  const pickSuggestion = (it: InventoryItem): void => {
    onCommit({
      name: it.partName || it.partNumber || '',
      qty,
      unitPrice: Number(it.retailPrice ?? 0),
      unitCost: Number(it.unitCost ?? it.cost ?? 0),
      source: 'inventory',
      inventoryItemId: it.id,
      warrantyDays: it.warrantyDays,
    });
  };

  const commitUnbound = (): void => {
    if (!name.trim()) { onCancel(); return; }
    onCommit({
      name: name.trim(),
      qty,
      unitPrice,
      unitCost: 0,
      source: 'bought_for_job',
    });
  };

  return (
    <div className="card" style={{ padding: 8, marginBottom: 4, borderColor: 'var(--brand-primary)' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          placeholder="Part name or #"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 2, padding: 6 }}
          autoFocus
        />
        <input
          type="number"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(Number(e.target.value) || 1)}
          style={{ width: 50, padding: 6 }}
        />
        <input
          type="number"
          inputMode="decimal"
          value={unitPrice}
          onChange={(e) => setUnitPrice(Number(e.target.value) || 0)}
          placeholder="$"
          style={{ width: 70, padding: 6 }}
        />
      </div>
      {suggestions.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {suggestions.map((it) => {
            const onHand = Number(it.qty || 0);
            return (
              <button
                key={it.id}
                className="btn xs secondary"
                onClick={() => pickSuggestion(it)}
                style={{ textAlign: 'left', fontSize: 12 }}
              >
                {it.partName || it.partNumber} —{' '}
                {onHand > 0 ? `qty ${onHand}` : '0, special order'}, ${Number(it.retailPrice ?? 0).toFixed(2)}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button className="btn sm secondary" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
        <button className="btn sm primary" onClick={commitUnbound} style={{ flex: 1 }}>✓ Add</button>
      </div>
    </div>
  );
}
