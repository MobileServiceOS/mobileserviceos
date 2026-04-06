// src/pages/Jobs.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext.jsx';
import { listenJobs } from '../services/businessService.js';
import { cur, formatDateLong } from '../utils/index.js';
import { Screen, Card, EmptyState, StatusBadge, SectionLabel } from '../components/index.jsx';
import { COLORS, RADIUS } from '../config/theme.js';

export function Jobs() {
  const nav = useNavigate();
  const { bizId, brandColor } = useBusiness();
  const color = brandColor || COLORS.primary;
  const [jobs,   setJobs]   = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | completed | pending

  useEffect(() => {
    if (!bizId) return;
    return listenJobs(bizId, setJobs, 200);
  }, [bizId]);

  const filtered = useMemo(() => {
    let j = jobs;
    if (filter !== 'all') j = j.filter(x => x.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      j = j.filter(x =>
        x.serviceName?.toLowerCase().includes(q) ||
        x.customer?.name?.toLowerCase().includes(q) ||
        x.location?.areaName?.toLowerCase().includes(q) ||
        x.jobDetails?.data?.tireSize?.toLowerCase().includes(q)
      );
    }
    return j;
  }, [jobs, search, filter]);

  const totalRev = filtered.reduce((s,j)=>s+(j.pricing?.revenue||0),0);

  return (
    <Screen title="Jobs" action={
      <button onClick={()=>nav('/jobs/new')} style={{background:color,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'8px 16px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>+ Add</button>
    }>
      {/* Search */}
      <input value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%',padding:'11px 14px',border:`1.5px solid ${COLORS.border}`,borderRadius:RADIUS.md,fontSize:14,marginBottom:10,fontFamily:'inherit',background:'#fff',outline:'none'}} placeholder="🔍  Search jobs..."/>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:14,overflowX:'auto',whiteSpace:'nowrap'}}>
        {[['all','All'],['completed','Paid'],['pending','Pending']].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{padding:'6px 14px',borderRadius:RADIUS.full,border:`1.5px solid ${filter===v?color:COLORS.border}`,background:filter===v?color:'#fff',color:filter===v?'#fff':COLORS.muted,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>
            {l}
          </button>
        ))}
        <div style={{marginLeft:'auto',fontFamily:'monospace',fontSize:13,color:COLORS.muted,display:'flex',alignItems:'center',flexShrink:0}}>{cur(totalRev)}</div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="No jobs" subtitle={search?'No jobs match your search.':'Add your first job to get started.'} action={!search&&<button onClick={()=>nav('/jobs/new')} style={{background:color,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'12px 24px',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Add Job</button>}/>
      ) : (
        filtered.map(job => (
          <Card key={job.id} style={{marginBottom:8,cursor:'pointer'}} onClick={()=>nav(`/jobs/${job.id}`)}>
            <div style={{display:'flex',alignItems:'center',padding:'12px 14px',gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:14,fontWeight:700,color:'#111'}}>{job.serviceName}</span>
                  <StatusBadge status={job.status}/>
                </div>
                <div style={{fontSize:12,color:COLORS.muted}}>
                  {formatDateLong(job.date)}{job.location?.areaName?` · ${job.location.areaName}`:''}{job.customer?.name?` · ${job.customer.name}`:''}
                </div>
                {job.jobDetails?.data?.tireSize && <div style={{fontSize:11,color:COLORS.mutedLight,marginTop:1}}>🛞 {job.jobDetails.data.tireSize}{job.jobDetails.data.quantity>1?` ×${job.jobDetails.data.quantity}`:''}</div>}
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontFamily:'monospace',fontSize:16,fontWeight:700}}>{cur(job.pricing?.revenue||0)}</div>
                <div style={{fontSize:11,color:COLORS.muted}}>Net: {cur(job.pricing?.netProfit||0)}</div>
              </div>
            </div>
          </Card>
        ))
      )}
    </Screen>
  );
}


