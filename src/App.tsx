import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { _auth, _db, scopedCol, fbDelete, fbListen, fbSet, initError } from '@/lib/firebase';
import { BrandProvider, useBrand } from '@/context/BrandContext';
import { MembershipProvider } from '@/context/MembershipContext';
import { AuthScreen } from '@/pages/AuthScreen';
import { InviteAccept } from '@/pages/InviteAccept';
import { Dashboard } from '@/pages/Dashboard';
import { AddJob } from '@/pages/AddJob';
import { History } from '@/pages/History';
import { Customers } from '@/pages/Customers';
import { Payouts } from '@/pages/Payouts';
import { Expenses } from '@/pages/Expenses';
import { Inventory } from '@/pages/Inventory';
import { Settings } from '@/pages/Settings';
import { Header } from '@/components/Header';
import { ToastHost } from '@/components/ToastHost';
import { InstallBanner } from '@/components/InstallBanner';
import { MoreSheet } from '@/components/MoreSheet';
import { JobSuccessPanel } from '@/components/JobSuccessPanel';
import { JobDetailModal } from '@/components/JobDetailModal';
import { Onboarding } from '@/components/Onboarding';
import { addToast } from '@/lib/toast';
import { humanizeFirestoreError, logFirestoreError, isPermissionDenied } from '@/lib/firebaseErrors';
import { applyBrandColors, planInventoryDeduction, r2, uid } from '@/lib/utils';
import { generateInvoicePDF } from '@/lib/invoice';
import { openReviewSMS } from '@/lib/review';
import { APP_LOGO, DEFAULT_SETTINGS, EMPTY_JOB } from '@/lib/defaults';
import {
  deserializeExpense,
  deserializeInventoryItem,
  deserializeJob,
  deserializeOperationalSettings,
  mergeMissingDefaultServices,
  stripRetiredServices,
} from '@/lib/deserializers';
import type {
  Brand, Expense, InventoryItem, Job, QuoteForm, Settings as SettingsT, SyncStatus, TabId,
} from '@/types';

declare global {
  interface Window {
    __msosReady?: () => void;
    __msosShowError?: (title: string, detail?: string) => void;
  }
}

function signalReady() {
  if (typeof window !== 'undefined' && typeof window.__msosReady === 'function') window.__msosReady();
}

// humanizeFirestoreError + logFirestoreError moved to src/lib/firebaseErrors.ts.
// Imported above. The local copy used to live here but has been promoted to
// the shared module so other call sites (BrandContext, invoice rendering,
// invites flow) can use the same friendly mapping.

/**
 * Parse the invite token from `?invite=<token>` on initial page load.
 * Captured at module scope so it survives navigation events that
 * mutate window.location (we want the invite to apply for the whole
 * session, not just the first render).
 *
 * Returns null if no token, or if window is unavailable (SSR).
 */
function readInviteTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

const INITIAL_INVITE_TOKEN: string | null = readInviteTokenFromUrl();

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // Held in state so InviteAccept can clear it (e.g. on "Continue to
  // sign in" from an invalid-invite screen) without forcing a hard
  // page reload.
  const [inviteToken, setInviteToken] = useState<string | null>(INITIAL_INVITE_TOKEN);

  useEffect(() => {
    if (!_auth) {
      setAuthReady(true);
      signalReady();
      return;
    }
    const t = setTimeout(() => {
      console.warn('[auth] onAuthStateChanged did not fire within 8s, proceeding as signed-out.');
      setAuthReady(true);
      signalReady();
    }, 8000);
    const unsub = onAuthStateChanged(_auth, (u) => {
      clearTimeout(t);
      setUser(u);
      setAuthReady(true);
      signalReady();
    });
    return () => { clearTimeout(t); unsub(); };
  }, []);

  useEffect(() => { applyBrandColors('#c8a44a', '#e5c770'); }, []);

  if (initError) {
    return (
      <div style={{ padding: 24, color: '#f87171' }}>
        <h2>Firebase initialization failed</h2>
        <pre>{initError.message}</pre>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="splash">
        <img src={APP_LOGO} alt="" className="splash-logo" />
        <div className="splash-name">Mobile Service OS</div>
      </div>
    );
  }

  if (!user) {
    // If the URL has ?invite=<token>, route to the dedicated invite
    // onboarding page. InviteAccept handles BOTH new and existing
    // users — Google sign-in, email signup, email login — and calls
    // acceptInvite() automatically after auth succeeds.
    if (inviteToken) {
      return (
        <>
          <InviteAccept
            token={inviteToken}
            onAuth={(u) => {
              // Invite is already accepted by the time we get here.
              // Clear the token + clean the URL so a refresh doesn't
              // try to re-process it.
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete('invite');
                window.history.replaceState({}, document.title, url.toString());
              } catch { /* */ }
              setInviteToken(null);
              setUser(u);
            }}
          />
          <ToastHost />
        </>
      );
    }
    return (
      <>
        <AuthScreen onAuth={setUser} />
        <ToastHost />
      </>
    );
  }

  return (
    <BrandProvider user={user}>
      <AuthenticatedApp user={user} />
    </BrandProvider>
  );
}

