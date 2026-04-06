// src/pages/Expenses.jsx
import { useState, useEffect, useMemo } from 'react';
import { useBusiness } from '../business/BusinessContext.jsx';
import { listenExpenses, addExpense, deleteExpense } from '../services/businessService.js';
import { getWeekStart, today, cur, formatDateLong } from '../utils/index.js';
import { Screen, Card, EmptyState, SectionLabel, FormField } from '../components/index.jsx';
import { getModelConfig } from '../features/businessModel/modelConfigs.js';
import { COLORS, RADIUS } from '../config/theme.js';

const ICONS = {
  'Fuel':'⛽','Oil Change':'🛢️','Tires (Stock)':'🛞','Parts & Hardware':'🔩',
  'Tools & Equipment':'🔧','Vehicle Maintenance':'🚗','Van Repair':'🛠️',
  'Plugs & Patches':'🪝','Valve Stems':'🔩','Tire Disposal Fee':'♻️',
  'Phone Bill':'📱','Marketing':'📣','Storage':'🏭','Insurance':'🛡️',
  'Supplies':'📦','Safety Equipment':'🦺','Food & Drinks':'☕',
  'Parking':'🅿️','Tolls':'🛣️','Subscriptions':'💻','Other':'📝',
};

export function Expenses() {
  const { bizId, modelType, payoutConfig, brandColor } = useBusiness();
  const color    = brandColor || COLORS.primary;
  const cfg      = getModelConfig(modelType);
  const cats     = cfg.defaultExpenseCategories || [];
  const weekDay  = payoutConfig?.weekStartDay ?? 5;

  const [expenses, setExpenses] = useState([]);
  const [showAdd,  setShowAdd]  = useState(false);
  const [filter,   setFilter]   = useState('All');
  const [form, setForm]         = useState({ date: today(), category: cats[0]||'Fuel', description:'', amount:'' });

  useEffect(() => {
    if (!bizId) return;
    return listenExpenses(bizId, setExpenses);
  }, [bizId]);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleAdd = async () => {
    if (!form.amount || isNaN(parseFloat(form.amount))) return;
    await addExpense(bizId, {
      date:        form.date,
      category:    form.category,
      description: form.description.trim(),
      amount:      parseFloat(form.amount),
      weekKey:     getWeekStart(form.date, weekDay),
    });
    setForm({ date: today(), category: cats[0]||'Fuel', description:'', amount:'' });
    setShowAdd(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await deleteExpense(bizId, id);
  };

  const filtered = useMemo(() =>
    filter === 'All' ? expenses : expenses.filter(e => e.category === filter)
  , [expenses, filter]);

  const totalAll   = expenses.reduce((s,e)=>s+e.amount,0);
  const totalMonth = expenses.filter(e=>e.date?.startsWith(new Date().toISOString().slice(0,7))).reduce((s,e)=>s+e.amount,0);
  const totalWeek  = expenses.filter(e=>getWeekStart(e.date,weekDay)===getWeekStart(today(),weekDay)).reduce((s,e)=>s+e.amount,0);

  const byCat = useMemo(()=>{
    const m={};
    expenses.forEach(e=>{m[e.category]=(m[e.category]||0)+e.amount;});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[expenses]);

  const inp = { width:'100%', padding:'13px 14px', fontSize:15, border:`1.5px solid ${COLORS.border}`, borderRadius:RADIUS.md, background:'#fff', outline:'none', fontFamily:'inherit' };

  return (
    <Screen title="Expenses" action={
      <button onClick={()=>setShowAdd(!showAdd)} style={{background:showAdd?COLORS.bg:color,color:showAdd?'#111':'#fff',border:`1.5px solid ${showAdd?COLORS.border:'transparent'}`,borderRadius:RADIUS.md,padding:'8px 16px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
        {showAdd?'✕ Cancel':'+ Add'}
      </button>
    }>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:16}}>
        {[['Week',totalWeek,COLORS.error],['Month',totalMonth,COLORS.warning],['All',totalAll,'#111']].map(([l,v,c])=>(
          <div key={l} style={{background:'#fff',borderRadius:RADIUS.lg,padding:'12px 10px',textAlign:'center',border:`1px solid ${COLORS.border}`}}>
            <div style={{fontSize:9,color:COLORS.muted,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>{l}</div>
            <div style={{fontFamily:'monospace',fontSize:15,fontWeight:700,color:c}}>{cur(v)}</div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <Card style={{padding:16,marginBottom:16}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <FormField label="Date"><input type="date" value={form.date} onChange={e=>set('date',e.target.value)} style={inp}/></FormField>
            <FormField label="Amount ($)"><input type="number" min="0" step="0.01" value={form.amount} onChange={e=>set('amount',e.target.value)} style={{...inp,fontFamily:'monospace'}} placeholder="0.00"/></FormField>
          </div>
          <FormField label="Category">
            <select value={form.category} onChange={e=>set('category',e.target.value)} style={{...inp,appearance:'none'}}>
              {cats.map(c=><option key={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Description (optional)">
            <input value={form.description} onChange={e=>set('description',e.target.value)} style={inp} placeholder="e.g. BP gas station"/>
          </FormField>
          <button onClick={handleAdd} style={{width:'100%',background:color,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'14px',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            Save Expense
          </button>
        </Card>
      )}

      {/* Category breakdown */}
      {byCat.length > 0 && (
        <>
          <SectionLabel>By Category</SectionLabel>
          <Card style={{marginBottom:16,overflow:'hidden'}}>
            {byCat.map(([cat,total],i)=>(
              <div key={cat} onClick={()=>setFilter(filter===cat?'All':cat)}
                style={{display:'flex',alignItems:'center',padding:'10px 14px',borderBottom:i<byCat.length-1?`1px solid ${COLORS.border}`:'none',cursor:'pointer',background:filter===cat?COLORS.bg:'#fff'}}>
                <div style={{width:34,height:34,background:COLORS.bg,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0,marginRight:12}}>{ICONS[cat]||'📝'}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>{cat}</div>
                  <div style={{fontSize:10,color:COLORS.muted}}>{expenses.filter(e=>e.category===cat).length} expense{expenses.filter(e=>e.category===cat).length!==1?'s':''}</div>
                </div>
                <div style={{fontFamily:'monospace',fontSize:13,fontWeight:700,color:COLORS.error}}>{cur(total)}</div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Filter chips */}
      {byCat.length > 0 && (
        <div style={{display:'flex',gap:8,overflowX:'auto',whiteSpace:'nowrap',marginBottom:14,paddingBottom:4}}>
          {['All',...byCat.map(([c])=>c)].map(c=>(
            <button key={c} onClick={()=>setFilter(c)} style={{padding:'5px 14px',borderRadius:RADIUS.full,border:`1.5px solid ${filter===c?color:COLORS.border}`,background:filter===c?color:'#fff',color:filter===c?'#fff':COLORS.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'inherit'}}>
              {c==='All'?'All':`${ICONS[c]||'📝'} ${c}`}
            </button>
          ))}
        </div>
      )}

      <SectionLabel>{filter==='All'?'All Expenses':filter} {filtered.length>0&&`(${filtered.length})`}</SectionLabel>

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="No expenses yet" subtitle="Tap + Add to start tracking."/>
      ) : (
        [...filtered].sort((a,b)=>b.date?.localeCompare(a.date)).map(e=>(
          <Card key={e.id} style={{marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',padding:'12px 14px',gap:12}}>
              <div style={{width:40,height:40,background:COLORS.bg,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{ICONS[e.category]||'📝'}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700}}>{e.category}</div>
                {e.description&&<div style={{fontSize:11,color:COLORS.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.description}</div>}
                <div style={{fontSize:10,color:COLORS.mutedLight,marginTop:1}}>{formatDateLong(e.date)}</div>
              </div>
              <div style={{fontFamily:'monospace',fontSize:15,fontWeight:700,color:COLORS.error,flexShrink:0}}>−{cur(e.amount)}</div>
              <button onClick={()=>handleDelete(e.id)} style={{background:'none',border:'none',color:'#ddd',fontSize:20,cursor:'pointer',padding:'0 2px',lineHeight:1}}>×</button>
            </div>
          </Card>
        ))
      )}
    </Screen>
  );
}
