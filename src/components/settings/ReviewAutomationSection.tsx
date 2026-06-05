// src/components/settings/ReviewAutomationSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  ReviewAutomationSection — SP4A operator surface.
//
//  Spec: §"UI — ReviewAutomationSection accordion" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Eight sub-sections:
//    1. Enable toggle
//    2. Warning banner when toggle ON + URL empty (addition #7)
//    3. Google Review URL input (validated)
//    4. Delay chip group (Immediate / 5 / 15 / 60)
//    5. Template editor + 7-variable legend
//    6. Live preview pane (last completed job → fallback)
//    7. Send Test SMS form
//    8. History table (delegated to ReviewRequestHistoryTable)
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { _db } from '@/lib/firebase';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { ReviewRequestHistoryTable } from '@/components/settings/ReviewRequestHistoryTable';
import { renderTemplate } from '@/lib/reviewTemplate';
import { DEFAULT_REVIEW_TEMPLATE } from '@/lib/defaults';
import { usePermissions, useMembership } from '@/context/MembershipContext';
import { useBrand } from '@/context/BrandContext';
import type { Job, Settings } from '@/types';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
}

const DELAY_OPTIONS: ReadonlyArray<{ value: 0 | 5 | 15 | 60; label: string }> = [
  { value: 0,  label: 'Immediate' },
  { value: 5,  label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 60, label: '1 hr' },
];

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

function isValidHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

