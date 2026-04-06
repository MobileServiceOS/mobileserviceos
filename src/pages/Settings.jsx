// src/pages/Settings.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useBusiness } from '../business/BusinessContext.jsx';
import { listenServices, addService, updateService, deleteService, listenAreas, addArea, deleteArea } from '../services/businessService.js';
import { Screen, Card, SectionLabel, FormField, Toggle, inputStyle, selectStyle } from '../components/index.jsx';
import { COLORS, RADIUS } from '../config/theme.js';

export function Settings() {
  const nav = useNavigate();
  const { signOut } = useAuth();
  const { bizId, branding, profile, bizModel, travelPricing, payoutConfig, saveSetting, brandColor } = useBusiness();
  const color  = brandColor || COLORS.primary;
  const [section, setSection] = useState('business');
  const [saved,   setSaved]   = useState('');

  const save = async (name, data) => {
    await saveSetting(name, data);
    setSaved(name);
    setTimeout(()=>setSaved(''),2000);
  };

  const SECTIONS = [
    { id:'business', icon:'🏢', label:'Business' },
    { id:'branding',  icon:'🎨', label:'Branding' },
    { id:'services',  icon:'🛞', label:'Services' },
    { id:'areas',     icon:'📍', label:'Areas' },
    { id:'travel',    icon:'🚗', label:'Travel' },
    { id:'team',      icon:'👥', label:'Team' },
    { id:'billing',   icon:'💳', label:'Billing' },
    { id:'account',   icon:'👤', label:'Account' },
  ];

  return (
    <Screen title="Settings" noPad>
      {/* Tab bar */}
      <div style={{display:'flex',overflowX:'auto',borderBottom:`1px solid ${COLORS.border}`,background:'#fff',paddingTop:'env(safe-area-inset-top,0px)',flexShrink:0}}>
        {SECTIONS.map(s=>(
          <button key={s.id} onClick={()=>setSection(s.id)} style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'10px 14px',border:'none',background:'none',cursor:'pointer',flexShrink:0,gap:2,borderBottom:`2px solid ${section===s.id?color:'transparent'}`,transition:'border-color .15s'}}>
            <span style={{fontSize:16}}>{s.icon}</span>
            <span style={{fontSize:10,fontWeight:600,color:section===s.id?color:COLORS.muted,textTransform:'uppercase',letterSpacing:'0.4px'}}>{s.label}</span>
          </button>
        ))}
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'16px',paddingBottom:'90px'}}>
        {saved && <div style={{background:'#f0fdf4',border:`1px solid ${COLORS.success}`,borderRadius:RADIUS.md,padding:'10px 14px',fontSize:13,color:COLORS.success,fontWeight:600,marginBottom:12}}>✓ Saved</div>}

        {section==='business' && <BusinessSection profile={profile} bizModel={bizModel} save={save}/>}
        {section==='branding' && <BrandingSection branding={branding} save={save}/>}
        {section==='services' && <ServicesSection bizId={bizId}/>}
        {section==='areas'    && <AreasSection bizId={bizId}/>}
        {section==='travel'   && <TravelSection travel={travelPricing} save={save}/>}
        {section==='team'     && <TeamSection payoutConfig={payoutConfig} save={save}/>}
        {section==='billing'  && <BillingSection nav={nav}/>}
        {section==='account'  && <AccountSection signOut={signOut} nav={nav}/>}
      </div>
    </Screen>
  );
}

// ─── Business Section ──────────────────────────────────────────────────────
function BusinessSection({ profile={}, bizModel={}, save }) {
  const [p, setP] = useState(profile);
  useEffect(()=>setP(profile),[profile]);
  const inp = inputStyle;
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Business Profile</SectionLabel>
      <Card style={{padding:16,marginBottom:12}}>
        {[['Phone','phone','tel'],['Email','email','email'],['Website','website','url'],['Address','address','text'],['Zelle / Payment','zelleInfo','text']].map(([l,k,t])=>(
          <FormField key={k} label={l}><input type={t} value={p[k]||''} onChange={e=>setP(x=>({...x,[k]:e.target.value}))} style={inp}/></FormField>
        ))}
        <button onClick={()=>save('businessProfile',p)} style={{width:'100%',background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Save Profile</button>
      </Card>
      <SectionLabel>Work Week</SectionLabel>
      <Card style={{padding:16,marginBottom:12}}>
        {[['Week Starts','weekStartDay'],['Payday','paydayDay']].map(([l,k])=>(
          <FormField key={k} label={l}>
            <select value={bizModel[k]??5} onChange={e=>save('businessModel',{...bizModel,[k]:parseInt(e.target.value)})} style={{...inp,appearance:'none'}}>
              {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=><option key={i} value={i}>{d}</option>)}
            </select>
          </FormField>
        ))}
        <FormField label="Monthly Fixed Overhead ($)">
          <input type="number" value={bizModel.monthlyOverhead||''} onChange={e=>save('businessModel',{...bizModel,monthlyOverhead:parseFloat(e.target.value)||0})} style={inp} placeholder="e.g. 2425"/>
        </FormField>
      </Card>
    </>
  );
}

