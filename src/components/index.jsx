// src/components/index.jsx
// All shared UI components in one file for simplicity

import { useNavigate, useLocation } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext.jsx';
import { COLORS, RADIUS, SHADOW } from '../config/theme.js';

// ─── Loading Screen ────────────────────────────────────────────────────────
export function LoadingScreen({ message = 'Loading...' }) {
  return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#111', gap:16 }}>
      <div style={{ width:48, height:48, border:'3px solid #333', borderTop:`3px solid ${COLORS.primary}`, borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <div style={{ color:'#666', fontSize:13 }}>{message}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────
export function EmptyState({ icon='📋', title, subtitle, action }) {
  return (
    <div style={{ textAlign:'center', padding:'60px 24px', color:'#aaa' }}>
      <div style={{ fontSize:44, marginBottom:14 }}>{icon}</div>
      <div style={{ fontSize:16, fontWeight:700, color:'#888', marginBottom:8 }}>{title}</div>
      {subtitle && <div style={{ fontSize:13, marginBottom:20 }}>{subtitle}</div>}
      {action}
    </div>
  );
}

// ─── KPI Stat Card ─────────────────────────────────────────────────────────
export function KPIStatCard({ label, value, sub, color='#111', icon, onClick }) {
  return (
    <div onClick={onClick} style={{ background:'#fff', borderRadius:RADIUS.lg, padding:'14px 16px', border:`1px solid ${COLORS.border}`, cursor:onClick?'pointer':'default', flex:1, minWidth:0 }}>
      {icon && <div style={{ fontSize:18, marginBottom:6 }}>{icon}</div>}
      <div style={{ fontSize:10, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:'monospace', fontSize:20, fontWeight:700, color, lineHeight:1, marginBottom:sub?4:0 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:COLORS.muted, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ─── Trial Banner ──────────────────────────────────────────────────────────
export function TrialBanner({ subscription }) {
  const nav = useNavigate();
  if (!subscription) return null;
  const { status, trialEndsAt, readOnly } = subscription;
  if (status === 'active') return null;

  let msg = '', bg = COLORS.warning, action = null;
  if (status === 'trial') {
    const end = trialEndsAt?.toDate ? trialEndsAt.toDate() : new Date(trialEndsAt);
    const days = Math.max(0, Math.ceil((end - new Date()) / 86400000));
    msg = `Free trial — ${days} day${days!==1?'s':''} remaining`;
    action = <button onClick={()=>nav('/billing')} style={{ background:'rgba(0,0,0,0.2)', color:'#fff', border:'none', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Upgrade</button>;
  } else if (status === 'past_due' || readOnly) {
    msg = 'Account paused — add payment to continue';
    bg  = COLORS.error;
    action = <button onClick={()=>nav('/billing')} style={{ background:'rgba(0,0,0,0.2)', color:'#fff', border:'none', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Fix Now</button>;
  } else if (status === 'none') {
    return null;
  } else {
    return null;
  }

  return (
    <div style={{ background:bg, color:'#fff', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:13, fontWeight:600, flexShrink:0 }}>
      <span>{msg}</span>
      {action}
    </div>
  );
}

// ─── Bottom Navigation ─────────────────────────────────────────────────────
const NAV_ITEMS = [
  { path:'/dashboard', icon:'📊', label:'Home'     },
  { path:'/jobs',      icon:'📋', label:'Jobs'     },
  { path:'/expenses',  icon:'🧾', label:'Expenses' },
  { path:'/payouts',   icon:'💰', label:'Payouts'  },
  { path:'/settings',  icon:'⚙️', label:'Settings' },
];

export function BottomNav() {
  const location = useLocation();
  const nav      = useNavigate();
  const { brandColor } = useBusiness();
  const color = brandColor || COLORS.primary;

  return (
    <nav style={{ position:'fixed', bottom:0, left:0, right:0, background:'#fff', borderTop:`1px solid ${COLORS.border}`, display:'flex', zIndex:100, paddingBottom:'env(safe-area-inset-bottom,0px)' }}>
      {NAV_ITEMS.map(item => {
        const active = location.pathname.startsWith(item.path);
        return (
          <button key={item.path} onClick={() => nav(item.path)}
            style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'10px 0 8px', background:'none', border:'none', cursor:'pointer', gap:2, transition:'opacity .1s' }}>
            <span style={{ fontSize:20 }}>{item.icon}</span>
            <span style={{ fontSize:9, fontWeight: active?700:500, color: active?color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.4px' }}>{item.label}</span>
            {active && <div style={{ width:20, height:2.5, borderRadius:2, background:color, marginTop:2 }}/>}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Screen wrapper ────────────────────────────────────────────────────────
export function Screen({ children, title, action, noPad, noNav }) {
  const { branding, brandColor } = useBusiness();
  const color = brandColor || COLORS.primary;

  return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', background:COLORS.bg, overflow:'hidden' }}>
      {/* Header */}
      {title && (
        <div style={{ background:'#fff', borderBottom:`1px solid ${COLORS.border}`, padding:'16px 20px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, paddingTop:'calc(16px + env(safe-area-inset-top,0px))' }}>
          <div style={{ fontSize:20, fontWeight:700, color:COLORS.dark }}>{title}</div>
          {action}
        </div>
      )}
      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding: noPad ? 0 : '16px', paddingBottom: noNav ? '16px' : '90px' }}>
        {children}
      </div>
      {!noNav && <BottomNav />}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────
export function Card({ children, style={}, onClick }) {
  return (
    <div onClick={onClick} style={{ background:'#fff', borderRadius:RADIUS.lg, border:`1px solid ${COLORS.border}`, boxShadow:SHADOW.card, overflow:'hidden', cursor:onClick?'pointer':'default', ...style }}>
      {children}
    </div>
  );
}

// ─── Section Label ─────────────────────────────────────────────────────────
export function SectionLabel({ children, style={} }) {
  return (
    <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.8px', color:COLORS.muted, marginBottom:8, marginTop:20, ...style }}>{children}</div>
  );
}

// ─── Form Field ───────────────────────────────────────────────────────────
export function FormField({ label: lbl, children, hint }) {
  return (
    <div style={{ marginBottom:16 }}>
      {lbl && <label style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', color:COLORS.muted, marginBottom:6, display:'block' }}>{lbl}</label>}
      {children}
      {hint && <div style={{ fontSize:11, color:COLORS.mutedLight, marginTop:4 }}>{hint}</div>}
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────
export function Toggle({ label: lbl, checked, onChange, color }) {
  const c = color || COLORS.primary;
  return (
    <div onClick={onChange} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', cursor:'pointer', background:'#fff', borderRadius:RADIUS.md }}>
      <span style={{ fontSize:14, color:COLORS.dark }}>{lbl}</span>
      <div style={{ width:44, height:26, borderRadius:13, background:checked?c:'#ddd', transition:'background .2s', position:'relative', flexShrink:0 }}>
        <div style={{ position:'absolute', top:3, left: checked?20:3, width:20, height:20, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s' }}/>
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const map = {
    completed:  { bg:'#f0fdf4', color:'#16a34a', label:'Paid' },
    pending:    { bg:'#fff8f0', color:'#ea580c', label:'Pending' },
    draft:      { bg:'#f5f5f5', color:'#888',    label:'Draft' },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ background:s.bg, color:s.color, borderRadius:6, fontSize:10, fontWeight:700, padding:'3px 10px', textTransform:'uppercase', letterSpacing:'0.5px' }}>{s.label}</span>
  );
}

// ─── Back Button ──────────────────────────────────────────────────────────
export function BackButton({ onClick }) {
  const nav = useNavigate();
  return (
    <button onClick={onClick || (()=>nav(-1))} style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:COLORS.dark, padding:'0 4px', lineHeight:1 }}>←</button>
  );
}

// ─── Inline input styles ──────────────────────────────────────────────────
export const inputStyle = {
  width:'100%', padding:'13px 14px', fontSize:15, border:`1.5px solid ${COLORS.border}`,
  borderRadius:RADIUS.md, background:'#fff', color:COLORS.dark, outline:'none', fontFamily:'inherit',
};
export const selectStyle = { ...inputStyle, appearance:'none' };
