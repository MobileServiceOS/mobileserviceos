// src/pages/AddJob.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext.jsx';
import { addJob, updateJob, getJob, listenServices, listenAreas } from '../services/businessService.js';
import { computePricingSummary, calculateLaborCost } from '../features/pricing/pricingEngine.js';
import { getModelConfig } from '../features/businessModel/modelConfigs.js';
import { getWeekStart, today, cur } from '../utils/index.js';
import { COLORS, RADIUS } from '../config/theme.js';
import { FormField, Toggle, Card, inputStyle, selectStyle, BackButton } from '../components/index.jsx';

export function AddJob() {
  const nav = useNavigate();
  const { id } = useParams(); // edit mode if id
  const { bizId, modelType, travelPricing, payoutConfig, bizModel, brandColor } = useBusiness();
  const color  = brandColor || COLORS.primary;
  const cfg    = getModelConfig(modelType);
  const isEdit = !!id;

  const [services, setServices] = useState([]);
  const [areas,    setAreas]    = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  // Form state
  const [form, setForm] = useState({
    date:        today(),
    serviceId:   '',
    serviceName: '',
    status:      'completed',
    // Customer
    customerName:  '',
    customerPhone: '',
    // Location
    areaId:    '',
    areaName:  '',
    // Payment
    paymentMethod: 'Cash',
    paymentStatus: 'paid',
    // Travel
    miles:     '',
    roundTrip: false,
    // Conditions
    emergency: false,
    lateNight: false,
    highway:   false,
    weekend:   false,
    // Pricing
    revenue:      '',
    materialCost: '',
    otherJobCost: '',
    // Job details (model-specific)
    tireSize:  '',
    quantity:  '1',
    rimSize:   '',
    // Team
    assignedTeam: [],
    // Notes
    notes: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Load existing job for edit
  useEffect(() => {
    if (!bizId) return;
    const u1 = listenServices(bizId, setServices);
    const u2 = listenAreas(bizId, setAreas);
    return () => { u1(); u2(); };
  }, [bizId]);

  useEffect(() => {
    if (!id || !bizId) return;
    setLoading(true);
    getJob(bizId, id).then(job => {
      if (!job) return;
      setForm({
        date:          job.date || today(),
        serviceId:     job.serviceId || '',
        serviceName:   job.serviceName || '',
        status:        job.status || 'completed',
        customerName:  job.customer?.name  || '',
        customerPhone: job.customer?.phone || '',
        areaId:        job.location?.areaId   || '',
        areaName:      job.location?.areaName || '',
        paymentMethod: job.payment?.method || 'Cash',
        paymentStatus: job.payment?.status || 'paid',
        miles:         String(job.travel?.miles || ''),
        roundTrip:     job.travel?.roundTrip || false,
        emergency:     job.conditions?.emergency || false,
        lateNight:     job.conditions?.lateNight || false,
        highway:       job.conditions?.highway   || false,
        weekend:       job.conditions?.weekend   || false,
        revenue:       String(job.pricing?.revenue || ''),
        materialCost:  String(job.pricing?.materialCost || ''),
        otherJobCost:  String(job.pricing?.otherJobCost || ''),
        tireSize:      job.jobDetails?.data?.tireSize  || '',
        quantity:      String(job.jobDetails?.data?.quantity || '1'),
        rimSize:       job.jobDetails?.data?.rimSize   || '',
        assignedTeam:  job.assignedTeam || [],
        notes:         job.notes || '',
      });
      setLoading(false);
    });
  }, [id, bizId]);

  // Live pricing
  const selectedService = useMemo(() =>
    services.find(s => s.id === form.serviceId) || null
  , [services, form.serviceId]);

  const pricing = useMemo(() => {
    if (!selectedService && !form.revenue) return null;
    return computePricingSummary({
      service:          selectedService,
      revenue:          parseFloat(form.revenue) || 0,
      materialCost:     parseFloat(form.materialCost) || 0,
      otherJobCost:     parseFloat(form.otherJobCost) || 0,
      assignedTeam:     form.assignedTeam,
      miles:            parseFloat(form.miles) || 0,
      conditions:       { emergency: form.emergency, lateNight: form.lateNight, highway: form.highway, weekend: form.weekend },
      modelType,
      travelConfig:     travelPricing || {},
      monthlyOverhead:  bizModel?.monthlyOverhead || 0,
      expectedJobsPerDay: 4,
    });
  }, [form, selectedService, travelPricing, modelType, bizModel]);

  const team = payoutConfig?.team || [];
  const perJobMembers = team.filter(m => m.active && m.payType === 'per_job');

  const handleSave = async () => {
    if (!form.serviceId) { setError('Select a service.'); return; }
    if (!form.revenue)   { setError('Enter the job revenue.'); return; }
    setSaving(true); setError('');
    try {
      const miles  = parseFloat(form.miles) || 0;
      const weekStartDay = payoutConfig?.weekStartDay ?? 5;
      const jobData = {
        businessId:  bizId,
        date:        form.date,
        serviceId:   form.serviceId,
        serviceName: form.serviceName,
        status:      form.status,
        customer: { name: form.customerName, phone: form.customerPhone },
        location: { areaId: form.areaId, areaName: form.areaName },
        payment:  { method: form.paymentMethod, status: form.paymentStatus },
        travel: {
          miles, roundTrip: form.roundTrip,
          bandLabel: pricing ? null : null,
        },
        conditions: { emergency: form.emergency, lateNight: form.lateNight, highway: form.highway, weekend: form.weekend },
        pricing: {
          revenue:      parseFloat(form.revenue) || 0,
          materialCost: parseFloat(form.materialCost) || 0,
          otherJobCost: parseFloat(form.otherJobCost) || 0,
          laborCost:    pricing?.laborCost || 0,
          travelFee:    pricing?.travelFee || 0,
          travelCost:   pricing?.travelCost || 0,
          netProfit:    pricing?.netProfit || 0,
        },
        jobDetails: {
          modelType,
          data: modelType === 'tire_service' ? {
            tireSize: form.tireSize, quantity: parseInt(form.quantity)||1, rimSize: form.rimSize,
          } : {},
        },
        assignedTeam: form.assignedTeam,
        notes:        form.notes,
        weekKey:      getWeekStart(form.date, weekStartDay),
      };

      if (isEdit) {
        await updateJob(bizId, id, jobData);
      } else {
        await addJob(bizId, jobData);
      }
      nav('/jobs');
    } catch(e) { setError(e.message || 'Failed to save job.'); }
    setSaving(false);
  };

  const inp = { ...inputStyle };
  const sel = { ...inp, appearance:'none' };

  if (loading) return null;

  return (
    <div style={{ height:'100dvh', display:'flex', flexDirection:'column', background:COLORS.bg, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ background:'#fff', borderBottom:`1px solid ${COLORS.border}`, padding:'16px 20px 14px', display:'flex', alignItems:'center', gap:12, flexShrink:0, paddingTop:'calc(16px + env(safe-area-inset-top,0px))' }}>
        <BackButton/>
        <div style={{ fontSize:18, fontWeight:700, flex:1 }}>{isEdit?'Edit Job':'New Job'}</div>
        {pricing && (
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:COLORS.muted }}>Net Profit</div>
            <div style={{ fontFamily:'monospace', fontSize:16, fontWeight:700, color:pricing.netProfit>=0?COLORS.success:COLORS.error }}>{cur(pricing.netProfit)}</div>
          </div>
        )}
      </div>

      {/* Scrollable form */}
      <div style={{ flex:1, overflowY:'auto', padding:16, paddingBottom:100 }}>

        {error && <div style={{ background:'#fee2e2', color:COLORS.error, borderRadius:RADIUS.md, padding:'10px 14px', marginBottom:16, fontSize:13, fontWeight:600 }}>{error}</div>}

        {/* Date + Service */}
        <Card style={{ padding:16, marginBottom:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <FormField label="Date">
              <input type="date" value={form.date} onChange={e=>set('date',e.target.value)} style={inp}/>
            </FormField>
            <FormField label="Status">
              <select value={form.status} onChange={e=>set('status',e.target.value)} style={sel}>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </FormField>
          </div>
          <FormField label="Service">
            <select value={form.serviceId} onChange={e=>{
              const svc = services.find(s=>s.id===e.target.value);
              set('serviceId',e.target.value);
              if(svc){ set('serviceName',svc.name); if(!form.revenue) set('revenue',String(svc.basePrice||'')); }
            }} style={sel}>
              <option value="">Select service...</option>
              {services.filter(s=>s.active!==false).map(s=>(<option key={s.id} value={s.id}>{s.name} — {cur(s.basePrice)}</option>))}
            </select>
          </FormField>
        </Card>

        {/* Customer */}
        <Card style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:12 }}>Customer</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FormField label="Name">
              <input value={form.customerName} onChange={e=>set('customerName',e.target.value)} style={inp} placeholder="Optional"/>
            </FormField>
            <FormField label="Phone">
              <input type="tel" value={form.customerPhone} onChange={e=>set('customerPhone',e.target.value)} style={inp} placeholder="Optional"/>
            </FormField>
          </div>
          <FormField label="Service Area">
            <select value={form.areaId} onChange={e=>{
              const area = areas.find(a=>a.id===e.target.value);
              set('areaId',e.target.value);
              if(area) set('areaName',area.name);
            }} style={sel}>
              <option value="">Select area...</option>
              {areas.map(a=>(<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </FormField>
        </Card>

        {/* Model-specific fields */}
        {modelType === 'tire_service' && (
          <Card style={{ padding:16, marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:12 }}>Tire Details</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12 }}>
              <FormField label="Tire Size">
                <input value={form.tireSize} onChange={e=>set('tireSize',e.target.value)} style={inp} placeholder="e.g. 225/55R17"/>
              </FormField>
              <FormField label="Qty">
                <input type="number" min="1" value={form.quantity} onChange={e=>set('quantity',e.target.value)} style={{...inp,width:64,textAlign:'center'}}/>
              </FormField>
            </div>
          </Card>
        )}

        {/* Travel */}
        <Card style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:12 }}>Travel</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
            <FormField label="Miles">
              <input type="number" min="0" step="0.1" value={form.miles} onChange={e=>set('miles',e.target.value)} style={inp} placeholder="0"/>
            </FormField>
            <FormField label="Travel Fee">
              <div style={{ padding:'13px 14px', border:`1.5px solid ${COLORS.border}`, borderRadius:RADIUS.md, background:COLORS.bg, fontFamily:'monospace', fontSize:15, color:COLORS.muted }}>
                {cur(pricing?.travelFee || 0)}
              </div>
            </FormField>
          </div>
          {pricing && parseFloat(form.miles) > 0 && (
            <div style={{ fontSize:12, color:COLORS.muted, padding:'8px 12px', background:COLORS.bg, borderRadius:RADIUS.sm }}>
              Travel cost (internal): {cur(pricing.travelCost)} · Fee to customer: {cur(pricing.travelFee)}
            </div>
          )}
          <div style={{ marginTop:8 }}>
            <Toggle label="Round Trip" checked={form.roundTrip} onChange={()=>set('roundTrip',!form.roundTrip)} color={color}/>
          </div>
        </Card>

        {/* Conditions */}
        <Card style={{ marginBottom:12, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px 4px', fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px' }}>Conditions</div>
          {Object.entries(cfg.conditions).map(([key, cond]) => {
            const mod = cfg.pricingModifiers[key] || 0;
            return (
              <div key={key} style={{ borderTop:`1px solid ${COLORS.border}` }}>
                <Toggle label={`${cond.label}${mod?` (+$${mod})`:''}`} checked={form[key]} onChange={()=>set(key,!form[key])} color={color}/>
              </div>
            );
          })}
        </Card>

        {/* Pricing */}
        <Card style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:12 }}>Pricing</div>

          {/* Pricing guide */}
          {selectedService && (
            <div style={{ background:COLORS.bg, borderRadius:RADIUS.md, padding:'10px 12px', marginBottom:12, display:'flex', gap:16, flexWrap:'wrap' }}>
              <div style={{ fontSize:12, color:COLORS.muted }}>Min: <strong style={{color:'#111'}}>{cur(pricing?.minP||0)}</strong></div>
              <div style={{ fontSize:12, color:COLORS.muted }}>Suggested: <strong style={{color:color}}>{cur(pricing?.suggested||0)}</strong></div>
              {pricing && form.revenue && (
                <div style={{ fontSize:12, color:pricing.margin?.color, fontWeight:700 }}>{pricing.margin?.emoji} {pricing.margin?.label}</div>
              )}
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FormField label="Revenue ($)">
              <input type="number" min="0" step="0.01" value={form.revenue} onChange={e=>set('revenue',e.target.value)} style={{...inp,fontFamily:'monospace'}} placeholder="0.00"/>
            </FormField>
            <FormField label="Material Cost ($)">
              <input type="number" min="0" step="0.01" value={form.materialCost} onChange={e=>set('materialCost',e.target.value)} style={{...inp,fontFamily:'monospace'}} placeholder="0.00"/>
            </FormField>
            <FormField label="Other Job Cost ($)">
              <input type="number" min="0" step="0.01" value={form.otherJobCost} onChange={e=>set('otherJobCost',e.target.value)} style={{...inp,fontFamily:'monospace'}} placeholder="0.00"/>
            </FormField>
            <FormField label="Net Profit">
              <div style={{ padding:'13px 14px', border:`1.5px solid ${COLORS.border}`, borderRadius:RADIUS.md, background:COLORS.bg, fontFamily:'monospace', fontSize:16, fontWeight:700, color:pricing&&pricing.netProfit>=0?COLORS.success:COLORS.error }}>
                {pricing ? cur(pricing.netProfit) : '—'}
              </div>
            </FormField>
          </div>
        </Card>

        {/* Payment */}
        <Card style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:12 }}>Payment</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FormField label="Method">
              <select value={form.paymentMethod} onChange={e=>set('paymentMethod',e.target.value)} style={sel}>
                {['Cash','Card','Zelle','Venmo','CashApp','Check','Other'].map(m=><option key={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="Status">
              <select value={form.paymentStatus} onChange={e=>set('paymentStatus',e.target.value)} style={sel}>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
            </FormField>
          </div>
        </Card>

        {/* Per-job team */}
        {perJobMembers.length > 0 && (
          <Card style={{ padding:16, marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:12 }}>Team Assignment</div>
            {perJobMembers.map(m => {
              const isAssigned = form.assignedTeam.find(a=>a.memberId===m.id);
              return (
                <div key={m.id} onClick={()=>{
                  if(isAssigned) set('assignedTeam', form.assignedTeam.filter(a=>a.memberId!==m.id));
                  else set('assignedTeam', [...form.assignedTeam, { memberId:m.id, name:m.name, payType:m.payType, value:m.value }]);
                }} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', borderRadius:RADIUS.md, background:isAssigned?'#f0fdf4':COLORS.bg, marginBottom:6, cursor:'pointer', border:`1.5px solid ${isAssigned?COLORS.success:COLORS.border}` }}>
                  <span style={{ fontSize:14, color:'#111' }}>{m.name} — <span style={{color:COLORS.muted}}>${m.value}/job</span></span>
                  <span style={{ fontSize:18 }}>{isAssigned?'✅':'⬜'}</span>
                </div>
              );
            })}
          </Card>
        )}

        {/* Notes */}
        <Card style={{ padding:16, marginBottom:12 }}>
          <FormField label="Notes">
            <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} style={{...inp,minHeight:72,resize:'vertical'}} placeholder="Optional notes..."/>
          </FormField>
        </Card>
      </div>

      {/* Sticky Save */}
      <div style={{ padding:'12px 16px', paddingBottom:'calc(12px + env(safe-area-inset-bottom,0px))', background:'#fff', borderTop:`1px solid ${COLORS.border}`, flexShrink:0 }}>
        <button onClick={handleSave} disabled={saving} style={{ width:'100%', background:color, color:'#fff', border:'none', borderRadius:RADIUS.md, padding:'16px', fontSize:16, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          {saving?'Saving...':(isEdit?'Save Changes':'Save Job')}
        </button>
      </div>
    </div>
  );
}
