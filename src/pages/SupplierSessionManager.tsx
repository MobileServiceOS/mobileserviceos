import { useCallback, useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { usePermissions } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';
import type { Settings } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  SupplierSessionManager — Wheel Rush-only.
//
//  Phase 2a UI. Owner/admin lands here from More → 🔌 Supplier Session.
//
//  The page does two things:
//    1. Verifies the stored U.S. AutoForce session (calls the backend
//       which makes a real authenticated request to the portal and
//       reports valid / expired / missing).
//    2. Accepts a "Copy as cURL" string pasted from DevTools after a
//       manual login, parses + validates server-side, and stores the
//       extracted cookies in Secret Manager.
//
//  Visibility is enforced on three sides:
//    - The MoreSheet entry only renders when billing-exempt + owner/
//      admin.
//    - This page checks those same conditions on mount and shows a 🔒
//      panel for anyone who reaches it via direct setTab() call.
//    - The backend callables enforce the canonical gate; the client
//      checks are defense-in-depth.
//
//  Security UX notes baked into this UI:
//    - Warns about clipboard hygiene before the paste box renders.
//    - Auto-clears the paste box after a successful save.
//    - Doesn't render any portion of the pasted cURL back to the user
//      (no risk of leaking it on screen-share scrollback).
//    - Doesn't store the cURL or extracted cookies in any React state
//      after the save completes.
// ─────────────────────────────────────────────────────────────────────

type SupplierName = 'U.S. AutoForce';

type SessionStatus = 'valid' | 'expired' | 'missing' | 'unknown' | 'checking';

interface Props {
  settings: Settings;
  onBack: () => void;
}

interface VerifyResponse {
  supplier: SupplierName;
  status: 'valid' | 'expired' | 'missing';
  checkedAt: string;
}

interface SetSessionResponse {
  ok: true;
  cookieCount: number;
  savedAt: string;
}

export function SupplierSessionManager({ settings, onBack }: Props) {
  const permissions = usePermissions();
  const isBillingExempt = settings.billingExempt === true;
  const allowed = isBillingExempt && permissions.canEditPricingSettings;

  const [status, setStatus] = useState<SessionStatus>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [curl, setCurl] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pasteAcknowledged, setPasteAcknowledged] = useState(false);
  const [lastSaved, setLastSaved] = useState<SetSessionResponse | null>(null);

  // Auto-verify on mount (only if allowed). One-time, no polling.
  const runVerify = useCallback(async () => {
    if (!allowed) return;
    setVerifying(true);
    setStatus('checking');
    try {
      const fn = httpsCallable<{ supplier: SupplierName }, VerifyResponse>(
        getFunctions(),
        'verifyWheelRushSupplierSession'
      );
      const result = await fn({ supplier: 'U.S. AutoForce' });
      setStatus(result.data.status);
      setLastCheckedAt(result.data.checkedAt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      addToast(msg, 'error');
      setStatus('unknown');
    } finally {
      setVerifying(false);
    }
  }, [allowed]);

  useEffect(() => {
    void runVerify();
  }, [runVerify]);

  const handleSave = useCallback(async () => {
    if (!curl.trim()) {
      addToast('Paste the cURL string first', 'error');
      return;
    }
    setSaving(true);
    try {
      const fn = httpsCallable<
        { supplier: SupplierName; curl: string },
        SetSessionResponse
      >(getFunctions(), 'setWheelRushSupplierSession');
      const result = await fn({ supplier: 'U.S. AutoForce', curl });
      setLastSaved(result.data);
      setCurl(''); // Clear paste box immediately on success
      setPasteAcknowledged(false);
      addToast(`Session saved (${result.data.cookieCount} cookies)`, 'success');
      // Auto-verify the freshly saved session
      void runVerify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      addToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [curl, runVerify]);

  if (!allowed) {
    return (
      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
          🔒 Not available
        </h1>
        <p style={{ color: 'var(--t3)', fontSize: 14, lineHeight: 1.5 }}>
          This feature is private to internal Wheel Rush accounts.
        </p>
        <button
          type="button"
          onClick={onBack}
          style={backBtnStyle}
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto', paddingBottom: 80 }}>
      <button type="button" onClick={onBack} style={backBtnStyle}>
        ← Back
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 4px' }}>
        🔌 Supplier Session
      </h1>
      <p style={{ color: 'var(--t3)', fontSize: 13, marginBottom: 20 }}>
        Manage the U.S. AutoForce portal session used by Wheel Rush supplier searches.
      </p>

      {/* Status panel */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          U.S. AutoForce
        </div>
        <StatusBadge status={status} verifying={verifying} />
        {lastCheckedAt && (
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            Last checked: {new Date(lastCheckedAt).toLocaleString()}
          </div>
        )}
        {lastSaved && (
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            Last saved: {new Date(lastSaved.savedAt).toLocaleString()} · {lastSaved.cookieCount} cookies
          </div>
        )}
        <button
          type="button"
          onClick={runVerify}
          disabled={verifying}
          style={{ ...secondaryBtnStyle, marginTop: 12 }}
        >
          {verifying ? 'Checking…' : 'Check Connection'}
        </button>
      </div>

      {/* Instructions card */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          How to (re)connect
        </div>
        <ol style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18, margin: 0, color: 'var(--t2)' }}>
          <li>Open <code style={codeStyle}>shop.usautoforce.com</code> in a new tab</li>
          <li>Log in normally and solve the CAPTCHA</li>
          <li>Press <kbd style={kbdStyle}>F12</kbd> (Windows) or <kbd style={kbdStyle}>⌥⌘I</kbd> (Mac) to open DevTools</li>
          <li>Network tab → reload the page → click any <code style={codeStyle}>shop.usautoforce.com</code> request</li>
          <li>Right-click the request → <strong>Copy → Copy as cURL</strong></li>
          <li>Paste below and tap Save Session</li>
        </ol>
        <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,180,0,0.06)', border: '1px solid rgba(255,180,0,0.3)', borderRadius: 6, fontSize: 11, lineHeight: 1.5, color: 'var(--t2)' }}>
          ⚠️ The cURL contains your live session. Don't paste while screen-sharing. Clear your clipboard after.
        </div>
      </div>

      {/* Paste / save card */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          Paste cURL string
        </div>
        {!pasteAcknowledged ? (
          <button
            type="button"
            onClick={() => setPasteAcknowledged(true)}
            style={primaryBtnStyle}
          >
            I'm ready to paste (no screen-share active)
          </button>
        ) : (
          <>
            <textarea
              value={curl}
              onChange={(e) => setCurl(e.target.value)}
              placeholder="curl 'https://shop.usautoforce.com/...' -H 'cookie: ...' ..."
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={{
                width: '100%',
                minHeight: 140,
                fontFamily: 'monospace',
                fontSize: 11,
                padding: 10,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--s2)',
                color: 'var(--t1)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
              {curl.length.toLocaleString()} chars · cleared on successful save
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !curl.trim()}
              style={{ ...primaryBtnStyle, marginTop: 10 }}
            >
              {saving ? 'Saving…' : 'Save Session'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, verifying }: { status: SessionStatus; verifying: boolean }) {
  if (verifying || status === 'checking') {
    return <Badge bg="rgba(150,150,150,0.18)" text="Checking…" />;
  }
  if (status === 'valid') {
    return <Badge bg="rgba(40,180,90,0.18)" text="🟢 Connected" />;
  }
  if (status === 'expired') {
    return <Badge bg="rgba(255,180,0,0.18)" text="🟡 Expired — reconnect required" />;
  }
  if (status === 'missing') {
    return <Badge bg="rgba(150,150,150,0.18)" text="⚪ Not connected" />;
  }
  return <Badge bg="rgba(150,150,150,0.18)" text="Unknown" />;
}

function Badge({ bg, text }: { bg: string; text: string }) {
  return (
    <span style={{
      display: 'inline-block',
      background: bg,
      color: 'var(--t1)',
      fontSize: 13,
      fontWeight: 700,
      padding: '6px 12px',
      borderRadius: 6,
    }}>
      {text}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--s1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 14,
  marginBottom: 14,
};

const backBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--t2)',
  fontSize: 13,
  padding: '6px 0',
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: 'var(--brand)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'var(--s2)',
  color: 'var(--t1)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const codeStyle: React.CSSProperties = {
  background: 'var(--s2)',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'monospace',
};

const kbdStyle: React.CSSProperties = {
  background: 'var(--s2)',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'monospace',
  border: '1px solid var(--border)',
};
