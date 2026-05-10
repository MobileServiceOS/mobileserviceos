import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { _auth, uploadLogo } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { addToast } from '@/lib/toast';
import { isValidHex } from '@/lib/utils';
import { DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING, APP_LOGO } from '@/lib/defaults';
import { CityStateSelect } from '@/components/CityStateSelect';
import type { Settings as SettingsT, ServicePricing } from '@/types';

interface Props {
  settings: SettingsT;
  inventoryCount: number;
  jobsCount: number;
  onSaveSettings: (next: Partial<SettingsT>) => void;
}

type Section = 'brand' | 'business' | 'pricing' | 'data' | 'account';

export function Settings({ settings, inventoryCount, jobsCount, onSaveSettings }: Props) {
  const { brand, businessId, updateBrand } = useBrand();
  const [section, setSection] = useState<Section>('brand');
  const [logoBusy, setLogoBusy] = useState(false);

  const handleLogoUpload = async (file: File) => {
    if (!businessId) {
      addToast('Sign in required', 'warn');
      return;
    }
    setLogoBusy(true);
    try {
      const url = await uploadLogo(businessId, file);
      if (url) {
        await updateBrand({ logoUrl: url });
        addToast('Logo updated', 'success');
      }
    } catch (e) {
      addToast((e as Error).message || 'Logo upload failed', 'error');
    } finally {
      setLogoBusy(false);
    }
  };

  const sections: { id: Section; label: string }[] = [
    { id: 'brand', label: 'Brand' },
    { id: 'business', label: 'Business' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'data', label: 'Data' },
    { id: 'account', label: 'Account' },
  ];

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Settings</div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, WebkitOverflowScrolling: 'touch' }}>
        {sections.map((s) => (
          <button
            key={s.id}
            className={'chip' + (section === s.id ? ' active' : '')}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'brand' && (
        <BrandSection brand={brand} onUpdate={updateBrand} onUploadLogo={handleLogoUpload} logoBusy={logoBusy} />
      )}
      {section === 'business' && <BusinessSection settings={settings} onSave={onSaveSettings} />}
      {section === 'pricing' && <PricingSection settings={settings} onSave={onSaveSettings} />}
      {section === 'data' && <DataSection inventoryCount={inventoryCount} jobsCount={jobsCount} />}
      {section === 'account' && <AccountSection />}
    </div>
  );
}

