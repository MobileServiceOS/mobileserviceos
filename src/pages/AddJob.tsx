import { useEffect, useMemo, useState } from 'react';
import { useBrand } from '@/context/BrandContext';
import {
  DEFAULT_SERVICE_PRICING,
  DEFAULT_VEHICLE_PRICING,
  EMPTY_JOB,
  LEAD_SOURCES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  TIRE_SOURCES,
} from '@/lib/defaults';
import type { Job, JobStatus, PaymentStatus, Settings, TireSource } from '@/types';
import { calcQuote, haptic, jobGrossProfit, money, serviceIcon, uid } from '@/lib/utils';
import { addToast } from '@/lib/toast';

interface Props {
  settings: Settings;
  prefill: Partial<Job> | null;
  editJob: Job | null;
  saving: boolean;
  onSave: (job: Job, addAnother: boolean) => void;
  onClearPrefill: () => void;
}

export function AddJob({ settings, prefill, editJob, saving, onSave, onClearPrefill }: Props) {
  const { brand } = useBrand();
  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    return Object.keys(sp).filter((k) => sp[k] && sp[k].enabled !== false);
  }, [settings.servicePricing]);

  const [form, setForm] = useState<Job>(() => {
    const base: Job = editJob
      ? { ...editJob }
      : prefill
      ? { ...EMPTY_JOB(), ...(prefill as Partial<Job>) }
      : EMPTY_JOB();
    if (!enabledServices.includes(base.service) && enabledServices.length) base.service = enabledServices[0];
    return base;
  });

  useEffect(() => {
    if (editJob) {
      setForm({ ...editJob });
    } else if (prefill) {
      setForm({ ...EMPTY_JOB(), ...(prefill as Partial<Job>) });
      onClearPrefill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editJob, prefill]);

  const ch = <K extends keyof Job>(k: K, v: Job[K]) => setForm((p) => ({ ...p, [k]: v }));

  const svcs = enabledServices.length ? enabledServices : Object.keys(DEFAULT_SERVICE_PRICING);
  const vehs = Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING);
  const quote = useMemo(() => calcQuote(form, settings), [form, settings]);

  const handleSave = (addAnother: boolean) => {
    if (!form.revenue && form.status !== 'Pending') {
      addToast('Enter a price', 'warn');
      return;
    }
    haptic();
    const finalJob: Job = { ...form, id: form.id || uid() };
    if (finalJob.status === 'Pending' && (!finalJob.paymentStatus || finalJob.paymentStatus === 'Paid')) {
      finalJob.paymentStatus = 'Pending Payment';
    } else if (finalJob.status === 'Cancelled') {
      finalJob.paymentStatus = 'Cancelled';
    } else if (finalJob.status === 'Completed' && finalJob.paymentStatus === 'Cancelled') {
      finalJob.paymentStatus = 'Paid';
    } else if (!finalJob.paymentStatus) {
      finalJob.paymentStatus = 'Paid';
    }
    onSave(finalJob, addAnother);
    if (addAnother) setForm(EMPTY_JOB());
  };

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{editJob ? 'Edit Job' : 'Log New Job'}</div>

      <div className="form-group">
        <div className="form-group-title">Service Details</div>
        <div className="field">
          <label>Service Type</label>
          <div className="chip-row">
            {svcs.map((s) => (
              <button key={s} className={'chip' + (form.service === s ? ' active' : '')} onClick={() => ch('service', s)}>
                {serviceIcon(s)} {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Vehicle Type</label>
          <div className="chip-row">
            {vehs.map((v) => (
              <button key={v} className={'chip' + (form.vehicleType === v ? ' active' : '')} onClick={() => ch('vehicleType', v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => ch('date', e.target.value)} />
          </div>
          <div className="field">
            <label>Area / City</label>
            <input value={form.area} onChange={(e) => ch('area', e.target.value)} placeholder={brand.serviceArea || 'City'} />
          </div>
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Customer</div>
        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input value={form.customerName} onChange={(e) => ch('customerName', e.target.value)} placeholder="Customer name" />
          </div>
          <div className="field">
            <label>Phone</label>
            <input type="tel" value={form.customerPhone} onChange={(e) => ch('customerPhone', e.target.value)} placeholder="Phone" />
          </div>
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Tire Info</div>
        <div className="field-row">
          <div className="field">
            <label>Tire Size</label>
            <input value={form.tireSize} onChange={(e) => ch('tireSize', e.target.value)} placeholder="225/60R18" />
          </div>
          <div className="field">
            <label>Qty</label>
            <input type="number" inputMode="numeric" value={form.qty} onChange={(e) => ch('qty', Number(e.target.value))} />
          </div>
        </div>
        <div className="field">
          <label>Tire Source</label>
          <div className="chip-row">
            {TIRE_SOURCES.map((s) => (
              <button
                key={s}
                className={'chip sm' + (form.tireSource === s ? ' active' : '')}
                onClick={() => ch('tireSource', s as TireSource)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Pricing</div>
        <div className="field-row">
          <div className="field">
            <label>Revenue ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={form.revenue as number | string}
              onChange={(e) => ch('revenue', e.target.value)}
              placeholder={String(quote.suggested)}
            />
          </div>
          <div className="field">
            <label>Tire Cost ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={form.tireCost as number | string}
              onChange={(e) => ch('tireCost', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Material Cost ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={(form.materialCost as number | string) || (form.miscCost as number | string) || ''}
              onChange={(e) => ch('materialCost', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label>Miles</label>
            <input
              type="number"
              inputMode="decimal"
              value={form.miles as number | string}
              onChange={(e) => ch('miles', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        {Number(form.revenue) > 0 && (
          <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--t2)' }}>
            Profit:{' '}
            <span className="value green" style={{ fontSize: 14 }}>
              {money(jobGrossProfit(form, settings))}
            </span>
          </div>
        )}
      </div>

      <div className="form-group">
        <div className="form-group-title">Details</div>
        <div className="field">
          <label>Lead Source</label>
          <div className="src-grid">
            {LEAD_SOURCES.map((s) => (
              <button key={s} className={'src-btn' + (form.source === s ? ' active' : '')} onClick={() => ch('source', s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment Method</label>
          <div className="pay-grid">
            {PAYMENT_METHODS.map((p) => (
              <button key={p} className={'pay-btn' + (form.payment === p ? ' active' : '')} onClick={() => ch('payment', p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Job Status</label>
          <div className="chip-row">
            {(['Completed', 'Pending', 'Cancelled'] as JobStatus[]).map((s) => (
              <button key={s} className={'chip' + (form.status === s ? ' active' : '')} onClick={() => ch('status', s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment Status</label>
          <div className="chip-row">
            {PAYMENT_STATUSES.map((s) => (
              <button
                key={s}
                className={'chip sm' + ((form.paymentStatus || 'Paid') === s ? ' active' : '')}
                onClick={() => ch('paymentStatus', s as PaymentStatus)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {([
            ['emergency', '🚨 Emergency'],
            ['lateNight', '🌙 Late Night'],
            ['highway', '🛣 Highway'],
            ['weekend', '📅 Weekend'],
          ] as const).map(([k, l]) => (
            <button key={k} className={'chip sm' + (form[k] ? ' active' : '')} onClick={() => ch(k, !form[k])}>
              {l}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Notes</label>
          <textarea rows={2} value={form.note || ''} onChange={(e) => ch('note', e.target.value)} placeholder="Optional notes..." />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12, marginBottom: 12 }}>
        <button className="btn primary" onClick={() => handleSave(false)} disabled={saving}>
          {saving ? 'Saving...' : 'Save Job'}
        </button>
        <button className="btn secondary" onClick={() => handleSave(true)} disabled={saving}>
          Save + Another
        </button>
      </div>
    </div>
  );
}