function ReviewAutomationSectionImpl({
  businessId, settings, open, onToggle, onSaveSettings,
}: Props): JSX.Element {
  const perms = usePermissions();
  const { role } = useMembership();
  const canEdit = perms.canEditBusinessSettings ?? false;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const enabled  = settings.reviewAutomationEnabled ?? false;
  const template = settings.reviewSmsTemplate ?? DEFAULT_REVIEW_TEMPLATE;
  const delay    = (settings.reviewDelayMinutes ?? 0) as 0 | 5 | 15 | 60;
  const url      = settings.googleReviewLink ?? '';
  // businessName lives on the Brand doc (businesses/{bid}/settings/main),
  // not on operational_settings/main. The App.tsx `settings` prop is
  // hydrated from operational_settings, which historically carried a
  // stale DEFAULT_SETTINGS.businessName='My Business' for accounts that
  // pre-date the Brand/Settings split. Pull from the Brand context so
  // the preview matches the server-side renderer (which reads
  // settings/main.businessName directly).
  const { brand } = useBrand();
  const businessName = brand.businessName ?? '';

  // Local-only state for inputs that save-on-blur. The MemberDoc shape
  // in this codebase has no phone field, so the test-SMS phone input
  // defaults to empty and the operator types it in.
  const [urlLocal,     setUrlLocal]     = useState(url);
  const [templateLocal,setTemplateLocal]= useState(template);
  const [testPhone,    setTestPhone]    = useState('');
  const [testStatus,   setTestStatus]   = useState<string | null>(null);
  const [testError,    setTestError]    = useState<string | null>(null);
  const [testInFlight, setTestInFlight] = useState(false);

  useEffect(() => { setUrlLocal(url); }, [url]);
  useEffect(() => { setTemplateLocal(template); }, [template]);

  // Last-completed job → preview source. Optional; falls back to a
  // static sample customer if nothing's available.
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!businessId || !open) return;
    if (!_db) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'jobs'),
      where('status', '==', 'Completed'),
      orderBy('date', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      setPreviewJob(d ? ({ id: d.id, ...(d.data() as Omit<Job, 'id'>) }) : null);
    });
    return () => unsub();
  }, [businessId, open]);

  const previewBody = useMemo(() => {
    const fallback = {
      firstName: 'Sample',
      lastName:  'Customer',
      serviceType: 'Tire Repair',
      city: 'Hollywood',
      vehicle: 'Honda Civic',
    };
    const customerName = previewJob?.customerName ?? `${fallback.firstName} ${fallback.lastName}`;
    const first = customerName.split(/\s+/)[0] ?? fallback.firstName;
    const last  = customerName.split(/\s+/).slice(1).join(' ');
    const cityVal = (previewJob?.city || previewJob?.area || settings.serviceArea || fallback.city) as string;
    const service = previewJob?.service ?? fallback.serviceType;
    const vehicle = previewJob?.vehicleMakeModel ?? fallback.vehicle;
    return renderTemplate(templateLocal || DEFAULT_REVIEW_TEMPLATE, {
      firstName: first, lastName: last, businessName, serviceType: service,
      city: cityVal, vehicle, reviewLink: urlLocal || '(your-google-review-url)',
    });
  }, [templateLocal, urlLocal, businessName, settings.serviceArea, previewJob]);

  const onToggleEnable = useCallback(async () => {
    if (!canEdit) return;
    await onSaveSettings({ reviewAutomationEnabled: !enabled } as Partial<Settings>);
  }, [canEdit, enabled, onSaveSettings]);

  const onPickDelay = useCallback(async (val: 0 | 5 | 15 | 60) => {
    if (!canEdit) return;
    await onSaveSettings({ reviewDelayMinutes: val } as Partial<Settings>);
  }, [canEdit, onSaveSettings]);

  const onBlurUrl = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = urlLocal.trim();
    if (trimmed === url) return;
    if (trimmed && !isValidHttpUrl(trimmed)) {
      setUrlLocal(url);
      return;
    }
    await onSaveSettings({ googleReviewLink: trimmed } as Partial<Settings>);
  }, [canEdit, urlLocal, url, onSaveSettings]);

  const onBlurTemplate = useCallback(async () => {
    if (!canEdit) return;
    if (templateLocal === template) return;
    await onSaveSettings({ reviewSmsTemplate: templateLocal } as Partial<Settings>);
  }, [canEdit, templateLocal, template, onSaveSettings]);

  const onSendTest = useCallback(async () => {
    setTestError(null);
    setTestStatus(null);
    setTestInFlight(true);
    try {
      const fn = httpsCallable<
        { businessId: string; phoneE164?: string; template?: string },
        { requestId: string }
      >(_getEmulatorAwareFunctions(), 'sendTestReviewSms');
      const { data } = await fn({
        businessId,
        phoneE164: testPhone || undefined,
        template:  templateLocal || undefined,
      });
      // Derive Twilio-connected status from the actual configured phone
      // number instead of the stale settings.twilioConnected ghost field
      // (same pattern as commits a903201 + caf5f4a for the sibling
      // accordions). settings.twilioConnected is never written by any
      // UI flow — the canonical signal is operator having saved
      // twilioPhoneNumber in Missed Call Recovery.
      const twilioConnected = !!settings.twilioPhoneNumber?.trim();
      setTestStatus(`Test enqueued (id ${data.requestId}). ${twilioConnected ? 'Drainer will send within 1 min.' : 'Twilio not connected — request stays pending.'}`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestInFlight(false);
    }
  }, [businessId, testPhone, templateLocal, settings.twilioPhoneNumber]);

  const showWarning = enabled && !url.trim();

  return (
    <AccordionShell
      title="Review Automation"
      icon="⭐"
      summary={enabled ? `On · ${delay === 0 ? 'Immediate' : delay + ' min'} delay` : 'Off'}
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
          <span style={{ fontWeight: 500 }}>Enable Review Automation</span>
        </label>
        <p style={{ ...helpStyle, marginLeft: 24, marginTop: 4 }}>
          When ON, completed jobs automatically queue a Google review SMS after the configured delay.
        </p>
      </div>

      {/* 2. Warning banner */}
      {showWarning && (
        <div style={warningBanner}>
          ⚠ Set your Google Review URL below to enable automation. Without it, no SMS is queued.
        </div>
      )}

      {/* 3. Google Review URL */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Google Review URL</label>
        <input
          type="url"
          value={urlLocal}
          onChange={(e) => setUrlLocal(e.target.value)}
          onBlur={onBlurUrl}
          placeholder="https://g.page/r/..."
          disabled={!canEdit}
          style={inputStyle}
        />
        <p style={helpStyle}>
          Find at: business.google.com → Customers → Reviews → Get more reviews.
        </p>
      </div>

      {/* 4. Delay chips */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Delay before sending</label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DELAY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={!canEdit}
              onClick={() => onPickDelay(opt.value)}
              className={'btn sm ' + (delay === opt.value ? 'primary' : 'secondary')}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={helpStyle}>
          Drainer polls every 1 minute, so "Immediate" lands within ~60 seconds.
        </p>
      </div>

      {/* 5. Template editor */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>SMS Template</label>
        <textarea
          value={templateLocal}
          onChange={(e) => setTemplateLocal(e.target.value)}
          onBlur={onBlurTemplate}
          rows={3}
          disabled={!canEdit}
          style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
        />
        <p style={helpStyle}>
          Available: <code>{'{firstName}'}</code> · <code>{'{lastName}'}</code> · <code>{'{businessName}'}</code>
          {' · '}<code>{'{serviceType}'}</code> · <code>{'{city}'}</code> · <code>{'{vehicle}'}</code>
          {' · '}<code>{'{reviewLink}'}</code>
        </p>
      </div>

      {/* 6. Preview */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Live preview</label>
        <div style={previewBox}>{previewBody}</div>
        <p style={helpStyle}>
          {previewJob ? `Rendered against your last completed job (${previewJob.customerName ?? 'unknown'}).` : 'Rendered against sample data — no completed jobs yet.'}
        </p>
      </div>

      {/* 7. Send Test SMS */}
      {isOwnerOrAdmin && (
        <div className="field" style={{ marginBottom: 12, paddingTop: 10, borderTop: '1px solid var(--border, #2a2a2a)' }}>
          <label style={labelStyle}>Send Test SMS</label>
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+1 (555) 123-4567"
            style={inputStyle}
          />
          <button
            type="button"
            className="btn sm primary"
            disabled={testInFlight || !testPhone.trim()}
            onClick={onSendTest}
            style={{ marginTop: 6 }}
          >
            {testInFlight ? 'Sending…' : 'Send Test'}
          </button>
          {testStatus && <p style={{ ...helpStyle, color: 'var(--ok, #4ade80)', marginTop: 6 }}>{testStatus}</p>}
          {testError  && <p style={{ ...helpStyle, color: 'var(--danger, #f87171)', marginTop: 6 }}>Error: {testError}</p>}
          {!settings.twilioPhoneNumber?.trim() && (
            <p style={helpStyle}>
              Twilio is not connected. Test sends queue up; they'll deliver automatically once you configure a Twilio number in Missed Call Recovery.
            </p>
          )}
        </div>
      )}

      {/* 8. History */}
      <ReviewRequestHistoryTable businessId={businessId} />
    </AccordionShell>
  );
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

export const ReviewAutomationSection = memo(ReviewAutomationSectionImpl);
