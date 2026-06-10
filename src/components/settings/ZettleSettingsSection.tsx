// src/components/settings/ZettleSettingsSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  ZettleSettingsSection — Settings accordion for the PayPal Zettle
//  payment-import integration (Phase 1).
//
//  Owner/admin only (gated by canViewPaymentIntegrations, and again in
//  Settings.tsx so the section never renders for technicians). Server
//  callables (connectZettle / importZettlePayments) re-check the role,
//  so this is defense in depth, not the only gate.
//
//  Ships DORMANT: until the MSOS Zettle app secrets are set server-side,
//  connectZettle throws failed-precondition and the UI shows a "not yet
//  available" note.
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useState } from 'react';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { usePermissions } from '@/context/MembershipContext';
import {
  listZettleReviewQueue, getJobBriefs,
  type ZettleReviewRow, type JobBrief,
} from '@/lib/zettlePayments';
import type { Settings } from '@/types';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
}

type RangeKey = '30' | '90' | '365';
interface ImportResult { imported: number; matched: number; review: number; pages: number }

function _getEmulatorAwareFunctions() {
  const fns = getFunctions();
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

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: '365', label: 'Last 12 months' },
];

function ZettleSettingsSectionImpl({ businessId, settings, open, onToggle, onSaveSettings }: Props) {
  const perms = usePermissions();
  const canEdit = perms.canViewPaymentIntegrations ?? false;

  const connected = settings.zettleConnected ?? false;
  const accountName = settings.zettleAccountName ?? '';
  const autoMatch = settings.zettleAutoMatchEnabled ?? true;
  const autoInvoice = settings.zettleAutoInvoiceEnabled ?? false;
  const includeAddress = settings.zettleIncludeAddressOnInvoice ?? false;
  const includeMap = settings.zettleIncludeMapOnInvoice ?? false;

  const [connecting, setConnecting] = useState(false);
  const [range, setRange] = useState<RangeKey>('30');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Review queue (low-confidence imports awaiting owner resolution).
  const [reviewRows, setReviewRows] = useState<ZettleReviewRow[]>([]);
  const [briefs, setBriefs] = useState<Record<string, JobBrief[]>>({});
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    if (!connected) return;
    const rows = await listZettleReviewQueue(businessId);
    setReviewRows(rows);
    const map: Record<string, JobBrief[]> = {};
    await Promise.all(rows.map(async (r) => { map[r.id] = await getJobBriefs(businessId, r.candidateJobIds); }));
    setBriefs(map);
  }, [businessId, connected]);

  useEffect(() => { if (open && connected) void loadReviews(); }, [open, connected, loadReviews]);

  const resolveOne = useCallback(async (paymentId: string, jobId: string) => {
    setReviewBusy(paymentId);
    setError(null);
    try {
      const fn = httpsCallable<{ businessId: string; paymentId: string; jobId: string }, { ok: boolean }>(
        _getEmulatorAwareFunctions(), 'resolveZettlePayment',
      );
      await fn({ businessId, paymentId, jobId });
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setReviewBusy(null); }
  }, [businessId, loadReviews]);

  const dismissOne = useCallback(async (paymentId: string) => {
    setReviewBusy(paymentId);
    setError(null);
    try {
      const fn = httpsCallable<{ businessId: string; paymentId: string }, { ok: boolean }>(
        _getEmulatorAwareFunctions(), 'dismissZettlePayment',
      );
      await fn({ businessId, paymentId });
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setReviewBusy(null); }
  }, [businessId, loadReviews]);

  const onConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const fn = httpsCallable<{ businessId: string }, { authorizeUrl: string }>(
        _getEmulatorAwareFunctions(),
        'connectZettle',
      );
      const { data } = await fn({ businessId });
      // Open Zettle's consent screen; the callback flips zettleConnected.
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }, [businessId]);

  const flip = useCallback(async (key: keyof Settings, next: boolean) => {
    try { await onSaveSettings({ [key]: next } as Partial<Settings>); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [onSaveSettings]);

  const runImport = useCallback(async () => {
    setError(null);
    setImporting(true);
    setImportResult(null);
    try {
      const fn = httpsCallable<{ businessId: string; range: RangeKey }, ImportResult>(
        _getEmulatorAwareFunctions(),
        'importZettlePayments',
      );
      const { data } = await fn({ businessId, range });
      setImportResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [businessId, range]);

  return (
    <AccordionShell
      title="PayPal Zettle"
      icon="💳"
      summary={connected ? `Connected${accountName ? ` · ${accountName}` : ''}` : 'Not connected'}
      open={open}
      onToggle={onToggle}
    >
      <div data-section="zettle" style={{ display: 'grid', gap: 14, padding: '4px 2px' }}>
        <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>
          Automatically import card payments taken on your Zettle reader, match them to the
          right job, mark it paid, and (soon) generate the invoice with service-location
          verification. Sensitive transaction data is visible to owners/admins only.
        </p>

        {/* Connect */}
        {!connected ? (
          <button
            type="button"
            className="btn"
            disabled={!canEdit || connecting}
            onClick={onConnect}
          >
            {connecting ? 'Opening Zettle…' : 'Connect Zettle'}
          </button>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--good, #2ecc71)' }}>
            ✅ Connected{accountName ? ` to ${accountName}` : ''}
          </div>
        )}

        {/* Automation toggles */}
        {connected && (
          <>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={autoMatch}
                disabled={!canEdit}
                onChange={() => flip('zettleAutoMatchEnabled', !autoMatch)}
              />
              Auto-match payments to jobs
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>
                (only confident matches; the rest go to a review queue)
              </span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={autoInvoice}
                disabled={!canEdit}
                onChange={() => flip('zettleAutoInvoiceEnabled', !autoInvoice)}
              />
              Auto-generate invoice on match
            </label>

            {/* Customer-invoice location verification (address + map only;
                raw GPS coordinates are never printed on a customer doc). */}
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Customer invoice</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={includeAddress}
                disabled={!canEdit}
                onChange={() => flip('zettleIncludeAddressOnInvoice', !includeAddress)}
              />
              Show service address
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={includeMap}
                disabled={!canEdit}
                onChange={() => flip('zettleIncludeMapOnInvoice', !includeMap)}
              />
              Show location map pin
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>(no GPS coordinates)</span>
            </label>

            {/* Historical import */}
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Import past payments</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={`chip ${range === r.key ? 'chip-active' : ''}`}
                    onClick={() => setRange(r.key)}
                    disabled={importing}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button type="button" className="btn" disabled={!canEdit || importing} onClick={runImport}>
                {importing ? 'Importing…' : 'Import'}
              </button>
              {importResult && (
                <div style={{ fontSize: 13, color: 'var(--t2)' }}>
                  Imported {importResult.imported} · auto-matched {importResult.matched} · needs review {importResult.review}
                </div>
              )}
            </div>

            {/* Review queue — resolve low-confidence imports in one tap.
                Reads zettleSecure (owner/admin rule-gated); writes go
                through the resolve/dismiss callables (Functions only). */}
            {reviewRows.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Needs review ({reviewRows.length})</div>
                {reviewRows.map((r) => (
                  <div key={r.id} style={{ border: '1px solid var(--line, #2a2f37)', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 13 }}>
                      <strong>${r.amount.toFixed(2)}</strong>
                      <span style={{ color: 'var(--t3)', marginLeft: 6 }}>{new Date(r.timestamp).toLocaleString()}</span>
                    </div>
                    {r.reasons[0] && <div style={{ fontSize: 12, color: 'var(--t3)' }}>{r.reasons[0]}</div>}
                    {(briefs[r.id] ?? []).length > 0 ? (
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ fontSize: 12, color: 'var(--t2)' }}>Match to:</div>
                        {(briefs[r.id] ?? []).map((j) => (
                          <button
                            key={j.id}
                            type="button"
                            className="btn"
                            style={{ fontSize: 13, justifyContent: 'flex-start' }}
                            disabled={reviewBusy === r.id}
                            onClick={() => resolveOne(r.id, j.id)}
                          >
                            {j.customerName || 'Job'} · ${Number(j.revenue || 0).toFixed(0)}{j.date ? ` · ${j.date}` : ''}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--t3)' }}>No candidate jobs found.</div>
                    )}
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12, opacity: 0.8 }}
                      disabled={reviewBusy === r.id}
                      onClick={() => dismissOne(r.id)}
                    >
                      Dismiss (no matching job)
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {error && (
          <div style={{ fontSize: 13, color: 'var(--bad, #e74c3c)' }}>
            {/failed-precondition|not configured/i.test(error)
              ? 'Zettle isn’t available yet — the integration is being set up.'
              : error}
          </div>
        )}
      </div>
    </AccordionShell>
  );
}

export const ZettleSettingsSection = memo(ZettleSettingsSectionImpl);
