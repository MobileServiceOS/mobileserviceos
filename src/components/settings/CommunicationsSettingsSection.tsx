// src/components/settings/CommunicationsSettingsSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  CommunicationsSettingsSection — SP3 priority slice (items 1, 2, 4-9)
//
//  Spec: §"Communications Settings (v3 NEW)" line 2270,
//        §"v3.1 priority lock" — SP3 ships items 1, 2, 4-9.
//        Item 3 (Connect form) renders disabled until SP4 deploys.
//
//  Item 9: Test Incoming Call admin action (owner-only). Writes a
//  synthetic incomingCalls doc with provider:'test' + Timestamp.now()
//  — the SP1 rule at firestore.rules:664-673 allows exactly this.
//  SP6 listener picks it up and fires the popup.
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  addDoc, collection, onSnapshot, query, orderBy, limit, Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { usePermissions, useMembership } from '@/context/MembershipContext';
import type { Settings } from '@/types';
import type { Customer } from '@/lib/customerEntity';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
}

function CommunicationsSettingsSectionImpl({
  businessId, settings, open, onToggle, onSaveSettings,
}: Props) {
  const perms = usePermissions();
  const { role } = useMembership();
  const isOwner = role === 'owner';
  const canEdit = perms.canEditBusinessSettings ?? false;

  const twilioConnected             = settings.twilioConnected ?? false;
  const incomingCallLookupEnabled   = settings.incomingCallLookupEnabled ?? true;
  const incomingSMSLoggingEnabled   = settings.incomingSMSLoggingEnabled ?? true;
  const missedCallAutoTextEnabled   = settings.missedCallAutoTextEnabled ?? false;
  const outboundSMSEnabled          = settings.outboundSMSEnabled ?? true;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pickedId, setPickedId] = useState<string>('');
  const [testCallStatus, setTestCallStatus] = useState<string | null>(null);
  const [testCallError, setTestCallError] = useState<string | null>(null);

  // Load customers (sorted by lastJobAt desc, limit 50) for the
  // Test Incoming Call picker. Only fetches when the section is open.
  useEffect(() => {
    if (!isOwner || !open) return;
    const col = collection(_db as Firestore, 'businesses', businessId, 'customers');
    const q = query(col, orderBy('lastJobAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const rows: Customer[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as Customer));
      setCustomers(rows);
    });
    return () => unsub();
  }, [businessId, isOwner, open]);

  const flip = useCallback(async (key: keyof Settings, nextVal: boolean) => {
    await onSaveSettings({ [key]: nextVal } as unknown as Partial<Settings>);
  }, [onSaveSettings]);

  const fireTestCall = useCallback(async (variant: 'known' | 'new-caller') => {
    setTestCallError(null);
    setTestCallStatus(null);
    try {
      let snapshot: Array<{ customerId: string; name: string; phoneE164: string }> = [];
      let customerId: string | null = null;
      if (variant === 'known') {
        const picked = customers.find(c => c.id === pickedId);
        if (!picked) {
          setTestCallError('Pick a customer first');
          return;
        }
        snapshot = [{ customerId: picked.id, name: picked.name, phoneE164: picked.phoneE164 ?? '' }];
        customerId = picked.id;
      }
      await addDoc(
        collection(_db as Firestore, 'businesses', businessId, 'incomingCalls'),
        {
          provider: 'test',
          status: 'ringing',
          customersSnapshot: snapshot,
          additionalMatchesCount: 0,
          customerId,
          assignedToUid: null,
          createdAt: Timestamp.now(),
        },
      );
      setTestCallStatus(
        variant === 'known'
          ? `Synthetic call doc written for ${snapshot[0]?.name}. SP6 popup will fire when SP6 ships.`
          : 'Synthetic NEW CALLER doc written. SP6 popup will fire when SP6 ships.',
      );
    } catch (err) {
      setTestCallError(err instanceof Error ? err.message : String(err));
    }
  }, [businessId, customers, pickedId]);

  return (
    <AccordionShell
      title="Communications"
      icon="📞"
      summary={`Twilio · ${twilioConnected ? 'Connected' : 'Not connected'}`}
      open={open}
      onToggle={onToggle}
    >
      {/* Item 1: provider label (read-only) */}
      <div className="field" style={rowStyle}>
        <label>Provider</label>
        <div style={readOnlyStyle}>Twilio</div>
      </div>

      {/* Item 2: connected status */}
      <div className="field" style={rowStyle}>
        <label>Status</label>
        <div style={readOnlyStyle}>{twilioConnected ? '✓ Connected' : '— Not connected'}</div>
      </div>

      {/* Item 3: Connect form (disabled in SP3 — SP4 enables) */}
      <div className="field" style={rowStyle}>
        <label>Connect Twilio Number</label>
        <p style={helpStyle}>Configuration available when Cloud Functions are deployed (SP4).</p>
        <input type="text" placeholder="+1XXXXXXXXXX (E.164)" disabled style={disabledInputStyle} />
        <input type="text" placeholder="PNxxxx (Phone Number SID)" disabled style={disabledInputStyle} />
        <input type="text" placeholder="MGxxxx (Messaging Service SID, optional)" disabled style={disabledInputStyle} />
        <button type="button" className="btn sm primary" disabled style={{ marginTop: 6 }}>
          Connect (SP4)
        </button>
      </div>

      {/* Items 4-7: event toggles */}
      <ToggleRow label="Enable incoming call lookup" checked={incomingCallLookupEnabled}
                 canEdit={canEdit} onChange={(v) => flip('incomingCallLookupEnabled', v)} />
      <ToggleRow label="Enable incoming SMS logging" checked={incomingSMSLoggingEnabled}
                 canEdit={canEdit} onChange={(v) => flip('incomingSMSLoggingEnabled', v)} />
      <ToggleRow label="Enable missed-call auto text" hint="SP7 wires the rule engine"
                 checked={missedCallAutoTextEnabled}
                 canEdit={canEdit} onChange={(v) => flip('missedCallAutoTextEnabled', v)} />
      <ToggleRow label="Enable outbound SMS" hint="SP4 wires the sendSMS callable"
                 checked={outboundSMSEnabled}
                 canEdit={canEdit} onChange={(v) => flip('outboundSMSEnabled', v)} />

      {/* Item 8: cross-link to Customer Directory section */}
      <div className="field" style={rowStyle}>
        <p style={helpStyle}>
          ↗ Auto-save customers from completed jobs — managed in the <strong>Customer Directory</strong> section above.
        </p>
      </div>

      {/* Item 9: Test Incoming Call (owner-only, dev/dogfood) */}
      {isOwner && (
        <div className="field" style={{ ...rowStyle, borderTop: '1px solid var(--border, #2a2a2a)', paddingTop: 12 }}>
          <label style={{ fontWeight: 600, fontSize: 13 }}>Test Incoming Call</label>
          <p style={helpStyle}>
            Writes a synthetic ringing-call doc to exercise the SP6 popup path
            (works without Twilio being connected).
          </p>
          <select
            value={pickedId}
            onChange={(e) => setPickedId(e.target.value)}
            style={selectStyle}
          >
            <option value="">— Pick a known customer —</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phoneE164 ? `(${c.phoneE164})` : ''}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn sm primary"
              disabled={!pickedId}
              onClick={() => fireTestCall('known')}
            >
              Fire Test Call (known)
            </button>
            <button
              type="button"
              className="btn sm secondary"
              onClick={() => fireTestCall('new-caller')}
            >
              Fire NEW CALLER variant
            </button>
          </div>
          {testCallStatus && <p style={{ ...helpStyle, color: 'var(--ok, #4ade80)', marginTop: 8 }}>{testCallStatus}</p>}
          {testCallError && <p style={{ ...helpStyle, color: 'var(--danger, #f87171)', marginTop: 8 }}>Error: {testCallError}</p>}
        </div>
      )}
    </AccordionShell>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  canEdit: boolean;
  onChange: (next: boolean) => void;
}
function ToggleRow({ label, hint, checked, canEdit, onChange }: ToggleRowProps) {
  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'not-allowed' }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint && <p style={{ ...helpStyle, marginLeft: 24, marginTop: 2 }}>{hint}</p>}
    </div>
  );
}

const rowStyle: CSSProperties = { marginBottom: 12 };
const helpStyle: CSSProperties = { fontSize: 11, color: 'var(--t3)', marginTop: 4, marginBottom: 6 };
const readOnlyStyle: CSSProperties = {
  padding: '6px 8px', background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  color: 'var(--t2)', fontSize: 13,
};
const disabledInputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', marginBottom: 6, fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t3, #888)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  opacity: 0.5,
};
const selectStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1, #fff)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};

export const CommunicationsSettingsSection = memo(CommunicationsSettingsSectionImpl);
