// src/components/settings/CustomerDirectorySettingsSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerDirectorySettingsSection — Settings accordion (SP3 task 11)
//
//  Spec: §"Auto-Save Customers Setting (Phase 17)",
//        §"Backfill Existing Jobs (Phase 3)" §"Trigger UX"
//
//  Owner/admin-edit gated by canEditBusinessSettings.
//  Backfill button gated by isOwner (read from MembershipContext).
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useState } from 'react';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { initializeApp, getApps } from 'firebase/app';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { usePermissions, useMembership } from '@/context/MembershipContext';
import type { Settings } from '@/types';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
}

interface BackfillResult {
  customerCount: number;
  vehicleCount: number;
  jobsUpdated: number;
  mergesPerformed: number;
  legacyKeysRenamed: number;
  durationMs: number;
  auditDocPath: string;
  dryRun: boolean;
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

function CustomerDirectorySettingsSectionImpl({
  businessId, settings, open, onToggle, onSaveSettings,
}: Props) {
  const perms = usePermissions();
  const { role } = useMembership();
  const isOwner = role === 'owner';
  const canEdit = perms.canEditBusinessSettings ?? false;
  const autoSave = settings.autoSaveCustomersFromJobs ?? true;
  const [savingToggle, setSavingToggle] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<BackfillResult | null>(null);
  const [liveResult, setLiveResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFlipToggle = useCallback(async () => {
    if (savingToggle) return;
    setSavingToggle(true);
    try {
      const next = !autoSave;
      const patch: Record<string, unknown> = { autoSaveCustomersFromJobs: next };
      if (!next) {
        patch.autoSaveDisabledAt = new Date().toISOString();
      } else {
        patch.autoSaveReEnabledAt = new Date().toISOString();
      }
      await onSaveSettings(patch as Partial<Settings>);
    } finally {
      setSavingToggle(false);
    }
  }, [autoSave, onSaveSettings, savingToggle]);

  const runBackfill = useCallback(async (dryRun: boolean) => {
    setError(null);
    setBackfilling(true);
    try {
      const fn = httpsCallable<{ businessId: string; dryRun: boolean }, BackfillResult>(
        _getEmulatorAwareFunctions(),
        'backfillCustomers',
      );
      const { data } = await fn({ businessId, dryRun });
      if (dryRun) setDryRunResult(data);
      else { setLiveResult(data); setDryRunResult(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackfilling(false);
    }
  }, [businessId]);

  return (
    <AccordionShell
      title="Customer Directory"
      icon="📇"
      summary={autoSave ? 'Auto-save ON' : 'Auto-save OFF'}
      open={open}
      onToggle={onToggle}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'not-allowed' }}>
          <input
            type="checkbox"
            checked={autoSave}
            disabled={!canEdit || savingToggle}
            onChange={onFlipToggle}
          />
          <span style={{ fontWeight: 500 }}>Auto-save customers from completed jobs</span>
        </label>
        <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, marginLeft: 24 }}>
          When ON, every saved job upserts a Customer record + Vehicle subdoc.
          When OFF, jobs save without creating directory entries.
        </p>
      </div>

      {/* OFF→ON transition banner */}
      {autoSave && (settings as unknown as { autoSaveDisabledAt?: string }).autoSaveDisabledAt && !liveResult && (
        <div style={{
          padding: 10, marginBottom: 10,
          background: 'var(--warn-bg, #2a2418)', borderRadius: 6,
          border: '1px solid var(--warn-border, #5a4a18)',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--t1)' }}>
            Jobs may have saved while auto-save was off. Run Backfill to add them to your directory.
          </p>
        </div>
      )}

      {isOwner && (
        <div className="field" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>Backfill from Job History</div>
          <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
            Scans every job and creates Customer + Vehicle records.
            Idempotent — safe to re-run.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" className="btn sm secondary" disabled={backfilling} onClick={() => runBackfill(true)}>
              {backfilling ? 'Running…' : 'Dry Run'}
            </button>
            <button type="button" className="btn sm primary" disabled={backfilling || !dryRunResult} onClick={() => runBackfill(false)}>
              {backfilling ? 'Running…' : 'Run Backfill'}
            </button>
          </div>
          {dryRunResult && !liveResult && (
            <p style={{ fontSize: 12, color: 'var(--t2)' }}>
              Dry run: would create {dryRunResult.customerCount} customers, {dryRunResult.vehicleCount} vehicles,
              update {dryRunResult.jobsUpdated} jobs. ({dryRunResult.durationMs}ms)
            </p>
          )}
          {liveResult && (
            <p style={{ fontSize: 12, color: 'var(--ok, #4ade80)' }}>
              ✓ Backfill complete: {liveResult.customerCount} customers, {liveResult.vehicleCount} vehicles,
              {' '}{liveResult.jobsUpdated} jobs updated, {liveResult.mergesPerformed} merges. ({liveResult.durationMs}ms)
            </p>
          )}
          {error && (
            <p style={{ fontSize: 12, color: 'var(--danger, #f87171)' }}>Error: {error}</p>
          )}
        </div>
      )}
    </AccordionShell>
  );
}

export const CustomerDirectorySettingsSection = memo(CustomerDirectorySettingsSectionImpl);