function BrandSection({
  brand,
  onUpdate,
  onUploadLogo,
  logoBusy,
}: {
  brand: ReturnType<typeof useBrand>['brand'];
  onUpdate: (u: Partial<ReturnType<typeof useBrand>['brand']>) => Promise<void>;
  onUploadLogo: (f: File) => void;
  logoBusy: boolean;
}) {
  const [draft, setDraft] = useState(brand);
  const [dirty, setDirty] = useState(false);

  const change = <K extends keyof typeof brand>(k: K, v: (typeof brand)[K]) => {
    setDraft((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  const save = () => {
    if (!isValidHex(draft.primaryColor) || !isValidHex(draft.accentColor)) {
      addToast('Enter valid hex colors (e.g. #c8a44a)', 'warn');
      return;
    }
    onUpdate(draft);
    setDirty(false);
    addToast('Brand saved', 'success');
  };

  return (
    <>
      <div className="form-group">
        <div className="form-group-title">Logo</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <img
            src={draft.logoUrl || APP_LOGO}
            alt=""
            style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'contain', background: 'var(--s3)' }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = APP_LOGO;
            }}
          />
          <div style={{ flex: 1 }}>
            <input
              type="file"
              accept="image/*"
              id="logo-upload"
              style={{ display: 'none' }}
              disabled={logoBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadLogo(f);
              }}
            />
            <label htmlFor="logo-upload" className="btn sm secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>
              {logoBusy ? 'Uploading...' : 'Upload Logo'}
            </label>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>PNG/JPG · Max 5MB · Square recommended</div>
          </div>
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Brand Identity</div>
        <div className="field">
          <label>Business Name</label>
          <input value={draft.businessName} onChange={(e) => change('businessName', e.target.value)} />
        </div>
        <div className="field">
          <label>Tagline</label>
          <input value={draft.tagline} onChange={(e) => change('tagline', e.target.value)} placeholder="Optional tagline" />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Primary Color</label>
            <input
              value={draft.primaryColor}
              onChange={(e) => change('primaryColor', e.target.value)}
              placeholder="#c8a44a"
            />
          </div>
          <div className="field">
            <label>Accent Color</label>
            <input value={draft.accentColor} onChange={(e) => change('accentColor', e.target.value)} placeholder="#e5c770" />
          </div>
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Contact</div>
        <div className="field">
          <label>Phone</label>
          <input value={draft.phone} onChange={(e) => change('phone', e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={draft.email} onChange={(e) => change('email', e.target.value)} />
        </div>
        <div className="field">
          <label>Website</label>
          <input value={draft.website} onChange={(e) => change('website', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Service Area</div>
        <CityStateSelect
          state={draft.state || ''}
          city={draft.mainCity || ''}
          onChange={({ city, state, fullLocationLabel }) => {
            setDraft((p) => ({ ...p, mainCity: city, state, fullLocationLabel }));
            setDirty(true);
          }}
          stateLabel="State"
          cityLabel="Main city"
        />
        <div className="field" style={{ marginTop: 14 }}>
          <label>Other service cities</label>
          <input
            value={(draft.serviceCities || []).join(', ')}
            onChange={(e) =>
              change(
                'serviceCities',
                e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)
              )
            }
            placeholder="Hollywood, Hialeah, Miramar"
          />
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Comma-separated</div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Service radius (mi)</label>
            <input
              type="number"
              inputMode="numeric"
              value={draft.serviceRadius || 25}
              onChange={(e) => change('serviceRadius', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Display label</label>
            <input
              value={draft.serviceArea}
              onChange={(e) => change('serviceArea', e.target.value)}
              placeholder="Broward · Miami-Dade"
            />
          </div>
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Reviews & Invoices</div>
        <div className="field">
          <label>Google Review URL</label>
          <input value={draft.reviewUrl} onChange={(e) => change('reviewUrl', e.target.value)} placeholder="https://g.page/..." />
        </div>
        <div className="field">
          <label>Invoice Footer</label>
          <textarea
            rows={2}
            value={draft.invoiceFooter}
            onChange={(e) => change('invoiceFooter', e.target.value)}
            placeholder="Thank you for your business..."
          />
        </div>
      </div>
      {dirty && (
        <button className="btn primary" style={{ width: '100%' }} onClick={save}>
          Save Brand
        </button>
      )}
    </>
  );
}

function BusinessSection({ settings, onSave }: { settings: SettingsT; onSave: (n: Partial<SettingsT>) => void }) {
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const change = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => {
    setDraft((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };
  const save = () => {
    onSave(draft);
    setDirty(false);
    addToast('Saved', 'success');
  };
  return (
    <>
      <div className="form-group">
        <div className="form-group-title">Goals</div>
        <div className="field">
          <label>Weekly Profit Goal ($)</label>
          <input type="number" value={draft.weeklyGoal} onChange={(e) => change('weeklyGoal', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Default Target Profit ($)</label>
          <input
            type="number"
            value={draft.defaultTargetProfit}
            onChange={(e) => change('defaultTargetProfit', Number(e.target.value))}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Cost per Mile ($)</label>
            <input
              type="number"
              step="0.01"
              value={draft.costPerMile}
              onChange={(e) => change('costPerMile', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Free Miles Included</label>
            <input
              type="number"
              inputMode="numeric"
              value={draft.freeMilesIncluded || 0}
              onChange={(e) => change('freeMilesIncluded', Number(e.target.value))}
            />
          </div>
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Profit Targets (used by Quick Quote)</div>
        <div className="field-row">
          <div className="field">
            <label>Tire Repair ($)</label>
            <input
              type="number"
              value={draft.tireRepairTargetProfit || 0}
              onChange={(e) => change('tireRepairTargetProfit', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Tire Replacement ($)</label>
            <input
              type="number"
              value={draft.tireReplacementTargetProfit || 0}
              onChange={(e) => change('tireReplacementTargetProfit', Number(e.target.value))}
            />
          </div>
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Tax</div>
        <div className="field-row">
          <div className="field">
            <label>Income Tax (%)</label>
            <input type="number" value={draft.taxRate} onChange={(e) => change('taxRate', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Invoice Tax (%)</label>
            <input
              type="number"
              value={draft.invoiceTaxRate}
              onChange={(e) => change('invoiceTaxRate', Number(e.target.value))}
            />
          </div>
        </div>
      </div>
      <div className="form-group">
        <div className="form-group-title">Owners & Splits</div>
        <div className="field-row">
          <div className="field">
            <label>Owner 1 Name</label>
            <input value={draft.owner1Name} onChange={(e) => change('owner1Name', e.target.value)} />
          </div>
          <div className="field">
            <label>Owner 1 %</label>
            <input
              type="number"
              value={draft.profitSplit1}
              onChange={(e) => change('profitSplit1', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="settings-row">
          <span className="label">Owner 1 Active</span>
          <button
            className={'chip sm' + (draft.owner1Active ? ' active' : '')}
            onClick={() => change('owner1Active', !draft.owner1Active)}
          >
            {draft.owner1Active ? 'On' : 'Off'}
          </button>
        </div>
        <div className="field-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Owner 2 Name</label>
            <input value={draft.owner2Name} onChange={(e) => change('owner2Name', e.target.value)} />
          </div>
          <div className="field">
            <label>Owner 2 %</label>
            <input
              type="number"
              value={draft.profitSplit2}
              onChange={(e) => change('profitSplit2', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="settings-row">
          <span className="label">Owner 2 Active</span>
          <button
            className={'chip sm' + (draft.owner2Active ? ' active' : '')}
            onClick={() => change('owner2Active', !draft.owner2Active)}
          >
            {draft.owner2Active ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      {dirty && (
        <button className="btn primary" style={{ width: '100%' }} onClick={save}>
          Save Business Settings
        </button>
      )}
    </>
  );
}

function PricingSection({ settings, onSave }: { settings: SettingsT; onSave: (n: Partial<SettingsT>) => void }) {
  const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
  const vp = settings.vehiclePricing || DEFAULT_VEHICLE_PRICING;
  const [draftSp, setDraftSp] = useState<Record<string, ServicePricing>>(sp);
  const [draftVp, setDraftVp] = useState(vp);
  const [dirty, setDirty] = useState(false);

  const changeSvc = (s: string, k: keyof ServicePricing, v: number | boolean) => {
    setDraftSp((p) => ({ ...p, [s]: { ...(p[s] || { enabled: true, basePrice: 0, minProfit: 0 }), [k]: v } }));
    setDirty(true);
  };
  const changeVeh = (v: string, addOnProfit: number) => {
    setDraftVp((p) => ({ ...p, [v]: { addOnProfit } }));
    setDirty(true);
  };
  const save = () => {
    onSave({ servicePricing: draftSp, vehiclePricing: draftVp });
    setDirty(false);
    addToast('Pricing saved', 'success');
  };

  return (
    <>
      <div className="form-group">
        <div className="form-group-title">Services</div>
        {Object.keys(draftSp).map((s) => (
          <div key={s} style={{ borderBottom: '1px solid var(--border2)', padding: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{s}</span>
              <button
                className={'chip sm' + (draftSp[s].enabled ? ' active' : '')}
                onClick={() => changeSvc(s, 'enabled', !draftSp[s].enabled)}
              >
                {draftSp[s].enabled ? 'On' : 'Off'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Base $
                </div>
                <input
                  type="number"
                  value={draftSp[s].basePrice}
                  onChange={(e) => changeSvc(s, 'basePrice', Number(e.target.value))}
                  style={{
                    width: '100%',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r4)',
                    padding: '8px 10px',
                    background: 'var(--s3)',
                    color: 'var(--t1)',
                    fontSize: 14,
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Min Profit $
                </div>
                <input
                  type="number"
                  value={draftSp[s].minProfit}
                  onChange={(e) => changeSvc(s, 'minProfit', Number(e.target.value))}
                  style={{
                    width: '100%',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r4)',
                    padding: '8px 10px',
                    background: 'var(--s3)',
                    color: 'var(--t1)',
                    fontSize: 14,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="form-group">
        <div className="form-group-title">Vehicle Add-ons</div>
        {Object.keys(draftVp).map((v) => (
          <div key={v} className="settings-row">
            <span className="label">{v}</span>
            <input
              type="number"
              value={draftVp[v].addOnProfit}
              onChange={(e) => changeVeh(v, Number(e.target.value))}
              style={{
                width: 80,
                border: '1px solid var(--border)',
                borderRadius: 'var(--r4)',
                padding: '6px 10px',
                background: 'var(--s3)',
                color: 'var(--t1)',
                fontSize: 13,
                textAlign: 'right',
              }}
            />
          </div>
        ))}
      </div>
      {dirty && (
        <button className="btn primary" style={{ width: '100%' }} onClick={save}>
          Save Pricing
        </button>
      )}
    </>
  );
}

function DataSection({ inventoryCount, jobsCount }: { inventoryCount: number; jobsCount: number }) {
  return (
    <div className="form-group">
      <div className="form-group-title">Storage</div>
      <div className="settings-row">
        <span className="label">Total Jobs</span>
        <span className="value">{jobsCount}</span>
      </div>
      <div className="settings-row">
        <span className="label">Inventory SKUs</span>
        <span className="value">{inventoryCount}</span>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--t3)' }}>
        All data syncs to Firebase Firestore in real time. Offline edits queue and sync when reconnected.
      </div>
    </div>
  );
}

function AccountSection() {
  const out = async () => {
    if (!_auth) return;
    if (confirm('Sign out?')) {
      await signOut(_auth);
    }
  };
  return (
    <div className="form-group">
      <div className="form-group-title">Account</div>
      <button className="btn danger" style={{ width: '100%' }} onClick={out}>
        Sign Out
      </button>
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--t3)', textAlign: 'center' }}>
        Mobile Service OS
      </div>
    </div>
  );
}
