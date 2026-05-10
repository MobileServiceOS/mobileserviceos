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
import type { InventoryItem, Job, JobStatus, PaymentStatus, Settings, TireSource } from '@/types';
import { calcQuote, haptic, money, planInventoryDeduction, r2, serviceIcon, uid } from '@/lib/utils';
import { computeBreakdown } from '@/lib/pricing';
import { addToast } from '@/lib/toast';
import { CityStateSelect } from '@/components/CityStateSelect';

interface Props {
  settings: Settings;
  inventory: InventoryItem[];
  prefill: Partial<Job> | null;
  editJob: Job | null;
  saving: boolean;
  onSave: (job: Job, addAnother: boolean) => void;
  onClearPrefill: () => void;
}

export function AddJob({ settings, inventory, prefill, editJob, saving, onSave, onClearPrefill }: Props) {
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
    if (!base.state && brand.state) base.state = brand.state;
    if (!base.city && brand.mainCity) base.city = brand.mainCity;
    if (!base.area && brand.mainCity) base.area = brand.mainCity;
    return base;
  });

  useEffect(() => {
    if (editJob) {
      setForm({ ...editJob });
    } else if (prefill) {
      const p = prefill as Partial<Job>;
      setForm({
        ...EMPTY_JOB(),
        ...p,
        state: p.state || brand.state || '',
        city: p.city || brand.mainCity || '',
        area: p.area || brand.mainCity || '',
      });
      onClearPrefill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editJob, prefill]);

  const ch = <K extends keyof Job>(k: K, v: Job[K]) => setForm((p) => ({ ...p, [k]: v }));

  const svcs = enabledServices.length ? enabledServices : Object.keys(DEFAULT_SERVICE_PRICING);
  const vehs = Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING);
  const quote = useMemo(() => calcQuote(form, settings), [form, settings]);

  // Inventory-derived tire cost preview
  const inventoryPlan = useMemo(() => {
    if (form.tireSource !== 'Inventory' || !form.tireSize || !Number(form.qty || 0)) return null;
    return planInventoryDeduction(form.tireSize, Number(form.qty), inventory);
  }, [form.tireSource, form.tireSize, form.qty, inventory]);

  const effectiveTireCost = useMemo(() => {
    if (inventoryPlan && inventoryPlan.deductions.length) {
      return r2(
        inventoryPlan.deductions.reduce((t, d) => t + Number(d.cost || 0) * Number(d.qty || 0), 0)
      );
    }
    return Number(form.tireCost || 0);
  }, [inventoryPlan, form.tireCost]);

  const previewJob: Job = useMemo(
    () => (inventoryPlan && inventoryPlan.deductions.length ? { ...form, tireCost: effectiveTireCost } : form),
    [form, inventoryPlan, effectiveTireCost]
  );

  const breakdown = useMemo(() => computeBreakdown(previewJob, settings), [previewJob, settings]);

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
    <div className="page page-enter add-job-page">
      <div className="page-title-row">
        <div style={{ fontSize: 18, fontWeight: 700 }}>{editJob ? 'Edit Job' : 'Log New Job'}</div>
        {prefill ? <span className="pill blue">From Quick Quote</span> : null}
      </div>

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
            <label>Lead Source</label>
            <select value={form.source} onChange={(e) => ch('source', e.target.value)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Location</div>
        <CityStateSelect
          city={form.city || ''}
          state={form.state || ''}
          onChange={({ city, state, fullLocationLabel }) => {
            setForm((p) => ({
              ...p,
              city,
              state,
              fullLocationLabel,
              area: city || p.area, // keep legacy `area` field in sync
            }));
          }}
        />
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
            <label>
              Tire Cost ($)
              {inventoryPlan && inventoryPlan.deductions.length ? (
                <span style={{ marginLeft: 8, color: 'var(--brand-primary)', fontWeight: 700 }}>
                  · auto from inventory
                </span>
              ) : null}
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={
                inventoryPlan && inventoryPlan.deductions.length
                  ? effectiveTireCost
                  : (form.tireCost as number | string)
              }
              onChange={(e) => ch('tireCost', e.target.value)}
              placeholder="0"
              disabled={!!(inventoryPlan && inventoryPlan.deductions.length)}
              style={
                inventoryPlan && inventoryPlan.deductions.length
                  ? { opacity: 0.7, cursor: 'not-allowed' }
                  : undefined
              }
            />
            {inventoryPlan && inventoryPlan.shortfall > 0 ? (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                Short {inventoryPlan.shortfall} of {form.tireSize} in stock
              </div>
            ) : null}
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

        {/* Pricing breakdown panel */}
        <div className="pricing-breakdown">
          <div className="pricing-breakdown-title">Profit Breakdown</div>
          <div className="pricing-breakdown-row">
            <span>Revenue</span>
            <span className="num green">{money(breakdown.revenue)}</span>
          </div>
          <div className="pricing-breakdown-row sub">
            <span>− Tire cost</span>
            <span className="num red">{money(breakdown.tireCost)}</span>
          </div>
          <div className="pricing-breakdown-row sub">
            <span>− Material cost</span>
            <span className="num red">{money(breakdown.materialCost)}</span>
          </div>
          <div className="pricing-breakdown-row sub">
            <span>
              − Travel ({breakdown.travelChargeable.toFixed(0)} mi
              {breakdown.freeMilesIncluded ? `, ${breakdown.freeMilesIncluded} free` : ''})
            </span>
            <span className="num red">{money(breakdown.travelCost)}</span>
          </div>
          <div className="pricing-breakdown-row total">
            <span>Profit</span>
            <span className={'num ' + (breakdown.profit >= 0 ? 'green' : 'red')}>{money(breakdown.profit)}</span>
          </div>
          {breakdown.revenue > 0 ? (
            <div className="pricing-breakdown-margin">
              {Math.round(breakdown.profitMargin * 100)}% margin
            </div>
          ) : null}
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Details</div>
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

      {/* Sticky save footer */}
      <div className="save-footer-spacer" />
      <div className="save-footer">
        <div className="save-footer-summary">
          <div className="save-footer-summary-label">Profit on save</div>
          <div className={'save-footer-summary-value ' + (breakdown.profit >= 0 ? 'green' : 'red')}>
            {money(breakdown.profit)}
          </div>
        </div>
        <div className="save-footer-actions">
          <button className="btn secondary" onClick={() => handleSave(true)} disabled={saving}>
            + Another
          </button>
          <button className="btn primary save-primary" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? 'Saving…' : editJob ? 'Save Changes' : 'Save Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