// ─── src/pages/JobDetails.jsx ──────────────────────────────────────────────
export function JobDetails() {
  const nav = useNavigate();
  const { id } = (() => { const u = window.location.pathname.split('/'); return { id: u[u.length-1] }; })();
  const { bizId, brandColor } = useBusiness();
  const color = brandColor || COLORS.primary;
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (!bizId || !id || id==='new') return;
    import('../services/businessService.js').then(m=>m.getJob(bizId,id)).then(setJob);
  }, [bizId, id]);

  if (!job) return null;
  const p = job.pricing || {};

  return (
    <div style={{height:'100dvh',display:'flex',flexDirection:'column',background:COLORS.bg}}>
      <div style={{background:'#fff',borderBottom:`1px solid ${COLORS.border}`,padding:'16px 20px 14px',display:'flex',alignItems:'center',gap:12,paddingTop:'calc(16px + env(safe-area-inset-top,0px))'}}>
        <button onClick={()=>nav('/jobs')} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',lineHeight:1}}>←</button>
        <div style={{flex:1,fontSize:18,fontWeight:700}}>{job.serviceName}</div>
        <button onClick={()=>nav(`/jobs/${id}/edit`)} style={{background:COLORS.bg,border:`1.5px solid ${COLORS.border}`,borderRadius:RADIUS.md,padding:'8px 14px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Edit</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:16,paddingBottom:32}}>
        {/* Revenue hero */}
        <Card style={{padding:20,marginBottom:12,textAlign:'center',background:'#111'}}>
          <div style={{fontSize:10,color:'#555',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:6}}>Job Revenue</div>
          <div style={{fontFamily:'monospace',fontSize:40,fontWeight:700,color:'#fff',marginBottom:4}}>{cur(p.revenue)}</div>
          <div style={{fontSize:13,color:'#555'}}>{formatDateLong(job.date)} · {job.location?.areaName}</div>
        </Card>

        {/* P&L */}
        <Card style={{padding:16,marginBottom:12}}>
          <SectionLabel style={{marginTop:0}}>Job P&L</SectionLabel>
          {[['Material Cost',p.materialCost,'expense'],['Other Costs',p.otherJobCost,'expense'],['Labor Cost',p.laborCost,'expense'],['Travel Cost',p.travelCost,'expense'],['Travel Fee (charged)',p.travelFee,'neutral']].map(([l,v,t])=>v>0&&(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:`1px solid ${COLORS.border}`,fontSize:13}}>
              <span style={{color:COLORS.muted}}>{l}</span>
              <span style={{fontFamily:'monospace',fontWeight:600,color:t==='expense'?COLORS.error:COLORS.muted}}>−{cur(v)}</span>
            </div>
          ))}
          <div style={{display:'flex',justifyContent:'space-between',paddingTop:10,fontSize:15,fontWeight:700}}>
            <span>Net Profit</span>
            <span style={{fontFamily:'monospace',color:p.netProfit>=0?COLORS.success:COLORS.error}}>{cur(p.netProfit)}</span>
          </div>
        </Card>

        {/* Details */}
        <Card style={{padding:16,marginBottom:12}}>
          {job.customer?.name && <Row label="Customer" val={job.customer.name}/>}
          {job.customer?.phone && <Row label="Phone" val={job.customer.phone}/>}
          <Row label="Payment" val={`${job.payment?.method} — ${job.payment?.status}`}/>
          {job.travel?.miles > 0 && <Row label="Miles" val={`${job.travel.miles} mi`}/>}
          {job.jobDetails?.data?.tireSize && <Row label="Tire Size" val={job.jobDetails.data.tireSize}/>}
          {job.notes && <Row label="Notes" val={job.notes}/>}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, val }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${COLORS.border}`,fontSize:13}}>
      <span style={{color:COLORS.muted}}>{label}</span>
      <span style={{fontWeight:600,color:'#111',textAlign:'right',maxWidth:'60%'}}>{val}</span>
    </div>
  );
}
