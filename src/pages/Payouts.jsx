// src/pages/Payouts.jsx
import { useState, useEffect, useMemo } from 'react';
import { useBusiness } from '../business/BusinessContext.jsx';
import { listenJobs, listenExpenses, listenPayoutSnapshots, savePayoutSnapshot } from '../services/businessService.js';
import { computeWeeklySummary, groupByWeek, buildPayoutSnapshot } from '../features/payouts/payoutEngine.js';
import { getCurrentWeekKey, getPrevWeekKey, getWeekStart, formatWeekLabel, today, cur, addDays } from '../utils/index.js';
import { Screen, Card, SectionLabel, EmptyState } from '../components/index.jsx';
import { COLORS, RADIUS } from '../config/theme.js';

export function Payouts() {
  const { bizId, payoutConfig, brandColor } = useBusiness();
  const color = brandColor || COLORS.primary;
  const [jobs,      setJobs]      = useState([]);
  const [expenses,  setExpenses]  = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [activeWk,  setActiveWk]  = useState(null);
  const [saving,    setSaving]    = useState(false);

  const weekDay = payoutConfig?.weekStartDay ?? 5;
  const thisWk  = getCurrentWeekKey(weekDay);
  const prevWk  = getPrevWeekKey(weekDay);

  useEffect(() => {
    if (!bizId) return;
    const u1 = listenJobs(bizId, setJobs, 500);
    const u2 = listenExpenses(bizId, setExpenses);
    const u3 = listenPayoutSnapshots(bizId, setSnapshots);
    return () => { u1(); u2(); u3(); };
  }, [bizId]);

  const jobsByWk = useMemo(()=>groupByWeek(jobs,weekDay),[jobs,weekDay]);
  const expByWk  = useMemo(()=>groupByWeek(expenses,weekDay),[expenses,weekDay]);

  // All unique weeks from jobs + snapshots
  const allWeeks = useMemo(() => {
    const keys = new Set([...Object.keys(jobsByWk), ...snapshots.map(s=>s.weekKey)]);
    return [...keys].sort((a,b)=>b.localeCompare(a));
  }, [jobsByWk, snapshots]);

  const cfg = payoutConfig || {};

  const getSummary = (wk) => {
    const snap = snapshots.find(s=>s.weekKey===wk);
    if (snap) return snap;
    return computeWeeklySummary(jobsByWk[wk]||[], expByWk[wk]||[], cfg);
  };

  const handleSaveSnapshot = async (wk) => {
    setSaving(true);
    try {
      const snap = buildPayoutSnapshot(wk, jobsByWk[wk]||[], expByWk[wk]||[], cfg);
      await savePayoutSnapshot(bizId, wk, snap);
    } finally { setSaving(false); }
  };

  return (
    <Screen title="Payouts">
      {/* Current week */}
      <SectionLabel style={{marginTop:0}}>Current Week — {formatWeekLabel(thisWk)}</SectionLabel>
      <WeekCard wk={thisWk} summary={getSummary(thisWk)} cfg={cfg} color={color} isCurrent onSave={()=>handleSaveSnapshot(thisWk)} saving={saving} isSnapped={!!snapshots.find(s=>s.weekKey===thisWk)}/>

      {/* Previous weeks */}
      {allWeeks.filter(w=>w!==thisWk).length > 0 && (
        <>
          <SectionLabel>Previous Weeks</SectionLabel>
          {allWeeks.filter(w=>w!==thisWk).map(wk=>(
            <WeekCard key={wk} wk={wk} summary={getSummary(wk)} cfg={cfg} color={color} onSave={()=>handleSaveSnapshot(wk)} saving={saving} isSnapped={!!snapshots.find(s=>s.weekKey===wk)} expanded={activeWk===wk} onToggle={()=>setActiveWk(activeWk===wk?null:wk)}/>
          ))}
        </>
      )}

      {allWeeks.length === 0 && <EmptyState icon="💰" title="No payout data yet" subtitle="Log jobs to see your weekly payout breakdown."/>}
    </Screen>
  );
}

function WeekCard({ wk, summary, cfg, color, isCurrent, onSave, saving, isSnapped, expanded, onToggle }) {
  const open = isCurrent || expanded;

  return (
    <Card style={{marginBottom:12,overflow:'hidden'}}>
      {/* Header */}
      <div onClick={onToggle} style={{padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:onToggle?'pointer':'default'}}>
        <div>
          <div style={{fontSize:12,color:COLORS.muted,marginBottom:2}}>{formatWeekLabel(wk)}</div>
          <div style={{fontFamily:'monospace',fontSize:20,fontWeight:700,color:summary.distributableProfit>0?color:COLORS.error}}>
            {cur(summary.distributableProfit)}
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:12,color:COLORS.muted}}>{summary.jobCount} job{summary.jobCount!==1?'s':''}</div>
          <div style={{fontSize:12,color:COLORS.muted}}>{cur(summary.revenue)} rev</div>
          {!isCurrent && <div style={{fontSize:20,marginTop:4}}>{open?'▲':'▼'}</div>}
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{borderTop:`1px solid ${COLORS.border}`,padding:'14px 16px'}}>
          {/* P&L rows */}
          {[
            ['Revenue',          summary.revenue,             color,        false],
            ['Material Costs',   summary.materialCosts,       COLORS.error, true],
            ['Other Job Costs',  summary.otherJobCosts,       COLORS.error, true],
            ['Labor Costs',      summary.laborCosts,          COLORS.error, true],
            ['Travel Costs',     summary.travelCosts,         COLORS.error, true],
            ['Variable Expenses',summary.variableExpenses,    COLORS.error, true],
            ['Overhead',         summary.overhead,            COLORS.muted, true],
          ].filter(([,v])=>v>0).map(([l,v,c,neg])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${COLORS.border}`,fontSize:13}}>
              <span style={{color:COLORS.muted}}>{l}</span>
              <span style={{fontFamily:'monospace',fontWeight:600,color:c}}>{neg?'−':''}{cur(v)}</span>
            </div>
          ))}

          <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${COLORS.border}`,fontSize:15,fontWeight:700}}>
            <span>Distributable Profit</span>
            <span style={{fontFamily:'monospace',color:summary.distributableProfit>0?COLORS.success:COLORS.error}}>{cur(summary.distributableProfit)}</span>
          </div>

          {/* Owner payouts */}
          {summary.ownerPayouts?.length > 0 && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.6px',color:COLORS.muted,marginBottom:8}}>Payout Shares</div>
              {summary.ownerPayouts.map(o=>(
                <div key={o.id||o.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:COLORS.bg,borderRadius:RADIUS.md,marginBottom:6}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600}}>{o.name}</div>
                    <div style={{fontSize:11,color:COLORS.muted}}>{o.role} · {o.value}% of profit</div>
                  </div>
                  <div style={{fontFamily:'monospace',fontSize:18,fontWeight:700,color:o.amount>0?COLORS.success:'#111'}}>{cur(o.amount)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Save snapshot */}
          {!isSnapped ? (
            <button onClick={onSave} disabled={saving} style={{width:'100%',marginTop:12,background:'#111',color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'Saving...':'📸 Save Payout Snapshot'}
            </button>
          ) : (
            <div style={{textAlign:'center',marginTop:12,fontSize:12,color:COLORS.success,fontWeight:600}}>✓ Snapshot saved</div>
          )}
        </div>
      )}
    </Card>
  );
}
