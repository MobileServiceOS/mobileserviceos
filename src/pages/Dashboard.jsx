// src/pages/Dashboard.jsx
import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext.jsx';
import { listenJobs, listenExpenses } from '../services/businessService.js';
import { computeWeeklySummary, groupByWeek } from '../features/payouts/payoutEngine.js';
import { getCurrentWeekKey, getPrevWeekKey, formatWeekLabel, formatDateLong, today } from '../utils/index.js';
import { cur } from '../utils/index.js';
import { Screen, KPIStatCard, Card, EmptyState, SectionLabel, StatusBadge, TrialBanner } from '../components/index.jsx';
import { COLORS, RADIUS } from '../config/theme.js';

export function Dashboard() {
  const nav = useNavigate();
  const { bizId, bizLoaded, business, payoutConfig, travelPricing, subscription, brandColor } = useBusiness();
  const [jobs,     setJobs]     = useState([]);
  const [expenses, setExpenses] = useState([]);
  const color = brandColor || COLORS.primary;

  useEffect(() => {
    if (!bizId) return;
    const u1 = listenJobs(bizId, setJobs, 200);
    const u2 = listenExpenses(bizId, setExpenses);
    return () => { u1(); u2(); };
  }, [bizId]);

  const weekStartDay = payoutConfig?.weekStartDay ?? 5;
  const weekKey      = getCurrentWeekKey(weekStartDay);
  const prevWeekKey  = getPrevWeekKey(weekStartDay);

  const jobsByWeek = useMemo(() => groupByWeek(jobs, weekStartDay), [jobs, weekStartDay]);
  const expByWeek  = useMemo(() => groupByWeek(expenses, weekStartDay), [expenses, weekStartDay]);

  const weekJobs = jobsByWeek[weekKey]   || [];
  const weekExp  = expByWeek[weekKey]    || [];
  const prevJobs = jobsByWeek[prevWeekKey] || [];
  const prevExp  = expByWeek[prevWeekKey]  || [];

  const cfg = payoutConfig || {};
  const thisWeekSummary = useMemo(() => computeWeeklySummary(weekJobs, weekExp, cfg), [weekJobs, weekExp, cfg]);
  const prevWeekSummary = useMemo(() => computeWeeklySummary(prevJobs, prevExp, cfg), [prevJobs, prevExp, cfg]);

  const todayStr   = today();
  const todayJobs  = jobs.filter(j => j.date === todayStr);
  const todayRev   = todayJobs.reduce((s,j)=>s+(j.pricing?.revenue||0),0);
  const recentJobs = jobs.slice(0, 8);

  if (!bizLoaded) return null;

  return (
    <Screen noPad>
      <TrialBanner subscription={subscription}/>

      {/* Header */}
      <div style={{ background:'#111', padding:'20px 20px 24px', paddingTop:'calc(20px + env(safe-area-inset-top,0px))' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:12, color:'#555', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px' }}>Good {getGreeting()}</div>
            <div style={{ fontSize:22, fontWeight:800, color:'#fff', marginTop:2 }}>{business?.name || 'Dashboard'}</div>
          </div>
          <button onClick={()=>nav('/settings')} style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:10, padding:'8px 10px', cursor:'pointer', fontSize:18 }}>⚙️</button>
        </div>

        {/* Today KPIs */}
        <div style={{ display:'flex', gap:10, marginBottom:0 }}>
          <KPIStatCard label="Today" value={cur(todayRev)} sub={`${todayJobs.length} job${todayJobs.length!==1?'s':''}`} color={color}/>
          <KPIStatCard label="This Week" value={cur(thisWeekSummary.revenue)} sub={`${weekJobs.length} jobs`} color="#fff"/>
          <KPIStatCard label="Net Profit" value={cur(thisWeekSummary.distributableProfit)} sub="this week" color={thisWeekSummary.distributableProfit>0?'#4ade80':'#f87171'}/>
        </div>
      </div>

      <div style={{ padding:'16px 16px 90px' }}>

        {/* Quick actions */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
          <button onClick={()=>nav('/jobs/new')} style={{ background:color, color:'#fff', border:'none', borderRadius:RADIUS.lg, padding:'18px 16px', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4 }}>
            <span style={{ fontSize:24 }}>➕</span>Add Job
          </button>
          <button onClick={()=>nav('/expenses')} style={{ background:'#fff', color:'#111', border:`1.5px solid ${COLORS.border}`, borderRadius:RADIUS.lg, padding:'18px 16px', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4 }}>
            <span style={{ fontSize:24 }}>🧾</span>Log Expense
          </button>
        </div>

        {/* This week summary */}
        <SectionLabel>This Week — {formatWeekLabel(weekKey)}</SectionLabel>
        <Card style={{ marginBottom:16, padding:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            {[
              ['Revenue',    cur(thisWeekSummary.revenue),       '#111'],
              ['Job Costs',  cur(thisWeekSummary.totalJobCosts), COLORS.error],
              ['Expenses',   cur(thisWeekSummary.variableExpenses), COLORS.warning],
              ['Overhead',   cur(thisWeekSummary.overhead),      COLORS.muted],
            ].map(([l,v,c])=>(
              <div key={l}>
                <div style={{ fontSize:10, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:2 }}>{l}</div>
                <div style={{ fontFamily:'monospace', fontSize:16, fontWeight:700, color:c }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop:`1px solid ${COLORS.border}`, paddingTop:12 }}>
            <div style={{ fontSize:12, color:COLORS.muted, marginBottom:4 }}>Distributable Profit</div>
            <div style={{ fontFamily:'monospace', fontSize:24, fontWeight:800, color:thisWeekSummary.distributableProfit>0?COLORS.success:COLORS.error }}>
              {cur(thisWeekSummary.distributableProfit)}
            </div>
          </div>
          {thisWeekSummary.ownerPayouts.length > 0 && (
            <div style={{ marginTop:12, display:'flex', gap:8, flexWrap:'wrap' }}>
              {thisWeekSummary.ownerPayouts.map(o=>(
                <div key={o.id} style={{ background:COLORS.bg, borderRadius:RADIUS.sm, padding:'6px 12px', fontSize:12, color:'#555' }}>
                  {o.name}: <strong style={{ color:'#111' }}>{cur(o.amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Payout preview */}
        {prevWeekSummary.revenue > 0 && (
          <>
            <SectionLabel>Previous Week</SectionLabel>
            <Card style={{ marginBottom:16, padding:16, cursor:'pointer' }} onClick={()=>nav('/payouts')}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:13, color:COLORS.muted, marginBottom:2 }}>{formatWeekLabel(prevWeekKey)}</div>
                  <div style={{ fontFamily:'monospace', fontSize:18, fontWeight:700 }}>{cur(prevWeekSummary.distributableProfit)} profit</div>
                </div>
                <div style={{ fontSize:22 }}>→</div>
              </div>
            </Card>
          </>
        )}

        {/* Recent jobs */}
        <SectionLabel>Recent Jobs</SectionLabel>
        {recentJobs.length === 0 ? (
          <EmptyState icon="🛞" title="No jobs yet" subtitle="Tap + Add Job to log your first job." action={<button onClick={()=>nav('/jobs/new')} style={{background:color,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'12px 24px',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Add First Job</button>}/>
        ) : (
          recentJobs.map(job => <JobRow key={job.id} job={job} onClick={()=>nav(`/jobs/${job.id}`)}/>)
        )}
      </div>
    </Screen>
  );
}

function JobRow({ job, onClick }) {
  return (
    <Card style={{ marginBottom:8, cursor:'pointer' }} onClick={onClick}>
      <div style={{ display:'flex', alignItems:'center', padding:'12px 14px', gap:12 }}>
        <div style={{ width:40, height:40, background:COLORS.bg, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>🛞</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:2 }}>{job.serviceName || job.service}</div>
          <div style={{ fontSize:12, color:COLORS.muted, display:'flex', gap:6 }}>
            <span>{job.location?.areaName || job.area}</span>
            {job.customer?.name && <span>• {job.customer.name}</span>}
            <span>• {formatDateLong(job.date)}</span>
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontFamily:'monospace', fontSize:15, fontWeight:700, color:'#111' }}>{cur(job.pricing?.revenue || job.revenue)}</div>
          <StatusBadge status={job.status || (job.payment?.status || 'completed')}/>
        </div>
      </div>
    </Card>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
