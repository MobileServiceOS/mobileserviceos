import { useState } from 'react';
import type { Expense } from '@/types';
import { money, uid } from '@/lib/utils';
import { addToast } from '@/lib/toast';

interface Props {
  expenses: Expense[];
  onSave: (next: Expense[]) => void;
}

export function Expenses({ expenses, onSave }: Props) {
  const safe: Expense[] = Array.isArray(expenses) ? expenses : [];
  const [list, setList] = useState<Expense[]>(safe);
  const [dirty, setDirty] = useState(false);

  const update = (next: Expense[]) => {
    setList(next);
    setDirty(true);
  };

  const add = () => update([...list, { id: uid(), name: '', amount: 0, active: true }]);
  const remove = (id: string) => update(list.filter((e) => e.id !== id));
  const change = <K extends keyof Expense>(id: string, key: K, value: Expense[K]) =>
    update(list.map((e) => (e.id === id ? { ...e, [key]: value } : e)));

  const save = () => {
    const cleaned = list.filter((e) => (e.name || '').trim());
    onSave(cleaned);
    setList(cleaned);
    setDirty(false);
    addToast('Expenses saved', 'success');
  };

  const activeTotal = list.filter((e) => e.active).reduce((t, e) => t + Number(e.amount || 0), 0);

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Monthly Expenses</div>
        <button className="btn xs primary" onClick={add}>
          ＋ Add
        </button>
      </div>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Active</div>
          <div className="kpi-value">{list.filter((e) => e.active).length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Monthly Total</div>
          <div className="kpi-value">{money(activeTotal)}</div>
        </div>
      </div>
      {list.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📊</div>
          <div className="empty-title">No recurring expenses</div>
          <div className="empty-sub">Track insurance, software subs, fuel allowance, etc.</div>
        </div>
      )}
      {list.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {list.map((e) => (
            <div key={e.id} className="expense-row">
              <input value={e.name} onChange={(ev) => change(e.id, 'name', ev.target.value)} placeholder="Expense name" />
              <input
                type="number"
                inputMode="decimal"
                value={e.amount}
                onChange={(ev) => change(e.id, 'amount', Number(ev.target.value))}
                placeholder="0"
              />
              <button
                className={'btn xs ' + (e.active ? 'success' : 'secondary')}
                onClick={() => change(e.id, 'active', !e.active)}
              >
                {e.active ? 'On' : 'Off'}
              </button>
              <button className="btn xs danger" onClick={() => remove(e.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {dirty && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12 }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={save}>
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