function AuthenticatedApp({ user }: { user: User }) {
  const { brand, businessId, loading: brandLoading, onboardingComplete, updateBrand } = useBrand();
  const [tab, setTab] = useState<TabId>('dashboard');
  // Bottom-sheet visibility for the "More" tab. Replaces the previous
  // behavior of routing the More button straight to Settings, since
  // owners also need access to Payouts, Expenses, and Customers —
  // tabs that previously had no UI entry point.
  const [moreOpen, setMoreOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [inventory, setInventoryRaw] = useState<InventoryItem[]>([]);
  const [settings, setSettingsRaw] = useState<SettingsT>(DEFAULT_SETTINGS);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local');
  const [jobDraft, setJobDraft] = useState<Job>(EMPTY_JOB());
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [savedJob, setSavedJob] = useState<Job | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [prefilledFromQuote, setPrefilledFromQuote] = useState(false);

  // Keep latest inventory ref for the save flow's inventory-deduction logic
  const inventoryRef = useRef<InventoryItem[]>([]);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);

  // Once-per-session suppression flag for permission-denied toasts.
  // Avoids spamming the user with the same "Some data isn't
  // accessible…" message four times in quick succession when the
  // auth/rules bootstrap window briefly denies multiple collections.
  const _shownPermissionToast = useRef(false);

  // ── Listeners ──
  useEffect(() => {
    if (!businessId || !_db) return;
    setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
    const unsubs: Array<() => void> = [];

    // Diagnostic log on every business attach — surfaces uid /
    // businessId / email so a permission-denied story in DevTools is
    // immediately clear about which account/business was active. The
    // role is logged separately once the membership listener returns
    // it (see BrandContext / TeamManagement console.info statements).
    // eslint-disable-next-line no-console
    console.info('[sync] attaching listeners', {
      uid: _auth?.currentUser?.uid ?? 'unauthed',
      email: _auth?.currentUser?.email ?? null,
      businessId,
    });

    const ready = { jobs: false, inv: false, exp: false, ops: false };
    const markReady = (k: keyof typeof ready) => {
      ready[k] = true;
      if (Object.values(ready).every(Boolean)) setSyncStatus('connected');
    };
    // Quiet error handler: structured console log + ONE friendly
    // toast per error code per session. Suppresses the original
    // pattern of 4+ "Sync error (collection): ..." toasts fired at
    // once during the auth bootstrap race or rules-deploy lag.
    //
    // The toast appears at most once per error code (so a
    // permission-denied storm during onboarding shows a single
    // "Some data isn't accessible…" message, not four). We update
    // syncStatus on every error so the header pill reflects state.
    const handleErr = (label: string) => (e: Error) => {
      logFirestoreError(`${label} listener`, e, { businessId });
      setSyncStatus((prev) => (prev === 'connected' ? 'sync_failed' : prev));

      // Skip the toast for permission-denied during the initial auth/
      // rules bootstrap window — these self-resolve within seconds
      // once BrandContext finishes seeding the user/member docs.
      if (isPermissionDenied(e) && _shownPermissionToast.current) return;
      if (isPermissionDenied(e)) {
        _shownPermissionToast.current = true;
        // 8-second timer so a transient bootstrap race doesn't latch
        // the suppression permanently.
        setTimeout(() => { _shownPermissionToast.current = false; }, 8000);
      }

      addToast(humanizeFirestoreError(e), 'warn');
    };

    unsubs.push(fbListen(scopedCol(businessId, 'jobs'), (docs) => {
      setJobs(docs.map(deserializeJob));
      markReady('jobs');
    }, handleErr('jobs')));

    unsubs.push(fbListen(scopedCol(businessId, 'inventory'), (docs) => {
      setInventoryRaw(docs.map(deserializeInventoryItem));
      markReady('inv');
    }, handleErr('inventory')));

    unsubs.push(fbListen(scopedCol(businessId, 'expenses'), (docs) => {
      setSettingsRaw((p) => ({ ...p, expenses: docs.map(deserializeExpense) }));
      markReady('exp');
    }, handleErr('expenses')));

    unsubs.push(fbListen(scopedCol(businessId, 'operational_settings'), (docs) => {
      const main = docs.find((d) => d.id === 'main');
      if (main) {
        const parsed = deserializeOperationalSettings(main);

        // Backfill: merge any newly-shipped default services into the
        // user's existing servicePricing map. Lets new default services
        // appear automatically without a one-off migration. The user's
        // price customizations on existing services are NEVER touched
        // — only missing keys are added.
        const merge = mergeMissingDefaultServices(parsed.servicePricing);
        if (merge.added.length > 0) {
          parsed.servicePricing = merge.map;
          // Persist back so this account doesn't re-merge on every
          // load. Fire-and-forget — failure just re-runs the merge
          // next load (idempotent).
          // eslint-disable-next-line no-console
          console.info('[settings] backfilling new default services', merge.added);
          fbSet(scopedCol(businessId, 'operational_settings'), 'main', {
            servicePricing: merge.map,
          }).catch((e: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[settings] service backfill persist failed (non-fatal):', e);
          });
        }

        // Cleanup: strip retired default services from the stored
        // map. Catches accounts that auto-received a service (via a
        // previous backfill) that has since been removed from the
        // catalog (e.g. "Spare Change" added then retired in 2026-05).
        // Like the backfill, persists back so the cleanup is sticky.
        const strip = stripRetiredServices(parsed.servicePricing);
        if (strip.removed.length > 0) {
          parsed.servicePricing = strip.map;
          // eslint-disable-next-line no-console
          console.info('[settings] stripping retired services', strip.removed);
          fbSet(scopedCol(businessId, 'operational_settings'), 'main', {
            servicePricing: strip.map,
          }).catch((e: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[settings] service cleanup persist failed (non-fatal):', e);
          });
        }

        setSettingsRaw((p) => ({ ...p, ...parsed }));
      }
      markReady('ops');
    }, handleErr('settings')));

    return () => unsubs.forEach((u) => u());
  }, [businessId]);

  // Online/offline awareness
  useEffect(() => {
    const onOnline = () => setSyncStatus((prev) => (prev === 'offline' ? 'syncing' : prev));
    const onOffline = () => setSyncStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) setSyncStatus('offline');
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ── Write callbacks ──
  const persistSettings = useCallback(
    async (next: Partial<SettingsT>) => {
      if (!businessId) { addToast('Sign in to save settings', 'warn'); return; }
      const ops = scopedCol(businessId, 'operational_settings');
      const rest: Record<string, unknown> = {};
      Object.keys(next).forEach((k) => { if (k !== 'expenses') rest[k] = (next as Record<string, unknown>)[k]; });
      try {
        if (Object.keys(rest).length) await fbSet(ops, 'main', rest);
        setSettingsRaw((p) => ({ ...p, ...next }));
      } catch (e) {
        setSyncStatus('sync_failed');
        addToast(`Settings save failed: ${humanizeFirestoreError(e)}`, 'error');
        throw e;
      }
    },
    [businessId]
  );

  const persistExpenses = useCallback(
    async (next: Expense[]) => {
      if (!businessId) { addToast('Sign in to save expenses', 'warn'); return; }
      const expCol = scopedCol(businessId, 'expenses');
      const prev = settings.expenses || [];
      const nextIds = new Set(next.map((e) => e.id));
      try {
        for (const e of prev) if (!nextIds.has(e.id)) await fbDelete(expCol, e.id);
        for (const e of next) await fbSet(expCol, e.id, e);
        setSettingsRaw((p) => ({ ...p, expenses: next }));
      } catch (e) {
        setSyncStatus('sync_failed');
        addToast(`Expenses save failed: ${humanizeFirestoreError(e)}`, 'error');
        throw e;
      }
    },
    [businessId, settings.expenses]
  );

  const persistInventory = useCallback(
    async (next: InventoryItem[]) => {
      if (!businessId) { addToast('Sign in to save inventory', 'warn'); return; }
      const invCol = scopedCol(businessId, 'inventory');
      const prev = inventoryRef.current || [];
      const validNext = next.filter((i) => (i.size || '').trim());
      const nextIds = new Set(validNext.map((i) => i.id));
      try {
        for (const p of prev) if (!nextIds.has(p.id)) await fbDelete(invCol, p.id);
        for (const i of validNext) {
          const { _isNew, ...rest } = i;
          await fbSet(invCol, i.id, rest);
        }
        setInventoryRaw(validNext);
      } catch (e) {
        setSyncStatus('sync_failed');
        addToast(`Inventory save failed: ${humanizeFirestoreError(e)}`, 'error');
        throw e;
      }
    },
    [businessId]
  );

  const handleStartJob = useCallback((form: QuoteForm) => {
    setJobDraft({
      ...EMPTY_JOB(),
      service: form.service,
      vehicleType: form.vehicleType,
      miles: form.miles ?? '',
      tireCost: form.tireCost ?? '',
      materialCost: form.materialCost ?? '',
      qty: form.qty ?? 1,
      revenue: form.revenue ?? '',
      emergency: !!form.emergency,
      lateNight: !!form.lateNight,
      highway: !!form.highway,
      weekend: !!form.weekend,
    });
    setEditingJobId(null);
    setPrefilledFromQuote(true);
    setTab('add');
  }, []);

  const saveJob = useCallback(async (resetAfter = false): Promise<Job | null> => {
    if (!businessId) { addToast('Sign in to save', 'warn'); return null; }
    const j = jobDraft;
    const isEditing = Boolean(editingJobId);
    const jobsCol = scopedCol(businessId, 'jobs');
    const invCol = scopedCol(businessId, 'inventory');

    let workingInv: InventoryItem[] = [...(inventoryRef.current || [])];
    let deductions: { id: string; size: string; qty: number; cost: number }[] | null = null;
    let computedTireCost = Number(j.tireCost || 0);

    try {
      if (j.tireSource === 'Inventory' && j.tireSize) {
        // If editing, restore previous deductions first
        if (isEditing) {
          const prev = jobs.find((x) => x.id === editingJobId);
          const oldDeds = prev && Array.isArray(prev.inventoryDeductions) ? prev.inventoryDeductions : null;
          if (oldDeds) {
            for (const d of oldDeds) {
              const idx = workingInv.findIndex((i) => i.id === d.id);
              if (idx >= 0) workingInv[idx] = { ...workingInv[idx], qty: Number(workingInv[idx].qty || 0) + Number(d.qty || 0) };
            }
          }
        }
        const plan = planInventoryDeduction(j.tireSize, Number(j.qty || 1), workingInv);
        deductions = plan.deductions;
        // Compute weighted tire cost from FIFO plan
        const planTotal = plan.deductions.reduce((s, d) => s + d.cost * d.qty, 0);
        if (planTotal > 0) computedTireCost = r2(planTotal);
        // Apply deductions to working inventory
        for (const d of plan.deductions) {
          const idx = workingInv.findIndex((i) => i.id === d.id);
          if (idx >= 0) workingInv[idx] = { ...workingInv[idx], qty: Math.max(0, Number(workingInv[idx].qty || 0) - Number(d.qty || 0)) };
          await fbSet(invCol, workingInv[idx >= 0 ? idx : 0]?.id || d.id, workingInv[idx >= 0 ? idx : 0] || {});
        }
        setInventoryRaw(workingInv);
        if (plan.shortfall > 0) addToast(`Logged with shortfall of ${plan.shortfall} tire(s)`, 'warn');
      } else if (j.tireSource === 'Bought for this job') {
        computedTireCost = Number(j.tirePurchasePrice || j.tireCost || 0);
      } else if (j.tireSource === 'Customer supplied') {
        computedTireCost = 0;
      }

      const currentUid = _auth?.currentUser?.uid || '';
      const finalJob: Job = {
        ...j,
        id: j.id || uid(),
        tireCost: computedTireCost,
        inventoryDeductions: deductions,
        lastEditedAt: new Date().toISOString(),
        // Stamp createdByUid + createdAt the FIRST time a job is saved.
        // On edits we preserve the original creator — this is what
        // powers the technician dashboard filter (only see your own
        // jobs). For pre-existing jobs without a createdByUid (e.g.
        // imported historical data) the field stays empty and only
        // owner/admin see those jobs; technicians get a clean view
        // of their own work going forward.
        createdByUid: j.createdByUid || currentUid,
        createdAt: j.createdAt || new Date().toISOString(),
      };
      await fbSet(jobsCol, finalJob.id, finalJob);
      addToast(isEditing ? 'Job updated' : 'Job saved', 'success');
      setSavedJob(finalJob);
      if (resetAfter) {
        setJobDraft(EMPTY_JOB());
        setEditingJobId(null);
        setPrefilledFromQuote(false);
        setTab('add');
      } else {
        setTab('success');
      }
      return finalJob;
    } catch (e) {
      console.error('[saveJob] failed:', e);
      setSyncStatus('sync_failed');
      addToast(`Save failed: ${humanizeFirestoreError(e)}`, 'error');
      return null;
    }
  }, [businessId, jobDraft, editingJobId, jobs]);

  const deleteJob = useCallback(async (id: string) => {
    if (!businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    const invCol = scopedCol(businessId, 'inventory');
    try {
      const j = jobs.find((x) => x.id === id);
      const deds = j && Array.isArray(j.inventoryDeductions) ? j.inventoryDeductions : null;
      if (deds) {
        const inv = [...(inventoryRef.current || [])];
        for (const d of deds) {
          const idx = inv.findIndex((i) => i.id === d.id);
          if (idx >= 0) {
            inv[idx] = { ...inv[idx], qty: Number(inv[idx].qty || 0) + Number(d.qty || 0) };
            await fbSet(invCol, inv[idx].id, inv[idx]);
          }
        }
        setInventoryRaw(inv);
      }
      await fbDelete(jobsCol, id);
      addToast('Job deleted', 'success');
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Delete failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId, jobs]);

  const handleGenerateInvoice = useCallback(async (j: Job) => {
    // generateInvoicePDF is async — it pre-loads the brand logo via fetch
    // before rendering. The previous code missed the await, so `result`
    // was a Promise and `.invoiceNumber` came back undefined (and TS
    // flagged the property access). The await fixes both runtime and
    // type errors.
    const result = await generateInvoicePDF(j, settings, brand);
    if (!result || !businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    const updated: Job = {
      ...j,
      invoiceGenerated: true,
      invoiceGeneratedAt: new Date().toISOString(),
      invoiceNumber: result.invoiceNumber,
    };
    try {
      await fbSet(jobsCol, j.id, updated);
      addToast('Invoice generated', 'success');
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Invoice save failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [settings, brand, businessId]);

  const handleSendInvoice = useCallback(async (j: Job) => {
    if (!businessId) return;
    if (!j.invoiceGenerated) await handleGenerateInvoice(j);
    const jobsCol = scopedCol(businessId, 'jobs');
    const updated: Job = { ...j, invoiceSent: true, invoiceSentAt: new Date().toISOString() };
    try {
      await fbSet(jobsCol, j.id, updated);
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Invoice update failed: ${humanizeFirestoreError(e)}`, 'error');
      return;
    }
    const phone = (j.customerPhone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Hi ${j.customerName || ''}, here's your invoice from ${brand.businessName}. Total: $${j.revenue}. Thanks!`);
    window.open(phone ? `sms:${phone}?body=${msg}` : `sms:?body=${msg}`);
  }, [businessId, brand, handleGenerateInvoice]);

  const handleSendReview = useCallback(async (j: Job) => {
    if (!brand.reviewUrl) { addToast('Set review URL in Settings', 'warn'); return; }
    const location = j.fullLocationLabel || j.area || '';
    openReviewSMS(j.customerPhone || '', brand.reviewUrl, j.customerName || '', j.service, location, brand.businessName, j.state);
    if (!businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    const updated: Job = { ...j, reviewRequested: true, reviewRequestedAt: new Date().toISOString() };
    try {
      await fbSet(jobsCol, j.id, updated);
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Review flag save failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId, brand]);

  const handleMarkPaid = useCallback(async (j: Job) => {
    if (!businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    const updated: Job = { ...j, paymentStatus: 'Paid' };
    try {
      await fbSet(jobsCol, j.id, updated);
      addToast('Marked as paid', 'success');
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Mark-paid failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId]);

  const handleEditJob = useCallback((j: Job) => {
    setJobDraft({ ...j });
    setEditingJobId(j.id);
    setPrefilledFromQuote(false);
    setDetailJob(null);
    setTab('add');
  }, []);

  const handleViewJob = useCallback((j: Job) => setDetailJob(j), []);

  const handleDuplicate = useCallback((j: Job) => {
    setJobDraft({ ...j, id: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), revenue: '', paymentStatus: 'Paid', status: 'Completed', invoiceGenerated: false, invoiceSent: false, reviewRequested: false, lastEditedAt: null });
    setEditingJobId(null);
    setPrefilledFromQuote(false);
    setDetailJob(null);
    setTab('add');
  }, []);

  const handleOnboardingComplete = useCallback(async (brandPatch: Partial<Brand>, settingsPatch: Partial<SettingsT>) => {
    try {
      await updateBrand(brandPatch);
      if (Object.keys(settingsPatch).length) await persistSettings(settingsPatch);
      addToast('Welcome aboard!', 'success');
    } catch (e) {
      addToast(`Onboarding save failed: ${humanizeFirestoreError(e)}`, 'error');
      throw e;
    }
  }, [updateBrand, persistSettings]);

  const onSignOut = useCallback(async () => {
    if (!_auth) return;
    try { await signOut(_auth); } catch { /* */ }
  }, []);

  const tabContent = useMemo(() => {
    if (tab === 'dashboard') {
      return (
        <Dashboard
          jobs={jobs}
          settings={settings}
          inventory={inventory}
          setTab={setTab}
          onStartJob={handleStartJob}
          onViewJob={handleViewJob}
          onGenerateInvoice={handleGenerateInvoice}
          onSendInvoice={handleSendInvoice}
          onSendReview={handleSendReview}
          onMarkPaid={handleMarkPaid}
          onEditJob={handleEditJob}
        />
      );
    }
    if (tab === 'add') {
      return (
        <AddJob
          job={jobDraft}
          setJob={setJobDraft}
          settings={settings}
          inventory={inventory}
          isEditing={Boolean(editingJobId)}
          prefilledFromQuote={prefilledFromQuote}
          onSave={async () => { await saveJob(false); }}
          onSaveAndNew={async () => { await saveJob(true); }}
        />
      );
    }
    if (tab === 'history') return (
      <History
        jobs={jobs}
        settings={settings}
        onViewJob={handleViewJob}
        onMarkPaid={handleMarkPaid}
        onEditJob={handleEditJob}
        onGenerateInvoice={handleGenerateInvoice}
        onSendInvoice={handleSendInvoice}
        onSendReview={handleSendReview}
      />
    );
    if (tab === 'customers') return <Customers jobs={jobs} settings={settings} />;
    if (tab === 'payouts') return <Payouts jobs={jobs} settings={settings} />;
    if (tab === 'expenses') return <Expenses expenses={settings.expenses || []} onSave={persistExpenses} />;
    if (tab === 'inventory') return <Inventory inventory={inventory} onSave={persistInventory} />;
    if (tab === 'settings') return <Settings settings={settings} onSave={persistSettings} />;
    if (tab === 'success' && savedJob) {
      return (
        <JobSuccessPanel
          job={savedJob}
          settings={settings}
          brand={brand}
          onGenerateInvoice={() => handleGenerateInvoice(savedJob)}
          onSendReview={() => handleSendReview(savedJob)}
          onEditJob={() => handleEditJob(savedJob)}
          onViewJob={() => handleViewJob(savedJob)}
          onDuplicate={() => handleDuplicate(savedJob)}
          onMarkPaid={() => handleMarkPaid(savedJob)}
          onClose={() => { setSavedJob(null); setTab('dashboard'); }}
        />
      );
    }
    return null;
  }, [tab, jobs, settings, inventory, jobDraft, editingJobId, prefilledFromQuote, savedJob, brand,
      handleStartJob, handleViewJob, handleGenerateInvoice, handleSendReview, handleMarkPaid,
      handleEditJob, handleDuplicate, saveJob, persistExpenses, persistInventory, persistSettings]);

  if (brandLoading) {
    return (
      <div className="splash">
        <img src={APP_LOGO} alt="" className="splash-logo" />
        <div className="splash-name">Loading your business…</div>
      </div>
    );
  }

  if (!onboardingComplete) {
    return (
      <>
        <Onboarding settings={settings} onComplete={handleOnboardingComplete} />
        <ToastHost />
      </>
    );
  }

  return (
    <MembershipProvider settings={settings}>
      <Header syncStatus={syncStatus} onSignOut={onSignOut} />
      <main className="main-content">{tabContent}</main>
      <nav className="bottom-nav">
        <button className={'nav-btn' + (tab === 'dashboard' ? ' active' : '')} onClick={() => setTab('dashboard')}>
          <span className="nav-ico">🏠</span><span>Home</span>
        </button>
        <button className={'nav-btn' + (tab === 'history' ? ' active' : '')} onClick={() => setTab('history')}>
          <span className="nav-ico">📋</span><span>Jobs</span>
        </button>
        <button className={'nav-btn primary' + (tab === 'add' ? ' active' : '')} onClick={() => {
          setJobDraft(EMPTY_JOB());
          setEditingJobId(null);
          setPrefilledFromQuote(false);
          setTab('add');
        }}>
          <span className="nav-ico">＋</span><span>Log</span>
        </button>
        <button className={'nav-btn' + (tab === 'inventory' ? ' active' : '')} onClick={() => setTab('inventory')}>
          <span className="nav-ico">🛞</span><span>Inv</span>
        </button>
        <button
          className={'nav-btn' + ((tab === 'settings' || tab === 'payouts' || tab === 'expenses' || tab === 'customers') ? ' active' : '')}
          onClick={() => setMoreOpen(true)}
        >
          <span className="nav-ico">⚙</span><span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          onPick={(t) => { setTab(t); setMoreOpen(false); }}
        />
      )}
      {detailJob && (
        <JobDetailModal
          job={detailJob}
          settings={settings}
          onClose={() => setDetailJob(null)}
          onEdit={() => handleEditJob(detailJob)}
          onDuplicate={() => handleDuplicate(detailJob)}
          onDelete={() => { void deleteJob(detailJob.id); setDetailJob(null); }}
          onGenerateInvoice={() => handleGenerateInvoice(detailJob)}
          onSendInvoice={() => handleSendInvoice(detailJob)}
          onSendReview={() => handleSendReview(detailJob)}
          onMarkPaid={() => handleMarkPaid(detailJob)}
        />
      )}
      <InstallBanner />
      <ToastHost />
    </MembershipProvider>
  );
}

export default App;
