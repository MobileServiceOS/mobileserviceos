// src/pages/Invoices.jsx
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext.jsx';
import { getJob } from '../services/businessService.js';
import { cur, formatDate } from '../utils/index.js';
import { Screen, Card, BackButton } from '../components/index.jsx';
import { COLORS, RADIUS } from '../config/theme.js';

// ─── Invoice for a specific job ────────────────────────────────────────────
export function InvoiceView() {
  const { jobId } = useParams();
  const { bizId, branding, profile, brandColor } = useBusiness();
  const color = brandColor || COLORS.primary;
  const nav   = useNavigate();
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (!bizId || !jobId) return;
    getJob(bizId, jobId).then(setJob);
  }, [bizId, jobId]);

  if (!job) return null;

  const biz = branding?.businessName || 'Your Business';
  const inv = 'INV-' + String(job.id).slice(-6).toUpperCase();
  const p   = job.pricing || {};

  const handleShare = async () => {
    const html = buildInvoiceHtml({ job, biz, profile, branding, color, inv });
    const blob  = new Blob([html], { type:'text/html' });
    const file  = new File([blob], `Invoice-${inv}.html`, { type:'text/html' });
    if (navigator.canShare && navigator.canShare({ files:[file] })) {
      try { await navigator.share({ title:`Invoice ${inv}`, files:[file] }); return; } catch(e){}
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(()=>URL.revokeObjectURL(url), 15000);
  };

  const handlePrint = () => {
    const html = buildInvoiceHtml({ job, biz, profile, branding, color, inv });
    const blob  = new Blob([html], { type:'text/html' });
    const url   = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(()=>URL.revokeObjectURL(url), 15000);
  };

  return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', background:COLORS.bg }}>
      {/* Header */}
      <div style={{ background:'#111', padding:'16px 20px 14px', display:'flex', alignItems:'center', gap:12, paddingTop:'calc(16px + env(safe-area-inset-top,0px))' }}>
        <BackButton onClick={()=>nav(-1)}/>
        <div style={{ flex:1, color:'#fff', fontSize:18, fontWeight:700 }}>Invoice {inv}</div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16, paddingBottom:100 }}>
        {/* Status */}
        <div style={{ background:'#1a1a1a', borderRadius:RADIUS.lg, padding:'20px', textAlign:'center', marginBottom:12 }}>
          <div style={{ color:'#888', fontSize:10, textTransform:'uppercase', letterSpacing:'1.5px', marginBottom:6 }}>Total Amount</div>
          <div style={{ fontFamily:'monospace', fontSize:40, fontWeight:700, color: job.payment?.status==='paid'?'#4ade80':'#fff' }}>{cur(p.revenue)}</div>
          <div style={{ fontSize:12, color:'#555', marginTop:6 }}>{formatDate(job.date)} · {job.location?.areaName}</div>
        </div>

        {/* Business info */}
        <Card style={{ padding:14, marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {branding?.logoUrl ? <img src={branding.logoUrl} style={{ width:44, height:44, borderRadius:10, objectFit:'contain' }} alt="logo"/> : <div style={{ width:44, height:44, background:color, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>🛞</div>}
            <div>
              <div style={{ fontSize:15, fontWeight:700 }}>{biz}</div>
              {profile?.phone && <div style={{ fontSize:12, color:COLORS.muted }}>{profile.phone}</div>}
            </div>
          </div>
        </Card>

        {/* Customer */}
        {(job.customer?.name||job.customer?.phone) && (
          <Card style={{ padding:14, marginBottom:10 }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.6px', color:color, marginBottom:8 }}>Bill To</div>
            {job.customer?.name && <div style={{ fontSize:15, fontWeight:700 }}>{job.customer.name}</div>}
            {job.customer?.phone && <div style={{ fontSize:13, color:COLORS.muted }}>{job.customer.phone}</div>}
          </Card>
        )}

        {/* Line items */}
        <Card style={{ marginBottom:10, overflow:'hidden' }}>
          <div style={{ padding:'10px 14px', background:COLORS.bg, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.6px', color:color }}>Service Details</div>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${COLORS.border}`, display:'flex', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700 }}>{job.serviceName}</div>
              {job.jobDetails?.data?.tireSize && <div style={{ fontSize:12, color:COLORS.muted }}>{job.jobDetails.data.tireSize}{job.jobDetails.data.quantity>1?` × ${job.jobDetails.data.quantity}`:''}</div>}
              <div style={{ fontSize:12, color:COLORS.muted }}>{job.location?.areaName}</div>
            </div>
            <div style={{ fontFamily:'monospace', fontSize:15, fontWeight:700 }}>{cur(p.revenue)}</div>
          </div>
          {p.travelFee > 0 && <div style={{ padding:'10px 14px', borderBottom:`1px solid ${COLORS.border}`, display:'flex', justifyContent:'space-between', fontSize:13 }}>
            <span style={{ color:COLORS.muted }}>Travel Fee</span><span style={{ fontFamily:'monospace', fontWeight:600 }}>{cur(p.travelFee)}</span>
          </div>}
          <div style={{ padding:'12px 14px', background:'#111', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ color:'#fff', fontWeight:700 }}>Total Due</span>
            <span style={{ fontFamily:'monospace', fontSize:20, fontWeight:700, color:'#4ade80' }}>{cur(p.revenue)}</span>
          </div>
        </Card>

        {/* Payment */}
        <Card style={{ padding:14, marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.6px', color:color, marginBottom:8 }}>Payment</div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
            <span style={{ color:COLORS.muted }}>Method</span>
            <span style={{ fontWeight:600 }}>{job.payment?.method}</span>
          </div>
          {profile?.zelleInfo && job.payment?.status==='pending' && (
            <div style={{ background:'#6d1ed4', borderRadius:RADIUS.md, padding:14, marginTop:12 }}>
              <div style={{ color:'#fff', fontWeight:700, marginBottom:4 }}>Pay via Zelle</div>
              <div style={{ color:'#c4b5fd', fontSize:12, marginBottom:8 }}>Send {cur(p.revenue)} to:</div>
              <div style={{ background:'rgba(255,255,255,0.12)', borderRadius:8, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#fff', fontFamily:'monospace', fontSize:15, fontWeight:700 }}>{profile.zelleInfo}</span>
                <button onClick={()=>navigator.clipboard?.writeText(profile.zelleInfo).then(()=>alert('Copied!'))} style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'#fff', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>Copy</button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Action buttons */}
      <div style={{ padding:'12px 16px', paddingBottom:'calc(12px + env(safe-area-inset-bottom,0px))', background:'#fff', borderTop:`1px solid ${COLORS.border}`, display:'flex', gap:10 }}>
        <button onClick={handleShare} style={{ flex:1, background:'#111', color:'#fff', border:'none', borderRadius:RADIUS.md, padding:'14px', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>📤 Send to Customer</button>
        <button onClick={handlePrint} style={{ flex:1, background:COLORS.bg, color:'#111', border:`1.5px solid ${COLORS.border}`, borderRadius:RADIUS.md, padding:'14px', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>🖨️ Print / PDF</button>
      </div>
    </div>
  );
}

// ─── Invoice HTML builder ──────────────────────────────────────────────────
function buildInvoiceHtml({ job, biz, profile, branding, color, inv }) {
  const p = job.pricing || {};
  const paid = job.payment?.status === 'paid';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${inv}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f4f4f4;padding:20px}.page{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden}.hdr{background:#111;padding:24px 28px;border-bottom:3px solid ${color}}.brand{color:#fff;font-size:22px;font-weight:700}.sub{color:#666;font-size:12px;margin-top:3px}.hero{background:#1a1a1a;padding:28px;text-align:center}.hero-lbl{color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px}.hero-amt{font-family:monospace;font-size:44px;font-weight:700;color:${paid?'#4ade80':'#fff'}}.hero-note{font-size:12px;margin-top:8px;color:${paid?'#4ade80':'#666'}}.body{padding:0 28px}.section{padding:18px 0;border-bottom:1px solid #f0f0f0}.sec-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${color};margin-bottom:10px}.row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}.row .lbl{color:#888}.row .val{font-family:monospace;font-weight:600}.total{background:#111;padding:14px 28px;display:flex;justify-content:space-between}.total .lbl{color:#fff;font-size:14px;font-weight:700}.total .val{font-family:monospace;font-size:22px;font-weight:700;color:#4ade80}.footer{text-align:center;padding:20px 28px;color:#aaa;font-size:11px;line-height:2}.print-btn{display:block;margin:16px auto;background:#111;color:#fff;border:none;border-radius:8px;padding:12px 32px;font-size:15px;cursor:pointer;font-weight:bold}@media print{.print-btn{display:none}body{background:#fff;padding:0}.page{box-shadow:none;border-radius:0}}</style></head><body><div class="page"><div class="hdr"><div class="brand">${biz}</div><div class="sub">${branding?.tagline||'Mobile Service'}</div></div><div style="background:rgba(255,255,255,.06);border-top:1px solid rgba(255,255,255,.08);padding:10px 28px;display:flex;justify-content:space-between;background:#1a1a1a"><div><div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px">Invoice</div><div style="color:#fff;font-family:monospace;font-size:16px;font-weight:700;margin-top:3px">#${inv}</div></div><div><div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px">Status</div><span style="background:${paid?'#16a34a':'#ea580c'};color:#fff;border-radius:6px;font-size:10px;padding:3px 10px;font-weight:700;display:inline-block;margin-top:4px">${paid?'PAID':'PAYMENT DUE'}</span></div></div><div class="hero"><div class="hero-lbl">Total Amount</div><div class="hero-amt">${cur(p.revenue)}</div><div class="hero-note">${paid?'Payment received — Thank you!':'Please remit payment'}</div></div><div style="padding:10px 28px;display:flex;justify-content:space-between;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888"><span>${profile?.phone||''}</span><span>${profile?.email||''}</span></div><div class="body">${job.customer?.name||job.customer?.phone?`<div class="section"><div class="sec-title">Bill To</div>${job.customer.name?`<div style="font-size:15px;font-weight:700">${job.customer.name}</div>`:''}${job.customer.phone?`<div style="font-size:13px;color:#888">${job.customer.phone}</div>`:''}</div>`:''}<div class="section"><div class="sec-title">Service</div><div class="row"><span class="lbl">${job.serviceName}</span><span class="val">${cur(p.revenue)}</span></div>${job.jobDetails?.data?.tireSize?`<div class="row"><span class="lbl">Tire Size</span><span class="val">${job.jobDetails.data.tireSize}</span></div>`:''}<div class="row"><span class="lbl">Location</span><span class="val">${job.location?.areaName||''}</span></div><div class="row"><span class="lbl">Date</span><span class="val">${formatDate(job.date)}</span></div></div></div><div class="total"><span class="lbl">Total Due</span><span class="val">${cur(p.revenue)}</span></div>${!paid&&profile?.zelleInfo?`<div class="body"><div class="section"><div style="background:#6d1ed4;border-radius:10px;padding:16px"><div style="color:#fff;font-weight:700;font-size:14px">Pay with Zelle</div><div style="color:#c4b5fd;font-size:11px;margin-top:3px">Send ${cur(p.revenue)} to:</div><div style="background:rgba(255,255,255,.12);border-radius:7px;padding:11px 14px;margin-top:10px;font-family:monospace;font-size:17px;font-weight:700;color:#fff">${profile.zelleInfo}</div></div></div></div>`:''}<button class="print-btn" onclick="window.print()">Print / Save as PDF</button><div class="footer"><strong>${biz}</strong><br>${profile?.phone||''} · ${profile?.email||''}<br>${profile?.website||''}</div></div></body></html>`;
}
