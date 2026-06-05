// src/components/settings/MissedCallRecoverySection.tsx
// ═══════════════════════════════════════════════════════════════════
//  MissedCallRecoverySection — SP4B operator surface.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Settings → Missed Call Recovery accordion"
//
//  Eight sub-sections, mirrors SP4A ReviewAutomationSection.tsx shape:
//    1. Enable toggle (missedCallAutoTextEnabled)
//    2. Warning banner when toggle ON + twilioPhoneNumber empty
//    3. Twilio Phone Number input (E.164 validated on blur)
//    4. Twilio Phone Number SID input (optional debug field)
//    5. Template editor + 7-variable legend
//    6. Live preview pane (renders with unknown-caller fallback)
//    7. Send Test Missed Call (owner+admin only)
//    8. Recent leads list (last 5; tap → LeadDetailSheet)
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { _db } from '@/lib/firebase';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { renderTemplate } from '@/lib/reviewTemplate';
import { DEFAULT_MISSED_CALL_TEMPLATE } from '@/lib/defaults';
import { usePermissions, useMembership } from '@/context/MembershipContext';
import { useBrand } from '@/context/BrandContext';
import type { Lead, Settings } from '@/types';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenLead?: (leadId: string) => void;     // optional callback into LeadDetailSheet host
}