// ─── Branding Section ──────────────────────────────────────────────────────
function BrandingSection({ branding={}, save }) {
  const [b, setB] = useState(branding);
  useEffect(()=>setB(branding),[branding]);
  const inp = inputStyle;
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Brand Identity</SectionLabel>
      <Card style={{padding:16,marginBottom:12}}>
        <FormField label="Business Display Name"><input value={b.businessName||''} onChange={e=>setB(x=>({...x,businessName:e.target.value}))} style={inp}/></FormField>
        <FormField label="Tagline"><input value={b.tagline||''} onChange={e=>setB(x=>({...x,tagline:e.target.value}))} style={inp} placeholder="e.g. Mobile Tire Repair"/></FormField>
        <FormField label="Brand Color">
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <input type="color" value={b.brandColor||'#ea580c'} onChange={e=>setB(x=>({...x,brandColor:e.target.value}))} style={{width:48,height:40,border:'none',cursor:'pointer'}}/>
            <div style={{flex:1,height:40,borderRadius:RADIUS.md,background:b.brandColor||'#ea580c'}}/>
          </div>
        </FormField>
        <FormField label="Logo URL"><input value={b.logoUrl||''} onChange={e=>setB(x=>({...x,logoUrl:e.target.value}))} style={inp} placeholder="https://..."/></FormField>
        <button onClick={()=>save('branding',b)} style={{width:'100%',background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Save Branding</button>
      </Card>
    </>
  );
}

// ─── Services Section ──────────────────────────────────────────────────────
function ServicesSection({ bizId }) {
  const [services, setServices] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newSvc, setNewSvc] = useState({name:'',basePrice:'',minPrice:'',maxPrice:'',targetProfit:''});
  useEffect(()=>{ if(!bizId)return; return listenServices(bizId,setServices); },[bizId]);
  const inp = inputStyle;
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Services</SectionLabel>
      {services.map(s=>(
        <Card key={s.id} style={{marginBottom:8,padding:'12px 14px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:14,fontWeight:700}}>{s.name}</div>
              <div style={{fontSize:12,color:COLORS.muted}}>Base: ${s.basePrice} · Min: ${s.minPrice} · Max: ${s.maxPrice}</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>updateService(bizId,s.id,{...s,active:!s.active})} style={{background:s.active!==false?'#f0fdf4':'#f5f5f5',color:s.active!==false?COLORS.success:COLORS.muted,border:'none',borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{s.active!==false?'Active':'Off'}</button>
              <button onClick={()=>window.confirm('Delete service?')&&deleteService(bizId,s.id)} style={{background:'#fee2e2',color:COLORS.error,border:'none',borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Delete</button>
            </div>
          </div>
        </Card>
      ))}
      {adding?(
        <Card style={{padding:16,marginTop:8}}>
          <FormField label="Service Name"><input value={newSvc.name} onChange={e=>setNewSvc(x=>({...x,name:e.target.value}))} style={inp}/></FormField>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <FormField label="Base Price"><input type="number" value={newSvc.basePrice} onChange={e=>setNewSvc(x=>({...x,basePrice:e.target.value}))} style={inp}/></FormField>
            <FormField label="Min Price"><input type="number" value={newSvc.minPrice} onChange={e=>setNewSvc(x=>({...x,minPrice:e.target.value}))} style={inp}/></FormField>
            <FormField label="Max Price"><input type="number" value={newSvc.maxPrice} onChange={e=>setNewSvc(x=>({...x,maxPrice:e.target.value}))} style={inp}/></FormField>
            <FormField label="Target Profit"><input type="number" value={newSvc.targetProfit} onChange={e=>setNewSvc(x=>({...x,targetProfit:e.target.value}))} style={inp}/></FormField>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:4}}>
            <button onClick={()=>{addService(bizId,{name:newSvc.name,basePrice:parseFloat(newSvc.basePrice)||0,minPrice:parseFloat(newSvc.minPrice)||0,maxPrice:parseFloat(newSvc.maxPrice)||0,targetProfit:parseFloat(newSvc.targetProfit)||0,active:true});setAdding(false);setNewSvc({name:'',basePrice:'',minPrice:'',maxPrice:'',targetProfit:''})} } style={{background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'13px',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Add</button>
            <button onClick={()=>setAdding(false)} style={{background:COLORS.bg,color:'#111',border:`1.5px solid ${COLORS.border}`,borderRadius:RADIUS.md,padding:'13px',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
          </div>
        </Card>
      ):(
        <button onClick={()=>setAdding(true)} style={{width:'100%',marginTop:8,background:'#fff',color:COLORS.primary,border:`1.5px solid ${COLORS.primary}`,borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>+ Add Service</button>
      )}
    </>
  );
}

// ─── Areas Section ─────────────────────────────────────────────────────────
function AreasSection({ bizId }) {
  const [areas, setAreas] = useState([]);
  const [name, setName] = useState('');
  useEffect(()=>{ if(!bizId)return; return listenAreas(bizId,setAreas); },[bizId]);
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Service Areas</SectionLabel>
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&name.trim()&&(addArea(bizId,{name:name.trim(),active:true}),setName(''))} style={{...inputStyle,flex:1}} placeholder="Add area..."/>
        <button onClick={()=>{if(name.trim()){addArea(bizId,{name:name.trim(),active:true});setName('');}}} style={{background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'0 18px',fontSize:20,cursor:'pointer'}}>+</button>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {areas.map(a=>(
          <div key={a.id} style={{background:'#fff',border:`1.5px solid ${COLORS.border}`,borderRadius:RADIUS.full,padding:'6px 14px',display:'flex',alignItems:'center',gap:8,fontSize:14}}>
            {a.name}
            <button onClick={()=>deleteArea(bizId,a.id)} style={{background:'none',border:'none',color:COLORS.muted,cursor:'pointer',fontSize:16,lineHeight:1}}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Travel Section ────────────────────────────────────────────────────────
function TravelSection({ travel={}, save }) {
  const [t, setT] = useState(travel);
  useEffect(()=>setT(travel),[travel]);
  const inp = inputStyle;
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Travel Pricing</SectionLabel>
      <Card style={{padding:16,marginBottom:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <FormField label="Your Cost/Mile ($)"><input type="number" step="0.01" value={t.costPerMile||''} onChange={e=>setT(x=>({...x,costPerMile:parseFloat(e.target.value)||0}))} style={inp} placeholder="0.65"/></FormField>
          <FormField label="Charge/Mile ($)"><input type="number" step="0.01" value={t.chargePerMile||''} onChange={e=>setT(x=>({...x,chargePerMile:parseFloat(e.target.value)||0}))} style={inp} placeholder="1.00"/></FormField>
          <FormField label="Free Radius (mi)"><input type="number" value={t.freeRadiusMiles||''} onChange={e=>setT(x=>({...x,freeRadiusMiles:parseFloat(e.target.value)||0}))} style={inp} placeholder="5"/></FormField>
        </div>
        <button onClick={()=>save('travelPricing',t)} style={{width:'100%',marginTop:8,background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Save Travel Config</button>
      </Card>
    </>
  );
}

// ─── Team Section ──────────────────────────────────────────────────────────
function TeamSection({ payoutConfig={}, save }) {
  const [cfg, setCfg] = useState(payoutConfig);
  useEffect(()=>setCfg(payoutConfig),[payoutConfig]);
  const inp = inputStyle;
  const team = cfg.team || [];
  const totalPct = team.filter(m=>m.active&&m.payType==='profit_percentage').reduce((s,m)=>s+(parseFloat(m.value)||0),0);

  const updateMember = (id, field, val) => setCfg(c=>({...c, team: c.team.map(m=>m.id===id?{...m,[field]:val}:m)}));
  const addMember = () => setCfg(c=>({...c, team:[...c.team,{id:'tm_'+Date.now(),name:'',role:'employee',payType:'per_job',value:0,active:true}]}));
  const removeMember = (id) => setCfg(c=>({...c,team:c.team.filter(m=>m.id!==id)}));

  return (
    <>
      <SectionLabel style={{marginTop:0}}>Team & Payout Config</SectionLabel>
      <Card style={{padding:16,marginBottom:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <FormField label="Overhead Mode">
            <select value={cfg.overheadMode||'weekly_fixed'} onChange={e=>setCfg(c=>({...c,overheadMode:e.target.value}))} style={{...inp,appearance:'none'}}>
              <option value="weekly_fixed">Weekly Fixed</option>
              <option value="accrued">Accrued Daily</option>
            </select>
          </FormField>
          <FormField label={cfg.overheadMode==='accrued'?'Monthly Overhead ($)':'Weekly Overhead ($)'}>
            <input type="number" value={cfg.overheadMode==='accrued'?(cfg.monthlyOverhead||''):(cfg.weeklyOverhead||'')} onChange={e=>{const k=cfg.overheadMode==='accrued'?'monthlyOverhead':'weeklyOverhead';setCfg(c=>({...c,[k]:parseFloat(e.target.value)||0}));}} style={inp}/>
          </FormField>
        </div>
        {totalPct>0&&<div style={{fontSize:12,color:totalPct>100?COLORS.error:COLORS.success,fontWeight:600,marginBottom:10}}>Profit split: {totalPct}%{totalPct>100?' ⚠️ Over 100%':' ✓'}</div>}
        {team.map(m=>(
          <div key={m.id} style={{background:COLORS.bg,borderRadius:RADIUS.lg,padding:14,marginBottom:8}}>
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              <input value={m.name} onChange={e=>updateMember(m.id,'name',e.target.value)} style={{...inp,flex:1}} placeholder="Name"/>
              <select value={m.role} onChange={e=>updateMember(m.id,'role',e.target.value)} style={{...inp,width:110,flex:'none',appearance:'none'}}>
                <option value="owner">Owner</option><option value="partner">Partner</option><option value="employee">Employee</option><option value="helper">Helper</option>
              </select>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <select value={m.payType} onChange={e=>updateMember(m.id,'payType',e.target.value)} style={{...inp,flex:1,appearance:'none'}}>
                <option value="profit_percentage">% of Profit</option>
                <option value="per_job">$ Per Job</option>
              </select>
              <input type="number" value={m.value} onChange={e=>updateMember(m.id,'value',parseFloat(e.target.value)||0)} style={{...inp,width:72,flex:'none',textAlign:'right'}}/>
              <span style={{fontSize:13,color:COLORS.muted,flexShrink:0}}>{m.payType==='profit_percentage'?'%':'$'}</span>
              <button onClick={()=>updateMember(m.id,'active',!m.active)} style={{background:m.active?'#f0fdf4':'#f5f5f5',color:m.active?COLORS.success:COLORS.muted,border:'none',borderRadius:6,padding:'6px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>{m.active?'On':'Off'}</button>
              {team.length>1&&<button onClick={()=>removeMember(m.id)} style={{background:'none',border:'none',color:'#ccc',cursor:'pointer',fontSize:20,padding:'0 2px'}}>×</button>}
            </div>
          </div>
        ))}
        <button onClick={addMember} style={{width:'100%',background:'#fff',color:COLORS.primary,border:`1.5px solid ${COLORS.primary}`,borderRadius:RADIUS.md,padding:'11px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',marginTop:4}}>+ Add Member</button>
        <button onClick={()=>save('payoutConfig',cfg)} style={{width:'100%',background:COLORS.primary,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit',marginTop:10}}>Save Team Config</button>
      </Card>
    </>
  );
}

// ─── Billing Section ───────────────────────────────────────────────────────
function BillingSection() {
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Subscription</SectionLabel>
      <Card style={{padding:20,textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>💳</div>
        <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Mobile Service OS</div>
        <div style={{fontSize:14,color:COLORS.muted,marginBottom:16}}>$29/month after trial</div>
        <div style={{background:COLORS.bg,borderRadius:RADIUS.md,padding:'12px 16px',fontSize:13,color:COLORS.muted}}>Stripe billing integration coming soon. Contact support to manage your subscription.</div>
      </Card>
    </>
  );
}

// ─── Account Section ───────────────────────────────────────────────────────
function AccountSection({ signOut, nav }) {
  const { user } = (() => { try { return require('../auth/AuthContext.jsx'); } catch { return { user: null }; } })();
  return (
    <>
      <SectionLabel style={{marginTop:0}}>Account</SectionLabel>
      <Card style={{padding:16,marginBottom:12}}>
        <div style={{fontSize:14,color:COLORS.muted,marginBottom:16}}>Signed in to your Mobile Service OS account.</div>
        <button onClick={async()=>{ if(window.confirm('Sign out?')){ await signOut(); nav('/login'); }}} style={{width:'100%',background:'#fee2e2',color:COLORS.error,border:'none',borderRadius:RADIUS.md,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Sign Out</button>
      </Card>
    </>
  );
}
