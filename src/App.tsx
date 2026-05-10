import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { _auth, _db, scopedCol, fbDelete, fbListen, fbSet } from '@/lib/firebase';
import { BrandProvider, useBrand } from '@/context/BrandContext';
import { AuthScreen } from '@/pages/AuthScreen';
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
import { JobSuccessPanel } from '@/components/JobSuccessPanel';
import { JobDetailModal } from '@/components/JobDetailModal';
import { addToast } from '@/lib/toast';
import { applyBrandColors, haptic, paymentPillClass, planInventoryDeduction, resolvePaymentStatus, uid } from '@/lib/utils';
import { generateInvoicePDF } from '@/lib/invoice';
import { openReviewSMS } from '@/lib/review';
import { APP_LOGO, DEFAULT_SETTINGS, EMPTY_JOB } from '@/lib/defaults';
import type { Expense, InventoryItem, Job, QuoteForm, Settings as SettingsT, SyncStatus, TabId } from '@/types';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!_auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(_auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  if (!authReady) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
        <img src={APP_LOGO} alt="" style={{ width: 64, height: 64, borderRadius: 16 }} className="logo-pulse" />
      </div>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <BrandProvider user={user}>
      <AuthenticatedApp user={user} />
    </BrandProvider>
  );
}

function AuthenticatedApp({ user }: { user: User }) {
  const { brand, businessId, loading: brandLoading } = useBrand();
  const [tab, setTab] = useState<TabId>('dashboard');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [inventory, setInventoryRaw] = useState<InventoryItem[]>([]);
  const [settings, setSettingsRaw] = useState<SettingsT>(DEFAULT_SETTINGS);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [prefillJob, setPrefillJob] = useState<Partial<Job> | null>(null);
  const [savedJob, setSavedJob] = useState<Job | null>(null);
  const [viewingJob, setViewingJob] = useState<Job | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local');
  const inventoryRef = useRef<InventoryItem[]>([]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  // Apply brand colors on mount + when brand updates
  useEffect(() => {
    applyBrandColors(brand.primaryColor, brand.accentColor);
  }, [brand.primaryColor, brand.accentColor]);

  // Subscribe to all Firestore collections for the current business
  useEffect(() => {
    if (!businessId || !_db) return;
    setSyncStatus('syncing');
    const unsubs: Array<() => void> = [];

    const jobsCol = scopedCol(businessId, 'jobs');
    unsubs.push(
      fbListen(jobsCol, (docs) => {
        setJobs(
          (docs as Job[]).map((d) => {
            const j = { ...d } as Job;
            if (typeof j.inventoryDeductions === 'string') {
              try {
                j.inventoryDeductions = JSON.parse(j.inventoryDeductions);
              } catch {
                j.inventoryDeductions = null;
              }
            }
            return j;
          })
        );
        setSyncStatus('connected');
      })
    );

    const invCol = scopedCol(businessId, 'inventory');
    unsubs.push(
      fbListen(invCol, (docs) => {
        setInventoryRaw(docs as InventoryItem[]);
      })
    );

    const expCol = scopedCol(businessId, 'expenses');
    unsubs.push(
      fbListen(expCol, (docs) => {
        setSettingsRaw((p) => ({ ...p, expenses: docs as Expense[] }));
      })
    );

    const opsCol = scopedCol(businessId, 'operational_settings');
    unsubs.push(
      fbListen(opsCol, (docs) => {
        const main = (docs as Array<Record<string, unknown> & { id: string }>).find((d) => d.id === 'main');
        if (main) {
          const parsed: Record<string, unknown> = { ...main };
          ['servicePricing', 'vehiclePricing'].forEach((k) => {
            if (typeof parsed[k] === 'string') {
              try {
                parsed[k] = JSON.parse(parsed[k] as string);
              } catch {
                /* ignore */
              }
            }
          });
          setSettingsRaw((p) => ({ ...p, ...(parsed as Partial<SettingsT>) }));
        }
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [businessId]);

  const persistSettings = useCallback(
    async (next: Partial<SettingsT>) => {
      if (!businessId) return;
      const ops = scopedCol(businessId, 'operational_settings');
      // Strip `expenses` — that collection is owned by persistExpenses
      const rest: Record<string, unknown> = {};
      Object.keys(next).forEach((k) => {
        if (k !== 'expenses') rest[k] = (next as Record<string, unknown>)[k];
      });
      if (Object.keys(rest).length) await fbSet(ops, 'main', rest);
      setSettingsRaw((p) => ({ ...p, ...next }));
    },
    [businessId]
  );

  const persistExpenses = useCallback(
    async (next: Expense[]) => {
      if (!businessId) return;
      const expCol = scopedCol(businessId, 'expenses');
      const prev = settings.expenses || [];
      const nextIds = new Set(next.map((e) => e.id));
      // Remove orphans
      for (const e of prev) {
        if (!nextIds.has(e.id)) await fbDelete(expCol, e.id);
      }
      // Upsert
      for (const e of next) {
        await fbSet(expCol, e.id, e as unknown as Record<string, unknown>);
      }
      setSettingsRaw((p) => ({ ...p, expenses: next }));
    },
    [businessId, settings.expenses]
  );

  const persistInventory = useCallback(
    async (next: InventoryItem[]) => {
      if (!businessId) return;
      const invCol = scopedCol(businessId, 'inventory');
      const prev = inventoryRef.current;
      const validNext = next.filter((i) => (i.size || '').trim());
      const nextIds = new Set(validNext.map((i) => i.id));
      for (const p of prev) {
        if (!nextIds.has(p.id)) await fbDelete(invCol, p.id);
      }
      for (const i of validNext) {
        const { _isNew, ...rest } = i;
        await fbSet(invCol, i.id, rest as unknown as Record<string, unknown>);
      }
      setInventoryRaw(validNext);
    },
    [businessId]
  );

  const saveJob = useCallback(
    async (job: Job, addAnother: boolean) => {
      if (!businessId) {
        addToast('Sign in required', 'warn');
        return;
      }
      setSaving(true);
      try {
        const jobsCol = scopedCol(businessId, 'jobs');
        const invCol = scopedCol(businessId, 'inventory');
        const finalJob: Job = {
          ...job,
          id: job.id || uid(),
          lastEditedAt: new Date().toISOString(),
        };

        // Inventory deduction handling for completed tire-source=Inventory jobs
        let workingInv = [...inventoryRef.current];
        const previousJob = jobs.find((j) => j.id === finalJob.id);
        // Restore previous deductions (if any)
        if (previousJob && previousJob.inventoryDeductions) {
          let prevDeds = previousJob.inventoryDeductions;
          if (typeof prevDeds === 'string') {
            try {
              prevDeds = JSON.parse(prevDeds);
            } catch {
              prevDeds = null;
            }
          }
          if (Array.isArray(prevDeds)) {
            for (const d of prevDeds) {
              const idx = workingInv.findIndex((i) => i.id === d.id);
              if (idx >= 0) {
                workingInv[idx] = { ...workingInv[idx], qty: Number(workingInv[idx].qty || 0) + Number(d.qty || 0) };
                await fbSet(invCol, workingInv[idx].id, workingInv[idx] as unknown as Record<string, unknown>);
              }
            }
          }
        }
        finalJob.inventoryDeductions = null;

        // Apply new deductions if applicable
        if (
          finalJob.tireSource === 'Inventory' &&
          finalJob.status === 'Completed' &&
          finalJob.tireSize &&
          Number(finalJob.qty || 0) > 0
        ) {
          const plan = planInventoryDeduction(finalJob.tireSize, Number(finalJob.qty), workingInv);
          if (plan.shortfall > 0) {
            addToast(`Short ${plan.shortfall} of ${finalJob.tireSize}`, 'warn');
          }
          for (const d of plan.deductions) {
            const idx = workingInv.findIndex((i) => i.id === d.id);
            if (idx >= 0) {
              workingInv[idx] = {
                ...workingInv[idx],
                qty: Math.max(0, Number(workingInv[idx].qty || 0) - Number(d.qty || 0)),
              };
              await fbSet(invCol, workingInv[idx].id, workingInv[idx] as unknown as Record<string, unknown>);
            }
          }
          finalJob.inventoryDeductions = plan.deductions;
          if (plan.deductions.length) {
            const totalCost = plan.deductions.reduce((t, d) => t + Number(d.cost || 0) * Number(d.qty || 0), 0);
            if (!Number(finalJob.tireCost || 0)) finalJob.tireCost = totalCost;
          }
        }

        await fbSet(jobsCol, finalJob.id, finalJob as unknown as Record<string, unknown>);
        setInventoryRaw(workingInv);

        haptic(20);
        if (addAnother) {
          setEditJob(null);
          setPrefillJob(null);
          addToast('Job saved · ready for next', 'success');
        } else {
          setSavedJob(finalJob);
          setEditJob(null);
          setPrefillJob(null);
          setTab('success');
        }
      } catch (e) {
        console.warn('saveJob:', e);
        addToast('Save failed — try again', 'error');
      } finally {
        setSaving(false);
      }
    },
    [businessId, jobs]
  );

  const deleteJob = useCallback(
    async (id: string) => {
      if (!businessId) return;
      const jobsCol = scopedCol(businessId, 'jobs');
      const invCol = scopedCol(businessId, 'inventory');
      // Restore inventory deductions if present
      const j = jobs.find((x) => x.id === id);
      if (j && j.inventoryDeductions) {
        let deds = j.inventoryDeductions;
        if (typeof deds === 'string') {
          try {
            deds = JSON.parse(deds);
          } catch {
            deds = null;
          }
        }
        if (Array.isArray(deds)) {
          const inv = [...inventoryRef.current];
          for (const d of deds) {
            const idx = inv.findIndex((i) => i.id === d.id);
            if (idx >= 0) {
              inv[idx] = { ...inv[idx], qty: Number(inv[idx].qty || 0) + Number(d.qty || 0) };
              await fbSet(invCol, inv[idx].id, inv[idx] as unknown as Record<string, unknown>);
            }
          }
          setInventoryRaw(inv);
        }
      }
      await fbDelete(jobsCol, id);
      addToast('Job deleted', 'success');
    },
    [businessId, jobs]
  );

  const handleGenerateInvoice = useCallback(
    async (j: Job) => {
      const result = generateInvoicePDF(j, settings, brand);
      if (!result || !businessId) return;
      const jobsCol = scopedCol(businessId, 'jobs');
      const updated: Job = {
        ...j,
        invoiceGenerated: true,
        invoiceGeneratedAt: new Date().toISOString(),
        invoiceNumber: result.invoiceNumber,
      };
      await fbSet(jobsCol, j.id, updated as unknown as Record<string, unknown>);
      addToast('Invoice generated', 'success');
    },
    [settings, brand, businessId]
  );

  const handleSendInvoice = useCallback(
    async (j: Job) => {
      if (!businessId) return;
      // Generate first if needed
      if (!j.invoiceGenerated) {
        await handleGenerateInvoice(j);
      }
      const jobsCol = scopedCol(businessId, 'jobs');
      const updated: Job = { ...j, invoiceSent: true, invoiceSentAt: new Date().toISOString() };
      await fbSet(jobsCol, j.id, updated as unknown as Record<string, unknown>);
      const phone = (j.customerPhone || '').replace(/\D/g, '');
      const msg = encodeURIComponent(
        `Hi ${j.customerName || ''}, here's your invoice from ${brand.businessName}. Total: $${j.revenue}. Thanks!`
      );
      window.open(phone ? `sms:${phone}?body=${msg}` : `sms:?body=${msg}`);
    },
    [businessId, brand, handleGenerateInvoice]
  );

  const handleSendReview = useCallback(
    async (j: Job) => {
      if (!brand.reviewUrl) {
        addToast('Set review URL in Settings', 'warn');
        return;
      }
      openReviewSMS(j.customerPhone || '', brand.reviewUrl, j.customerName || '', j.service, j.area || '', brand.businessName);
      if (!businessId) return;
      const jobsCol = scopedCol(businessId, 'jobs');
      const updated: Job = { ...j, reviewRequested: true, reviewRequestedAt: new Date().toISOString() };
      await fbSet(jobsCol, j.id, updated as unknown as Record<string, unknown>);
    },
    [businessId, brand]
  );

  const handleMarkPaid = useCallback(
    async (j: Job) => {
      if (!businessId) return;
      const jobsCol = scopedCol(businessId, 'jobs');
      const updated: Job = { ...j, paymentStatus: 'Paid' };
      await fbSet(jobsCol, j.id, updated as unknown as Record<string, unknown>);
      addToast('Marked as paid', 'success');
    },
    [businessId]
  );

  const handleDuplicate = useCallback((j: Job) => {
    const dup: Partial<Job> = { ...j, id: '', invoiceGenerated: false, invoiceSent: false, reviewRequested: false };
    setPrefillJob(dup);
    setTab('add');
  }, []);

  const handleSignOut = useCallback(async () => {
    if (!_auth) return;
    if (!confirm('Sign out?')) return;
    await signOut(_auth);
  }, []);

  const startJobFromQuote = useCallback((form: QuoteForm) => {
    setPrefillJob({ ...EMPTY_JOB(), ...form });
    setTab('add');
  }, []);

  const navItems: { id: TabId; icon: string; label: string }[] = useMemo(
    () => [
      { id: 'dashboard', icon: '⚡', label: 'Home' },
      { id: 'add', icon: '＋', label: 'Add' },
      { id: 'history', icon: '📋', label: 'Jobs' },
      { id: 'customers', icon: '👥', label: 'People' },
      { id: 'payouts', icon: '💰', label: 'Pay' },
      { id: 'expenses', icon: '📊', label: 'Costs' },
      { id: 'inventory', icon: '🛞', label: 'Tires' },
      { id: 'settings', icon: '⚙️', label: 'Setup' },
    ],
    []
  );

  if (brandLoading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
        <img src={APP_LOGO} alt="" style={{ width: 64, height: 64, borderRadius: 16 }} className="logo-pulse" />
      </div>
    );
  }

  return (
    <div className="app" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header syncStatus={syncStatus} onSignOut={handleSignOut} />
      <main style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {tab === 'dashboard' && (
          <Dashboard
            jobs={jobs}
            settings={settings}
            inventory={inventory}
            setTab={setTab}
            onStartJob={startJobFromQuote}
            onViewJob={(j) => setViewingJob(j)}
            onGenerateInvoice={handleGenerateInvoice}
            onSendReview={handleSendReview}
            onMarkPaid={handleMarkPaid}
            onEditJob={(j) => {
              setEditJob(j);
              setTab('add');
            }}
          />
        )}
        {tab === 'add' && (
          <AddJob
            settings={settings}
            prefill={prefillJob}
            editJob={editJob}
            saving={saving}
            onSave={saveJob}
            onClearPrefill={() => setPrefillJob(null)}
          />
        )}
        {tab === 'history' && (
          <History
            jobs={jobs}
            settings={settings}
            onEdit={(j) => {
              setEditJob(j);
              setTab('add');
            }}
            onViewJob={(j) => setViewingJob(j)}
            onGenerateInvoice={handleGenerateInvoice}
            onSendReview={handleSendReview}
            onMarkPaid={handleMarkPaid}
          />
        )}
        {tab === 'customers' && <Customers jobs={jobs} settings={settings} onViewJob={(j) => setViewingJob(j)} />}
        {tab === 'payouts' && <Payouts jobs={jobs} settings={settings} />}
        {tab === 'expenses' && <Expenses expenses={settings.expenses || []} onSave={persistExpenses} />}
        {tab === 'inventory' && <Inventory inventory={inventory} onSave={persistInventory} />}
        {tab === 'settings' && (
          <Settings
            settings={settings}
            inventoryCount={inventory.length}
            jobsCount={jobs.length}
            onSaveSettings={persistSettings}
          />
        )}
        {tab === 'success' && savedJob && (
          <JobSuccessPanel
            job={savedJob}
            settings={settings}
            brand={brand}
            onGenerateInvoice={() => handleGenerateInvoice(savedJob)}
            onSendReview={() => handleSendReview(savedJob)}
            onEditJob={() => {
              setEditJob(savedJob);
              setTab('add');
            }}
            onViewJob={() => setViewingJob(savedJob)}
            onDuplicate={() => handleDuplicate(savedJob)}
            onClose={() => {
              setSavedJob(null);
              setTab('dashboard');
            }}
          />
        )}
      </main>
      <nav className="bottom-nav">
        {navItems.map((n) => (
          <button
            key={n.id}
            data-id={n.id}
            className={'nav-btn' + (tab === n.id ? ' active' : '')}
            onClick={() => {
              haptic();
              if (n.id === 'add') {
                setEditJob(null);
                setPrefillJob(null);
              }
              setTab(n.id);
            }}
          >
            {n.id === 'dashboard' ? (
              <img
                src={brand.logoUrl || APP_LOGO}
                alt=""
                className="nav-logo-ico"
                style={{ width: 19, height: 19, objectFit: 'contain' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = APP_LOGO;
                }}
              />
            ) : (
              <span className="ico">{n.icon}</span>
            )}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {viewingJob && (
        <JobDetailModal
          job={viewingJob}
          settings={settings}
          onClose={() => setViewingJob(null)}
          onEdit={(j) => {
            setEditJob(j);
            setTab('add');
          }}
          onDelete={deleteJob}
          onGenerateInvoice={handleGenerateInvoice}
          onSendInvoice={handleSendInvoice}
          onSendReview={handleSendReview}
          onMarkPaid={handleMarkPaid}
          onDuplicate={handleDuplicate}
        />
      )}
      <InstallBanner />
      <ToastHost />
    </div>
  );
}