function _getEmulatorAwareFunctions() {
  const fns = getFunctions();
  // When the dev server runs against the emulator we need to route
  // the functions client too. Idempotent — emulator-host is stored
  // on the instance after first call.
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const useEmu =
    env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';
  if (useEmu) {
    try { connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch { /* already connected */ }
  }
  return fns;
}

function isValidE164(v: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(v.trim());
}

function MissedCallRecoverySectionImpl({
  businessId, settings, open, onToggle, onSaveSettings, onOpenLead,
}: Props): JSX.Element {
  const perms = usePermissions();
  const { role } = useMembership();
  const canEdit = perms.canEditBusinessSettings ?? false;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const enabled  = settings.missedCallAutoTextEnabled ?? false;
  const template = settings.missedCallTemplate ?? DEFAULT_MISSED_CALL_TEMPLATE;
  const phone    = settings.twilioPhoneNumber ?? '';
  const phoneSid = settings.twilioPhoneNumberSid ?? '';
  // businessName lives on the Brand doc (businesses/{bid}/settings/main),
  // not on operational_settings/main. The App.tsx `settings` prop is
  // hydrated from operational_settings, which historically carried a
  // stale DEFAULT_SETTINGS.businessName='My Business' for accounts that
  // pre-date the Brand/Settings split — reading it here would render
  // "Hi, thanks for contacting My Business" in the Live Preview even
  // when the operator's saved Brand name is "Wheel Rush". Pull from the
  // Brand context, which mirrors the canonical settings/main value the
  // server-side renderer also reads.
  const { brand } = useBrand();
  const businessName = brand.businessName ?? '';

  // Local-only state for save-on-blur inputs. The MemberDoc shape in
  // this codebase has no phone field (workaround carried from SP4A
  // ReviewAutomationSection), so the test-phone input defaults to
  // empty and the operator types it in.
  const [phoneLocal,    setPhoneLocal]    = useState(phone);
  const [phoneSidLocal, setPhoneSidLocal] = useState(phoneSid);
  const [templateLocal, setTemplateLocal] = useState(template);
  const [testPhone,     setTestPhone]     = useState('');
  const [testStatus,    setTestStatus]    = useState<string | null>(null);
  const [testError,     setTestError]     = useState<string | null>(null);
  const [testInFlight,  setTestInFlight]  = useState(false);

  useEffect(() => { setPhoneLocal(phone); }, [phone]);
  useEffect(() => { setPhoneSidLocal(phoneSid); }, [phoneSid]);
  useEffect(() => { setTemplateLocal(template); }, [template]);

  // Recent leads — last 5 by receivedAt desc
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!businessId || !open) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'leads'),
      orderBy('receivedAt', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Lead[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as Lead));
      setRecentLeads(next);
    });
    return () => unsub();
  }, [businessId, open]);

  // Live preview body — renders with unknown-caller fallback (firstName empty)
  const previewBody = useMemo(() => renderTemplate(templateLocal || DEFAULT_MISSED_CALL_TEMPLATE, {
    firstName: '', lastName: '',
    businessName, serviceType: '', city: '', vehicle: '', reviewLink: '',
  }), [templateLocal, businessName]);

  // Handlers
  const onToggleEnable = useCallback(async () => {
    if (!canEdit) return;
    await onSaveSettings({ missedCallAutoTextEnabled: !enabled } as Partial<Settings>);
  }, [canEdit, enabled, onSaveSettings]);

  const onBlurPhone = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = phoneLocal.trim();
    if (trimmed === phone) return;
    if (trimmed && !isValidE164(trimmed)) {
      setPhoneLocal(phone);
      return;
    }
    await onSaveSettings({ twilioPhoneNumber: trimmed } as Partial<Settings>);
  }, [canEdit, phoneLocal, phone, onSaveSettings]);

  const onBlurPhoneSid = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = phoneSidLocal.trim();
    if (trimmed === phoneSid) return;
    await onSaveSettings({ twilioPhoneNumberSid: trimmed } as Partial<Settings>);
  }, [canEdit, phoneSidLocal, phoneSid, onSaveSettings]);

  const onBlurTemplate = useCallback(async () => {
    if (!canEdit) return;
    if (templateLocal === template) return;
    await onSaveSettings({ missedCallTemplate: templateLocal } as Partial<Settings>);
  }, [canEdit, templateLocal, template, onSaveSettings]);

  const onFireTest = useCallback(async () => {
    setTestError(null);
    setTestStatus(null);
    setTestInFlight(true);
    try {
      const fn = httpsCallable<
        { businessId: string; phoneE164: string },
        { leadId: string }
      >(_getEmulatorAwareFunctions(), 'sendTestMissedCall');
      const { data } = await fn({ businessId, phoneE164: testPhone });
      const twilioConnected = !!settings.twilioPhoneNumber?.trim();
      setTestStatus(`Test lead created (${data.leadId}). ${twilioConnected ? 'Drainer will send within 1 min.' : 'Twilio not connected — auto-text stays pending.'}`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestInFlight(false);
    }
  }, [businessId, testPhone, settings.twilioPhoneNumber]);

  const showWarning = enabled && !phone.trim();

  return (
    <AccordionShell
      title="Missed Call Recovery"
      icon="📞"
      summary={enabled ? (phone ? `On · ${phone}` : 'On · no number set') : 'Off'}
      open={open}
      onToggle={onToggle}
    >
      {/* 1. Enable toggle */}
      <div className="field" style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'not-allowed' }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={onToggleEnable}
          />
          <span style={{ fontWeight: 500 }}>Enable Missed Call Recovery</span>
        </label>
        <p style={{ ...helpStyle, marginLeft: 24 }}>
          When ON, missed calls auto-create a Lead and send an acknowledgment SMS to the caller.
        </p>
      </div>

      {/* 2. Warning banner */}
      {showWarning && (
        <div style={warningBanner}>
          ⚠ Set your Twilio number below to enable missed-call recovery. Without it, no calls can be routed.
        </div>
      )}

      {/* 3. Twilio Phone Number */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Twilio Phone Number</label>
        <input
          type="tel"
          value={phoneLocal}
          onChange={(e) => setPhoneLocal(e.target.value)}
          onBlur={onBlurPhone}
          placeholder="+13055551234"
          disabled={!canEdit}
          style={inputStyle}
        />
        <p style={helpStyle}>
          Enter the Twilio number your customers call. In Twilio Console → Phone Numbers → [Number] → Voice & Fax, set the <strong>Status Callback URL</strong> to your deployed twilioVoiceStatus URL.
        </p>
      </div>

      {/* 4. Twilio Phone Number SID */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Twilio Phone Number SID (optional)</label>
        <input
          type="text"
          value={phoneSidLocal}
          onChange={(e) => setPhoneSidLocal(e.target.value)}
          onBlur={onBlurPhoneSid}
          placeholder="PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          disabled={!canEdit}
          style={inputStyle}
        />
        <p style={helpStyle}>For your reference only. Not used by the webhook.</p>
      </div>

      {/* 5. Template editor */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Auto-text Template</label>
        <textarea
          value={templateLocal}
          onChange={(e) => setTemplateLocal(e.target.value)}
          onBlur={onBlurTemplate}
          rows={6}
          disabled={!canEdit}
          style={{ ...inputStyle, minHeight: 120, fontFamily: 'inherit' }}
        />
        <p style={helpStyle}>
          Available: <code>{'{firstName}'}</code> · <code>{'{lastName}'}</code> · <code>{'{businessName}'}</code>
          {' · '}<code>{'{serviceType}'}</code> · <code>{'{city}'}</code> · <code>{'{vehicle}'}</code>
          {' · '}<code>{'{reviewLink}'}</code>
        </p>
      </div>

      {/* 6. Preview */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Live preview (unknown caller)</label>
        <div style={previewBox}>{previewBody}</div>
      </div>

      {/* 7. Send Test Missed Call */}
      {isOwnerOrAdmin && (
        <div className="field" style={{ marginBottom: 12, paddingTop: 10, borderTop: '1px solid var(--border, #2a2a2a)' }}>
          <label style={labelStyle}>Send Test Missed Call</label>
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+13055551234"
            style={inputStyle}
          />
          <button
            type="button"
            className="btn sm primary"
            disabled={testInFlight || !testPhone.trim()}
            onClick={onFireTest}
            style={{ marginTop: 6 }}
          >
            {testInFlight ? 'Firing…' : 'Fire Test Missed Call'}
          </button>
          {testStatus && <p style={{ ...helpStyle, color: 'var(--ok, #4ade80)', marginTop: 6 }}>{testStatus}</p>}
          {testError  && <p style={{ ...helpStyle, color: 'var(--danger, #f87171)', marginTop: 6 }}>Error: {testError}</p>}
        </div>
      )}

      {/* 8. Recent Leads */}
      <div className="field" style={{ marginTop: 12 }}>
        <label style={labelStyle}>Recent Leads</label>
        {recentLeads.length === 0 && (
          <p style={helpStyle}>No leads yet.</p>
        )}
        {recentLeads.map(l => {
          const isTest = l.id.startsWith('lead-test-');
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onOpenLead?.(l.id)}
              style={leadRow}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{l.phoneE164}</strong>
                <span style={statusPill(l.status)}>{l.status}</span>
                {isTest && <span style={testBadge}>TEST</span>}
                {l.wasNewCustomer && <span style={newCustomerBadge}>NEW</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                {formatTs((l as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt)}
              </span>
            </button>
          );
        })}
      </div>
    </AccordionShell>
  );
}

function statusPill(status: string): CSSProperties {
  const colorMap: Record<string, string> = {
    New: '#3b82f6', Contacted: '#f59e0b', Quoted: '#a78bfa',
    Booked: '#4ade80', Closed: '#6b7280', Lost: '#f87171',
  };
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: colorMap[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function formatTs(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  return new Date(ts.toMillis()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const labelStyle: CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: 12,
  color: 'var(--t2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const helpStyle: CSSProperties = { fontSize: 11, color: 'var(--t3)', marginTop: 4 };
const warningBanner: CSSProperties = {
  padding: 10, marginBottom: 10,
  background: 'var(--warn-bg, #2a2418)', color: 'var(--t1)',
  border: '1px solid var(--warn-border, #5a4a18)', borderRadius: 6,
  fontSize: 12,
};
const previewBox: CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  whiteSpace: 'pre-wrap',
};
const leadRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '6px 8px', marginBottom: 4,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  cursor: 'pointer', textAlign: 'left',
};
const testBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#facc15', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const newCustomerBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#fb923c', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};

export const MissedCallRecoverySection = memo(MissedCallRecoverySectionImpl);
