import { useState } from 'react';
import type { Expense } from '@/types';
import { money, uid } from '@/lib/utils';

interface Props {
  expenses: Expense[];
  onSave: (next: Expense[]) => void;
}

export function Expenses({ expenses, onSave }: Props) {
  const safe = Array.isArray(expenses) ? expenses : [];
  const [list, setList] = useState<Expense[]>(safe);
  const [dirty, setDirty] = useState(false);

  const update = (next: Expense[]) => { setList(next); setDirty(true); };
  const add = () => update([{ id: uid(), name: '', amount: 0, active: true }, ...list]);
  const remove = (id: string) => update(list.filter((e) => e.id !== id));
  const change = <K extends keyof Expense>(id: string, k: K, v: Expense[K]) =>
    update(list.map((e) => e.id === id ? { ...e, [k]: v } : e));

  const activeTotal = list.filter((e) => e.active).reduce((t, e) => t + Number(e.amount || 0), 0);

  const save = () => {
    const cleaned = list.filter((e) => (e.name || '').trim() || Number(e.amount || 0) > 0);
    onSave(cleaned);
    setDirty(false);
  };

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Recurring Expenses</div>
        <button className="btn xs primary" onClick={add}>＋ Add</button>
      </div>

      <div className="kpi-grid three">
        <div className="kpi"><div className="kpi-label">Active</div><div className="kpi-value">{list.filter((e) => e.active).length}</div></div>
        <div className="kpi"><div className="kpi-label">Monthly</div><div className="kpi-value">{money(activeTotal)}</div></div>
        <div className="kpi"><div className="kpi-label">Yearly</div><div className="kpi-value">{money(activeTotal * 12)}</div></div>
      </div>

      <div className="stack">
        {list.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💸</div>
            <div className="empty-state-title">No recurring expenses</div>
            <div className="empty-state-sub">Add rent, insurance, subscriptions, etc.</div>
          </div>
        ) : (
          list.map((e) => (
            <div key={e.id} className="card card-anim">
              <div className="card-pad">
                <div className="field-row">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Name</label>
                    <input value={e.name} onChange={(ev) => change(e.id, 'name', ev.target.value)} placeholder="Insurance" />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Monthly $</label>
                    <input type="number" inputMode="decimal" value={e.amount} onChange={(ev) => change(e.id, 'amount', Number(ev.target.value))} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <input type="checkbox" checked={e.active} onChange={(ev) => change(e.id, 'active', ev.target.checked)} />
                    Active
                  </label>
                  <button className="btn xs danger" onClick={() => remove(e.id)}>Remove</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {dirty && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, background: 'linear-gradient(to top, var(--bg) 60%, transparent)' }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={save}>Save Expenses</button>
        </div>
      )}
    </div>
  );
}
