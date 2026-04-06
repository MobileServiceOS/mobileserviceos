// src/pages/Onboarding.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useBusiness } from '../business/BusinessContext.jsx';
import { createBusiness } from '../services/businessService.js';
import { MODEL_CONFIGS } from '../features/businessModel/modelConfigs.js';
import { COLORS, RADIUS } from '../config/theme.js';

const TOTAL_STEPS = 10;

function ProgressBar({ step }) {
  return (
    <div style={{ background:'#2a2a2a', height:3, borderRadius:3, margin:'0 24px 24px' }}>
      <div style={{ height:'100%', borderRadius:3, background:COLORS.primary, width:`${(step/TOTAL_STEPS)*100}%`, transition:'width .3s' }}/>
    </div>
  );
}

function StepWrap({ step, title, subtitle, children, onNext, onBack, nextLabel='Continue', loading }) {
  return (
    <div style={{ minHeight:'100dvh', background:'#111', display:'flex', flexDirection:'column', paddingTop:'env(safe-area-inset-top,20px)' }}>
      {/* Header */}
      <div style={{ padding:'20px 24px 0', display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        {onBack && <button onClick={onBack} style={{ background:'none', border:'none', color:'#555', fontSize:22, cursor:'pointer', padding:0, lineHeight:1 }}>←</button>}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:'#555', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:2 }}>Step {step} of {TOTAL_STEPS}</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#fff' }}>{title}</div>
          {subtitle && <div style={{ fontSize:13, color:'#555', marginTop:3 }}>{subtitle}</div>}
        </div>
      </div>
      <ProgressBar step={step}/>
      {/* Body */}
      <div style={{ flex:1, padding:'0 24px', overflowY:'auto' }}>
        {children}
      </div>
      {/* Footer */}
      <div style={{ padding:'20px 24px', paddingBottom:'calc(20px + env(safe-area-inset-bottom,0px))' }}>
        <button onClick={onNext} disabled={loading} style={{ width:'100%', background:COLORS.primary, color:'#fff', border:'none', borderRadius:RADIUS.md, padding:'16px', fontSize:16, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          {loading?'Saving...':nextLabel}
        </button>
      </div>
    </div>
  );
}

export function Onboarding() {
  const { user } = useAuth();
  const { business, refreshSettings } = useBusiness();
  const nav = useNavigate();

  const [step,     setStep]     = useState(1);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Step data
  const [bizName,  setBizName]  = useState('');
  const [model,    setModel]    = useState('tire_service');
  const [brandColor, setBrandColor] = useState('#ea580c');
  const [areas,    setAreas]    = useState([]);
  const [newArea,  setNewArea]  = useState('');
  const [team,     setTeam]     = useState([
    { id:'tm_1', name:'Owner 1', role:'owner', payType:'profit_percentage', value:100, active:true },
  ]);
  const [weekStart, setWeekStart] = useState(5);
  const [payday,    setPayday]    = useState(5);
  const [monthly,   setMonthly]   = useState('');
  const [travelCPM, setTravelCPM] = useState('0.65');
  const [chargeCPM, setChargeCPM] = useState('1.00');
  const [freeRadius,setFreeRadius]= useState('5');

  const inp = { width:'100%', padding:'13px 14px', fontSize:16, border:'1.5px solid #333', borderRadius:RADIUS.md, background:'#1a1a1a', color:'#fff', outline:'none', fontFamily:'inherit' };
  const lbl = { fontSize:11, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8, display:'block' };

  const DAYS = [
    {v:0,l:'Sunday'},{v:1,l:'Monday'},{v:2,l:'Tuesday'},{v:3,l:'Wednesday'},
    {v:4,l:'Thursday'},{v:5,l:'Friday'},{v:6,l:'Saturday'},
  ];

  const next = () => setStep(s => Math.min(s+1, TOTAL_STEPS));
  const back = () => setStep(s => Math.max(s-1, 1));

  const finish = async () => {
    setLoading(true);
    setError('');
    try {
      const bizId = user.uid + '_biz';
      // Create business with all collected data
      await createBusiness({ businessId: bizId, ownerId: user.uid, name: bizName, modelType: model });

      // Update settings with onboarding data
      const { updateSetting } = await import('../services/businessService.js');
      await updateSetting(bizId, 'branding', { brandColor, businessName: bizName });
      await updateSetting(bizId, 'payoutConfig', {
        weekStartDay: weekStart, paydayDay: payday,
        overheadMode: 'weekly_fixed', weeklyOverhead: 0,
        monthlyOverhead: parseFloat(monthly)||0,
        team,
      });
      await updateSetting(bizId, 'businessModel', {
        modelType: model, weekStartDay: weekStart, paydayDay: payday,
        monthlyOverhead: parseFloat(monthly)||0,
      });
      await updateSetting(bizId, 'travelPricing', {
        costPerMile: parseFloat(travelCPM)||0.65,
        chargePerMile: parseFloat(chargeCPM)||1.0,
        freeRadiusMiles: parseFloat(freeRadius)||5,
        roundTrip: false,
        bands:[{maxMiles:10,surcharge:0},{maxMiles:20,surcharge:10},{maxMiles:30,surcharge:20},{maxMiles:999,surcharge:35}],
      });

      // Add areas
      const { addArea, updateBusiness } = await import('../services/businessService.js');
      for (const a of areas) await addArea(bizId, { name: a, active: true });
      await updateBusiness(bizId, { onboardingCompleted: true, onboardingStep: TOTAL_STEPS });

      await refreshSettings();
      nav('/dashboard');
    } catch(e) {
      setError(e.message || 'Setup failed. Please try again.');
      console.error(e);
    }
    setLoading(false);
  };

  const addArea = () => {
    if (!newArea.trim()) return;
    setAreas(a => [...a, newArea.trim()]);
    setNewArea('');
  };

  const addTeamMember = () => {
    const id = 'tm_' + Date.now();
    setTeam(t => [...t, { id, name:'', role:'employee', payType:'per_job', value:0, active:true }]);
  };

  const updateMember = (id, field, val) => {
    setTeam(t => t.map(m => m.id===id ? {...m, [field]:val} : m));
  };

  const totalPct = team.filter(m=>m.active&&m.payType==='profit_percentage').reduce((s,m)=>s+(parseFloat(m.value)||0),0);

  // ── Steps ──────────────────────────────────────────────────────────────
  if (step===1) return (
    <StepWrap step={1} title="Business Name" subtitle="What's your business called?" onNext={()=>{ if(!bizName.trim()){setError('Enter your business name.');return;} setError('');next(); }}>
      {error && <div style={{color:'#f87171',fontSize:13,marginBottom:12}}>{error}</div>}
      <label style={lbl}>Business Name</label>
      <input value={bizName} onChange={e=>setBizName(e.target.value)} style={{...inp,fontSize:18}} placeholder="e.g. Wheel Rush Mobile Tire"/>
      <div style={{color:'#555',fontSize:13,marginTop:12}}>This will appear on your invoices and customer communications.</div>
    </StepWrap>
  );

  if (step===2) return (
    <StepWrap step={2} title="Brand Color" subtitle="Choose your brand color" onNext={next} onBack={back}>
      <label style={lbl}>Brand Color</label>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:20}}>
        {['#ea580c','#2563eb','#16a34a','#9333ea','#dc2626','#0891b2','#d97706','#111111'].map(c=>(
          <div key={c} onClick={()=>setBrandColor(c)} style={{width:52,height:52,borderRadius:RADIUS.md,background:c,cursor:'pointer',border:brandColor===c?'3px solid #fff':'3px solid transparent',boxShadow:brandColor===c?`0 0 0 2px ${c}`:undefined,transition:'border .15s'}}/>
        ))}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <label style={lbl}>Custom Color</label>
        <input type="color" value={brandColor} onChange={e=>setBrandColor(e.target.value)} style={{width:48,height:40,border:'none',background:'none',cursor:'pointer'}}/>
        <span style={{color:'#555',fontSize:13}}>{brandColor}</span>
      </div>
      <div style={{marginTop:24,background:'#1a1a1a',borderRadius:RADIUS.lg,padding:20,border:'1px solid #2a2a2a'}}>
        <div style={{color:'#888',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:12}}>Preview</div>
        <div style={{background:brandColor,borderRadius:10,padding:'14px 18px',color:'#fff',fontWeight:700,fontSize:15,textAlign:'center'}}>{bizName||'Your Business'}</div>
      </div>
    </StepWrap>
  );

  if (step===3) return (
    <StepWrap step={3} title="Service Areas" subtitle="Where do you operate? (optional)" onNext={next} onBack={back} nextLabel={areas.length?'Continue':'Skip for now'}>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <input value={newArea} onChange={e=>setNewArea(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addArea()} style={{...inp,flex:1}} placeholder="e.g. Miami, Aventura"/>
        <button onClick={addArea} style={{background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'0 18px',fontSize:20,cursor:'pointer'}}>+</button>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {areas.map((a,i)=>(
          <div key={i} style={{background:'#1a1a1a',border:'1px solid #333',borderRadius:RADIUS.full,padding:'6px 14px',display:'flex',alignItems:'center',gap:8,color:'#fff',fontSize:14}}>
            {a}
            <button onClick={()=>setAreas(ar=>ar.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#555',cursor:'pointer',fontSize:16,lineHeight:1}}>×</button>
          </div>
        ))}
      </div>
      {areas.length===0 && <div style={{color:'#444',fontSize:13,marginTop:16}}>You can add areas anytime in Settings.</div>}
    </StepWrap>
  );

  if (step===4) return (
    <StepWrap step={4} title="Team & Payouts" subtitle="Who gets paid and how?" onNext={()=>{ if(totalPct>100){setError('Profit split cannot exceed 100%.');return;}setError('');next(); }} onBack={back}>
      {error && <div style={{color:'#f87171',fontSize:13,marginBottom:12}}>{error}</div>}
      {team.map((m,i)=>(
        <div key={m.id} style={{background:'#1a1a1a',borderRadius:RADIUS.lg,padding:16,marginBottom:12,border:'1px solid #2a2a2a'}}>
          <div style={{display:'flex',gap:8,marginBottom:10}}>
            <input value={m.name} onChange={e=>updateMember(m.id,'name',e.target.value)} style={{...inp,flex:1}} placeholder="Name"/>
            <select value={m.role} onChange={e=>updateMember(m.id,'role',e.target.value)} style={{...inp,width:120,flex:'none'}}>
              <option value="owner">Owner</option><option value="partner">Partner</option>
              <option value="employee">Employee</option><option value="helper">Helper</option>
            </select>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <select value={m.payType} onChange={e=>updateMember(m.id,'payType',e.target.value)} style={{...inp,flex:1}}>
              <option value="profit_percentage">% of Profit</option>
              <option value="per_job">$ Per Job</option>
            </select>
            <input type="number" value={m.value} onChange={e=>updateMember(m.id,'value',parseFloat(e.target.value)||0)} style={{...inp,width:80,flex:'none',textAlign:'right'}}/>
            <span style={{color:'#555',fontSize:14,flexShrink:0}}>{m.payType==='profit_percentage'?'%':'$/job'}</span>
            {team.length>1 && <button onClick={()=>setTeam(t=>t.filter(x=>x.id!==m.id))} style={{background:'none',border:'none',color:'#555',cursor:'pointer',fontSize:20,padding:'0 4px'}}>×</button>}
          </div>
        </div>
      ))}
      {totalPct > 0 && <div style={{color:totalPct>100?'#f87171':'#4ade80',fontSize:13,marginBottom:12}}>Profit split total: {totalPct}%{totalPct>100?' ⚠️ exceeds 100%':' ✓'}</div>}
      <button onClick={addTeamMember} style={{width:'100%',background:'#1a1a1a',color:COLORS.primary,border:`1.5px solid ${COLORS.primary}`,borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>+ Add Team Member</button>
      <div style={{color:'#444',fontSize:12,marginTop:12}}>Per-job members are paid before profit split. You can change this in Settings anytime.</div>
    </StepWrap>
  );

  if (step===5) return (
    <StepWrap step={5} title="Work Week" subtitle="When does your week start and when do you get paid?" onNext={next} onBack={back}>
      <label style={lbl}>Week Starts On</label>
      <select value={weekStart} onChange={e=>setWeekStart(parseInt(e.target.value))} style={{...inp,marginBottom:20}}>
        {DAYS.map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
      </select>
      <label style={lbl}>Payday</label>
      <select value={payday} onChange={e=>setPayday(parseInt(e.target.value))} style={{...inp,marginBottom:20}}>
        {DAYS.map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
      </select>
      <label style={lbl}>Monthly Fixed Overhead ($)</label>
      <input type="number" value={monthly} onChange={e=>setMonthly(e.target.value)} style={inp} placeholder="e.g. 2425"/>
      <div style={{color:'#444',fontSize:12,marginTop:8}}>This covers things like insurance, phone, storage, marketing. Accrues based on days worked.</div>
    </StepWrap>
  );

  if (step===6) return (
    <StepWrap step={6} title="Travel Pricing" subtitle="Configure how travel is calculated" onNext={next} onBack={back}>
      <label style={lbl}>Your Cost Per Mile ($)</label>
      <input type="number" step="0.01" value={travelCPM} onChange={e=>setTravelCPM(e.target.value)} style={{...inp,marginBottom:16}}/>
      <label style={lbl}>Charge Per Mile to Customer ($)</label>
      <input type="number" step="0.01" value={chargeCPM} onChange={e=>setChargeCPM(e.target.value)} style={{...inp,marginBottom:16}}/>
      <label style={lbl}>Free Radius (miles)</label>
      <input type="number" value={freeRadius} onChange={e=>setFreeRadius(e.target.value)} style={inp}/>
      <div style={{color:'#444',fontSize:12,marginTop:8}}>Within this radius, no travel fee is charged. You can set custom distance bands in Settings.</div>
    </StepWrap>
  );

  // Steps 7-10 are info / confirmation screens
  if (step>=7 && step<=9) {
    const labels = {7:'Invoice Setup',8:'Subscription',9:'Almost Done!'};
    const subs   = {7:'Invoices use your business logo and branding',8:'Start your 7-day free trial',9:'Review your setup'};
    const bodies = {
      7: <div style={{color:'#888',fontSize:14,lineHeight:1.8}}>Your invoices will automatically include:<br/>• Your business name & logo<br/>• Customer details<br/>• Service & amount<br/>• Payment info (Zelle/Venmo)<br/><br/>You can customize logos in Settings → Branding.</div>,
      8: <div style={{color:'#888',fontSize:14,lineHeight:1.8}}>Your 7-day free trial includes full access to all features.<br/><br/>After the trial, the plan is <strong style={{color:'#fff'}}>$29/month</strong>.<br/><br/>Billing configuration is available in Settings → Billing after setup.</div>,
      9: <div style={{color:'#888',fontSize:14,lineHeight:1.8}}>
          <div style={{background:'#1a1a1a',borderRadius:RADIUS.lg,padding:16,border:'1px solid #2a2a2a',marginBottom:12}}>
            <div style={{color:'#fff',fontWeight:700,marginBottom:4}}>{bizName}</div>
            <div style={{fontSize:13}}>Model: {MODEL_CONFIGS[model]?.label}</div>
            <div style={{fontSize:13}}>Team: {team.length} member{team.length!==1?'s':''}</div>
            <div style={{fontSize:13}}>Areas: {areas.length || 'None added'}</div>
            <div style={{fontSize:13}}>Week: {DAYS.find(d=>d.v===weekStart)?.l} → {DAYS.find(d=>d.v===payday)?.l}</div>
          </div>
          You can change everything in Settings at any time.
        </div>,
    };
    return (
      <StepWrap step={step} title={labels[step]} subtitle={subs[step]} onNext={step===9?finish:next} onBack={back} nextLabel={step===9?'Launch My App':'Continue'} loading={step===9&&loading}>
        {error && <div style={{color:'#f87171',fontSize:13,marginBottom:12}}>{error}</div>}
        {bodies[step]}
      </StepWrap>
    );
  }

  return (
    <StepWrap step={step} title="Setup Complete!" onNext={finish} nextLabel="Go to Dashboard" loading={loading}>
      <div style={{textAlign:'center',paddingTop:40}}>
        <div style={{fontSize:64,marginBottom:16}}>🎉</div>
        <div style={{color:'#fff',fontSize:20,fontWeight:700,marginBottom:8}}>You're ready to go!</div>
        <div style={{color:'#555',fontSize:14}}>Your business dashboard is set up and ready.</div>
      </div>
    </StepWrap>
  );
}
