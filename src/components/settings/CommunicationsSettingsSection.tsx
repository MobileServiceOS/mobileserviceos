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

import {
  memo,
  useCallback,
  useEffect,
  useState,
  type CSSProperties } from 'react';
import { TWILIO_ENABLED } from '@/lib/twilioEnabled';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
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

  // SP3 designed `settings.twilioConnected` as a manual flag to flip when
  // "Connect (SP4)" shipped, but SP4 routed the active Connect flow into
  // the separate Missed Call Recovery accordion — twilioConnected was
  // never written and stayed permanently false, mis-rendering this badge
  // for tenants who'd already saved a real twilioPhoneNumber. Derive it
  // from the canonical signal instead. Mirrors the pattern landed in
  // MissedCallRecoverySection.tsx (commit a903201).
  const twilioPhoneNumber           = settings.twilioPhoneNumber?.trim() ?? '';
  const callForwardNumber           = settings.callForwardNumber?.trim() ?? '';
  // Twilio is disconnected in-app (TWILIO_ENABLED=false): report "Not
  // connected" regardless of any saved number, since nothing routes
  // through Twilio. Flip the flag to restore the number-derived status.
  const twilioConnected             = TWILIO_ENABLED && !!twilioPhoneNumber;
  const incomingCallLookupEnabled   = settings.incomingCallLookupEnabled ?? true;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pickedId, setPickedId] = useState<string>('');
  const [testCallStatus, setTestCallStatus] = useState<string | null>(null);
  const [testCallError, setTestCallError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load customers (sorted by lastJobAt desc, limit 50) for the
  // Test Incoming Call picker. Only fetches when the section is open.
  useEffect(() => {
    if (!isOwner || !open) return;
    const col = collection(requireDb(), 'businesses', businessId, 'customers');
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
      let from = '';
      let customerId: string | null = null;
      let name = 'a new caller';
      if (variant === 'known') {
        const picked = customers.find(c => c.id === pickedId);
        if (!picked) {
          setTestCallError('Pick a customer first');
          return;
        }
        customerId = picked.id;
        name = picked.name;
        // The popup resolves the customer by customerId, but it also needs
        // a non-empty `from` to fire. Fall back to a synthetic number when
        // the customer has no phone on file.
        from = picked.phoneE164 || `+1555${String(Date.now()).slice(-7)}`;
      } else {
        // A number that won't match any customer → "Unknown caller" popup.
        from = `+1555${String(Date.now()).slice(-7)}`;
      }
      const now = Timestamp.now();
      // NOTE: clients may only write the camelCase `incomingCalls` test
      // collection (firestore.rules requires provider:'test'). The popup
      // listens to BOTH this and the snake_case `incoming_calls` the Twilio
      // webhook writes — so this exercises the real popup path end to end.
      await addDoc(
        collection(requireDb(), 'businesses', businessId, 'incomingCalls'),
        {
          provider: 'test',
          status: 'ringing',
          from,
          to: twilioPhoneNumber,
          customerId,
          customerExists: variant === 'known',
          direction: 'inbound',
          createdAt: now,
          receivedAt: now,
        },
      );
      setTestCallStatus(`Test call fired for ${name} — the popup should appear now.`);
    } catch (err) {
      setTestCallError(err instanceof Error ? err.message : String(err));
    }
  }, [businessId, customers, pickedId, twilioPhoneNumber]);

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

      {/* Item 2: connected status — derived from twilioPhoneNumber */}
      <div className="field" style={rowStyle}>
        <label>Status</label>
        <div style={readOnlyStyle}>
          {twilioConnected
            ? `✓ Connected · ${twilioPhoneNumber}`
            : '— Not connected'}
        </div>
      </div>

      {/* Item 3: Twilio number — editable here. This is the number Twilio
          SimRing forwards to; the incoming-call webhook matches calls to
          your business by it. */}
      <div className="field" style={rowStyle}>
        <label>Twilio Number</label>
        <input
          type="tel"
          defaultValue={twilioPhoneNumber}
          placeholder="+1 555 123 4567"
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== twilioPhoneNumber) void onSaveSettings({ twilioPhoneNumber: v });
          }}
          style={selectStyle}
        />
        <p style={helpStyle}>Your Twilio number (not your T-Mobile number). Used to match incoming calls to your business.</p>
      </div>

      {/* Forward-to (answer) number — Twilio <Dial>s this after the popup. */}
      <div className="field" style={rowStyle}>
        <label>Forward calls to</label>
        <input
          type="tel"
          defaultValue={callForwardNumber}
          placeholder="+1 555 987 6543"
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== callForwardNumber) void onSaveSettings({ callForwardNumber: v });
          }}
          style={selectStyle}
        />
        <p style={helpStyle}>
          The number you answer on — must be a <strong>different line</strong> than your
          business number (e.g. a 2nd eSIM on your phone). Dialing the forwarded business
          number would loop. Leave blank to show the popup without bridging the call.
        </p>
      </div>

      {/* Item 3b: the webhook URL to paste into Twilio. */}
      <div className="field" style={rowStyle}>
        <label>Incoming-call webhook URL</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
          <code style={{ ...readOnlyStyle, flex: 1, overflowX: 'auto', whiteSpace: 'nowrap', fontSize: 11 }}>{TWILIO_WEBHOOK_URL}</code>
          <button
            type="button" className="btn sm secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(TWILIO_WEBHOOK_URL)
                .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
                .catch(() => { /* clipboard blocked — user can select manually */ });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p style={helpStyle}>
          Twilio Console → Phone Numbers → your number → Voice &amp; Fax → "A call comes in" → Webhook (HTTP POST).
        </p>
      </div>

      {/* Event toggles. Only the caller-ID popup is wired today; the SMS
          toggles (incoming logging / outbound) were never read by anything,
          so they're removed rather than left as switches that do nothing. */}
      <ToggleRow label="Caller-ID popup on incoming calls"
                 hint="Shows the caller's name, vehicle & history when the phone rings."
                 checked={incomingCallLookupEnabled}
                 canEdit={canEdit} onChange={(v) => flip('incomingCallLookupEnabled', v)} />

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
            Fires the caller-ID popup with a test call so you can see it in
            action — works without Twilio or T-Mobile set up. Keep this tab in
            front; the popup appears over the app.
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
    <div style={{ marginBottom: 10 }}>
      {/* justifyContent:flex-start + width:100% override the global
          `label { justify-content: space-between }`, which otherwise
          shoves the checkbox far-left and the text off-screen on mobile.
          alignItems:flex-start + a wrapping span keep long labels readable
          on narrow widths. */}
      <label style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start',
        width: '100%', gap: 10, cursor: canEdit ? 'pointer' : 'not-allowed',
        textTransform: 'none',
      }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.checked)}
          style={{ flexShrink: 0, width: 18, height: 18, marginTop: 1 }}
        />
        <span style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--t1)' }}>
          {label}
          {hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{hint}</span>}
        </span>
      </label>
    </div>
  );
}

const TWILIO_WEBHOOK_URL = 'https://us-central1-mobile-service-os.cloudfunctions.net/twilioIncomingCall';

const rowStyle: CSSProperties = { marginBottom: 12 };
const helpStyle: CSSProperties = { fontSize: 11, color: 'var(--t3)', marginTop: 4, marginBottom: 6 };
const readOnlyStyle: CSSProperties = {
  padding: '6px 8px', background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  color: 'var(--t2)', fontSize: 13,
};
const selectStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1, #fff)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};

export const CommunicationsSettingsSection = memo(CommunicationsSettingsSectionImpl);
