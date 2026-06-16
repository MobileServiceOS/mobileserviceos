import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from 'react';
import { onAuthStateChanged,
  signOut,
  type User } from 'firebase/auth';
import { doc,
  onSnapshot,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { _auth, _db, scopedCol, fbDelete, fbListen, fbSet, fbSetFast, initError, requireDb } from '@/lib/firebase';
import { buildJobsListenerQuery } from '@/lib/jobsQuery';
import { BrandProvider, useBrand } from '@/context/BrandContext';
import { MembershipProvider, usePermissions, useMembership } from '@/context/MembershipContext';
import { BusinessSwitcherProvider } from '@/context/BusinessSwitcherContext';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { servicePricingFromVertical } from '@/lib/verticals';
import { AuthScreen } from '@/pages/AuthScreen';
import { InviteAccept } from '@/pages/InviteAccept';
import { PrivacyTerms } from '@/pages/PrivacyTerms';
import { Dashboard } from '@/pages/Dashboard';
import { AddJob } from '@/pages/AddJob';
import { History } from '@/pages/History';
import { Inventory } from '@/pages/Inventory';
// Secondary tabs are lazy-loaded to keep the initial bundle lean.
// Dashboard / AddJob / History / Inventory are the daily-driver
// surfaces (the four eager imports above). Insights / Payouts /
// Expenses / Customers / Settings / Help all live behind the More
// sheet and are only loaded when the operator actually opens them.
const Help      = lazy(() => import('@/pages/Help').then((m)      => ({ default: m.Help })));
// SP1 (task 8): CustomerHub is the new top-level Customers tab.
// Lazy-loaded — same pattern as the page it wraps.
const CustomerHub = lazy(() => import('@/pages/CustomerHub'));
const CustomerProfile = lazy(() => import('@/pages/CustomerProfile'));
const Insights  = lazy(() => import('@/pages/Insights').then((m)  => ({ default: m.Insights })));
const Payouts   = lazy(() => import('@/pages/Payouts').then((m)   => ({ default: m.Payouts })));
const PaymentsDashboard = lazy(() => import('@/pages/PaymentsDashboard').then((m) => ({ default: m.PaymentsDashboard })));
const Expenses  = lazy(() => import('@/pages/Expenses').then((m)  => ({ default: m.Expenses })));
const Settings  = lazy(() => import('@/pages/Settings').then((m)  => ({ default: m.Settings })));
import { Header } from '@/components/Header';
import { GlobalSearchSheet } from '@/components/GlobalSearchSheet';
import { ToastHost } from '@/components/ToastHost';
import { InstallBanner } from '@/components/InstallBanner';
import { UpdateBanner } from '@/components/UpdateBanner';
import { MoreSheet } from '@/components/MoreSheet';
import { NavHome, NavJobs, NavCustomers, NavInventory, NavLog, NavMore } from '@/components/NavIcons';
import { IncomingCallNotification } from '@/components/IncomingCallNotification';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { TrialCountdownBanner } from '@/components/TrialCountdownBanner';
import { JobSuccessPanel } from '@/components/JobSuccessPanel';
import { JobDetailModal } from '@/components/JobDetailModal';
import { SizeLinkProvider } from '@/components/SizeLink';
import { PageSkeleton } from '@/components/Skeleton';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { ActiveTimerBar } from '@/components/ActiveTimerBar';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Onboarding } from '@/components/Onboarding';
import { PaywallLockout } from '@/components/PaywallLockout';
import { shouldLockApp, isExistingCustomer } from '@/lib/planAccess';
import { addToast, addActionToast } from '@/lib/toast';
import { humanizeFirestoreError, logFirestoreError, isPermissionDenied } from '@/lib/firebaseErrors';
import { applyBrandColors, planInventoryDeduction, r2, uid } from '@/lib/utils';
import { getLastPaymentMethod, setLastPaymentMethod } from '@/lib/paymentMethodMemory';
import { computeJobTireCost } from '@/lib/jobTireCost';
import { planJobInventory } from '@/lib/planJobInventory';
import { upsertCustomerFromJob, reverseCustomerFromJob } from '@/lib/customerEntity';
import { normalizePhone } from '@/lib/phone';
import { planJobCancelRefund } from '@/lib/inventoryRefund';
// invoice.ts is lazy-imported in handleGenerateInvoice — see comment
// there. Keeps jspdf (358 KB) + html2canvas (201 KB) out of the main
// bundle until the operator actually generates an invoice.
import { openReviewSMSFromJob, shouldPromptReview } from '@/lib/review';
import { APP_LOGO, DEFAULT_SETTINGS, EMPTY_JOB } from '@/lib/defaults';
import { attachStripeSync } from '@/lib/stripeSync';
import {
  deserializeExpense,
  deserializeInventoryItem,
  deserializeJob,
  deserializeOperationalSettings,
  mergeMissingDefaultServices,
  stripRetiredServices,
} from '@/lib/deserializers';
import type {
  Brand, Expense, InventoryItem, Job, PaymentMethod, QuoteForm, Settings as SettingsT, SyncStatus, TabId,
} from '@/types';
// CustomerMeta type no longer imported here — the Customers page
// (src/pages/Customers.tsx) owns the listener + state directly.

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

/**
 * Parse the legal-doc param from `?legal=privacy` or `?legal=terms`.
 * Public, shareable URL — works both signed-in and signed-out so
 * Stripe / App Store / email footers can link to the docs directly.
 */
function readLegalTabFromUrl(): 'privacy' | 'terms' | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('legal');
    if (t === 'privacy' || t === 'terms') return t;
    return null;
  } catch {
    return null;
  }
}

const INITIAL_LEGAL_TAB: 'privacy' | 'terms' | null = readLegalTabFromUrl();

/**
 * Parse `?help=1` URL param. Public, shareable URL so marketing pages
 * and support emails can deep-link to the FAQ.
 */
function readHelpFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('help') === '1';
  } catch {
    return false;
  }
}

const INITIAL_HELP_OPEN = readHelpFromUrl();

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(INITIAL_INVITE_TOKEN);
  // Legal docs are publicly viewable — auth-independent. Gated BEFORE
  // the splash/auth checks so an unauthenticated user landing on
  // ?legal=privacy can read the policy without signing up.
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms' | null>(INITIAL_LEGAL_TAB);
  // Help / FAQ — also publicly viewable so support emails and marketing
  // pages can deep-link via ?help=1.
  const [helpOpen, setHelpOpen] = useState<boolean>(INITIAL_HELP_OPEN);

  const closeLegal = useCallback(() => {
    setLegalTab(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('legal');
      window.history.replaceState({}, document.title, url.toString());
    } catch { /* */ }
  }, []);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('help');
      window.history.replaceState({}, document.title, url.toString());
    } catch { /* */ }
  }, []);

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

  useEffect(() => { applyBrandColors('#f4b400', '#f7ca4d'); }, []);

  if (initError) {
    return (
      <div style={{ padding: 24, color: '#f87171' }}>
        <h2>Firebase initialization failed</h2>
        <pre>{initError.message}</pre>
      </div>
    );
  }

  // Legal docs are publicly viewable BEFORE auth — checked here so the
  // share URL works for prospective customers, Stripe, App Store, etc.
  if (legalTab) {
    return <PrivacyTerms initialTab={legalTab} onBack={closeLegal} />;
  }

  // Help / FAQ — also publicly viewable. Useful for support emails
  // and marketing pages that want to deep-link to a specific FAQ.
  if (helpOpen) {
    return <Help onBack={closeHelp} />;
  }

  if (!authReady) {
    return (
      <div className="splash">
        <img src={APP_LOGO} alt="" className="splash-logo" />
        <div className="splash-name">Mobile Service OS</div>
      </div>
    );
  }

  // ─── Pending invite (hoisted above the user check) ───────────────
  // While we have an invite token, keep showing InviteAccept until
  // the invite-acceptance pipeline finishes — even when auth state
  // changes mid-flight. createUserWithEmailAndPassword resolves AND
  // triggers onAuthStateChanged → setUser BEFORE InviteAccept's
  // acceptInvite() write completes. Without this hoist, App would
  // unmount InviteAccept the instant auth completed, race the
  // in-flight acceptInvite, and BrandProvider would see "no users/
  // {uid} doc yet" — falling into its fresh-signup branch and
  // bootstrapping a brand new business for the invitee.
  //
  // InviteAccept's onAuth callback clears inviteToken AFTER
  // acceptInvite() has fully resolved (or the user dismisses an
  // invalid invite via "Continue to sign in"), so this branch only
  // renders while an invite is genuinely pending.
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

  if (!user) {
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

/** Generic render-time permission gate. Wraps a page-content element
 *  and replaces it with a friendly access-denied panel when the
 *  requested permission isn't held. Defense-in-depth: the bottom-nav /
 *  MoreSheet already hide the entry point, but a direct setTab() call
 *  (e.g. from a notification deep-link) shouldn't be able to render a
 *  financial page for a technician. */
function PermissionGate({
  title, granted, children,
}: { title: string; granted: boolean; children: React.ReactNode }) {
  if (granted) return <>{children}</>;
  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      <div style={{
        padding: 14,
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        fontSize: 12,
        color: 'var(--t3)',
        lineHeight: 1.5,
      }}>
        {title} is available to owners and admins. Ask the business
        owner if you need access.
      </div>
    </div>
  );
}

/** Insights tab gate — owner / admin only (canViewFinancials). */
function InsightsGate({ jobs, settings, inventory }: { jobs: Job[]; settings: SettingsT; inventory: InventoryItem[] }) {
  const { canViewFinancials } = usePermissions();
  return (
    <PermissionGate title="Insights" granted={canViewFinancials}>
      <Insights jobs={jobs} settings={settings} inventory={inventory} />
    </PermissionGate>
  );
}

/** Payouts tab gate — owner / admin only (canManageBilling). */
function PayoutsGate({ jobs, settings }: { jobs: Job[]; settings: SettingsT }) {
  const { canManageBilling } = usePermissions();
  return (
    <PermissionGate title="Payouts" granted={canManageBilling}>
      <Payouts jobs={jobs} settings={settings} />
    </PermissionGate>
  );
}

/** Payments tab gate — owner / admin only. Shows job-based collections:
 *  outstanding, collected by window/method, and sales by technician. */
function PaymentsGate({ jobs, settings }: { jobs: Job[]; settings: SettingsT }) {
  const { canViewPaymentIntegrations } = usePermissions();
  return (
    <PermissionGate title="Payments" granted={canViewPaymentIntegrations}>
      <PaymentsDashboard jobs={jobs} workWeekStartDay={settings.workWeekStartDay} />
    </PermissionGate>
  );
}

/** Expenses tab gate — owner / admin only (canViewFinancials). */
function ExpensesGate({
  expenses, jobs, settings, onSave,
}: {
  expenses: Expense[];
  jobs: Job[];
  settings: SettingsT;
  onSave: (next: Expense[]) => Promise<void>;
}) {
  const { canViewFinancials } = usePermissions();
  return (
    <PermissionGate title="Expenses" granted={canViewFinancials}>
      <Expenses expenses={expenses} jobs={jobs} settings={settings} onSave={onSave} />
    </PermissionGate>
  );
}


/** Technician landing redirect. On first membership resolution, if
 *  the user is a technician and they're still on the default Home
 *  tab (no navigation yet), shift them to the Jobs tab — that's the
 *  workspace they actually use, where the Dashboard's KPI-heavy
 *  layout is largely irrelevant to them.
 *
 *  Owner / admin land on Home as before. The redirect only fires
 *  once per session (applied ref) so the operator can still navigate
 *  back to Home whenever they want. */
function TechnicianLanding({
  tab, setTab,
}: { tab: TabId; setTab: (t: TabId) => void }) {
  const membership = useMembership();
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    if (membership.loading || !membership.role) return;
    applied.current = true;
    if (membership.role === 'technician' && tab === 'dashboard') {
      setTab('history');
    }
  }, [membership.loading, membership.role, tab, setTab]);
  return null;
}

function AuthenticatedApp({ user }: { user: User }) {
  const { brand, businessId, loading: brandLoading, onboardingComplete, inviteAcceptError, updateBrand } = useBrand();
  // Active vertical's service catalog drives the operational_settings
  // backfill + strip pass below. Without this, mechanic / detailing
  // accounts would have tire services injected and their mechanic /
  // detailing services stripped on every load. Resolves via
  // BrandContext.brand.businessType so it tracks business switches.
  const activeVertical = useActiveVertical();
  const verticalCatalog = useMemo(
    () => servicePricingFromVertical(activeVertical),
    [activeVertical],
  );
  const [tab, setTab] = useState<TabId>('dashboard');
  // SP3 task 9: selected customer id for CustomerProfile drill-down.
  // Set when a customer row is clicked; consumed by the
  // tab === 'customerProfile' render branch below.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  // Deep-link target for Inventory — set when a tire size is tapped elsewhere
  // (e.g. a job in History), consumed by the Inventory view on arrival.
  const [inventoryFocusSize, setInventoryFocusSize] = useState<string | null>(null);
  // Single SizeLink navigator — every tappable size in the app routes here.
  const openInventoryForSize = (size: string) => { setInventoryFocusSize(size); setTab('inventory'); };
  // Reverse link: Inventory "View jobs for this size" → History filtered.
  const [historyFocusSize, setHistoryFocusSize] = useState<string | null>(null);
  const openJobsForSize = (size: string) => { setHistoryFocusSize(size); setTab('history'); };
  // SP3 task 10: GlobalSearchSheet open state.
  const [searchOpen, setSearchOpen] = useState(false);
  // SP3: permissions for the new Customer Hub + Profile RBAC gating.
  const { canViewFinancials, canEditBusinessSettings } = usePermissions();
  // The current member — stamped onto a manually-collected payment so
  // the job records WHO collected it (owner/admin reporting).
  const { member: currentMember } = useMembership();
  // Bottom-sheet visibility for the "More" tab. Replaces the previous
  // behavior of routing the More button straight to Settings, since
  // owners also need access to Payouts, Expenses, and Customers —
  // tabs that previously had no UI entry point.
  const [moreOpen, setMoreOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  // First-snapshot flag for the jobs listener — drives the History (Jobs)
  // loading skeleton so it shows structure instead of a blank screen.
  const [jobsReady, setJobsReady] = useState(false);
  const bp = useBreakpoint();
  const [inventory, setInventoryRaw] = useState<InventoryItem[]>([]);
  const [settings, setSettingsRaw] = useState<SettingsT>(DEFAULT_SETTINGS);
  // Has the settings/main subscription listener fired at least once?
  // Used to gate the paywall lockout — without this, a freshly-opened
  // PWA briefly renders PaywallLockout because shouldLockApp({}) is
  // true while subscription fields are still in flight. Flipped true
  // on the first snapshot (whether the doc exists or not) and never
  // flipped back. Stays true for the session.
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  // Customer metadata (notes + tags). Subscribed at App level so the
  // Customers list view can render tag chips and filter by tag
  // without paying a per-row Firestore read.
  // (customerMeta state moved into the Customers page itself — lazy
  // listener that only fires when the user opens the Customers tab.)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local');
  const [jobDraft, setJobDraft] = useState<Job>(EMPTY_JOB());
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [savedJob, setSavedJob] = useState<Job | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [prefilledFromQuote, setPrefilledFromQuote] = useState(false);

  // Sub-Project D: subscribe to business members for owner/tech
  // resolution in the notification dispatcher.
  // useBusinessMembers is consumed by AddJob's AssignmentPicker via
  // its own hook call; no need to thread it through App.tsx anymore
  // since the notification dispatcher (Sub-Project D) was removed.

  // Keep latest inventory ref for the save flow's inventory-deduction logic
  const inventoryRef = useRef<InventoryItem[]>([]);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  // Settings ref — needed by the inventory snapshot handler to read
  // the current lowStockThreshold without re-subscribing on every
  // settings change. Updated on every render.
  const settingsRef = useRef<SettingsT>(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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

    // Hotfix (2026-05-31, audit P1): the jobs listener used to
    // subscribe to the entire collection — every cold start streamed
    // every historical job (~2 KB/doc) down the wire before the
    // Dashboard could render. buildJobsListenerQuery bounds the
    // listener to the most-recent JOBS_LISTENER_PAGE_SIZE (200)
    // jobs by `date` desc. See src/lib/jobsQuery.ts.
    const jobsCol = scopedCol(businessId, 'jobs');
    unsubs.push(fbListen(jobsCol ? buildJobsListenerQuery(jobsCol) : null, (docs) => {
      setJobs(docs.map(deserializeJob));
      setJobsReady(true);
      markReady('jobs');
    }, handleErr('jobs')));

    unsubs.push(fbListen(scopedCol(businessId, 'inventory'), (docs) => {
      const next = docs.map(deserializeInventoryItem);
      setInventoryRaw(next);
      markReady('inv');
    }, handleErr('inventory')));

    unsubs.push(fbListen(scopedCol(businessId, 'expenses'), (docs) => {
      setSettingsRaw((p) => ({ ...p, expenses: docs.map(deserializeExpense) }));
      markReady('exp');
    }, handleErr('expenses')));

    // Customers listener was here previously — moved into the
    // Customers page (src/pages/Customers.tsx) so it only fires when
    // the user navigates to that tab. Saves a Firestore listener
    // connection on every cold start for the (common) case where
    // the operator never opens Customers.

    unsubs.push(fbListen(scopedCol(businessId, 'operational_settings'), (docs) => {
      const main = docs.find((d) => d.id === 'main');
      if (!main) {
        // Auto-heal: businesses created via the buggy
        // pre-d4724d6 AddBusinessModal flow never got their
        // operational_settings/main seeded. Without this branch
        // they're stuck with DEFAULT_SETTINGS (tire catalog) on a
        // mechanic / detailing vertical, so AddJob's service
        // dropdown is empty. Seed the canonical vertical catalog
        // on first read where the doc is missing — fire-and-forget;
        // failure re-runs next load (idempotent).
        // eslint-disable-next-line no-console
        console.info('[settings] operational_settings/main missing — seeding vertical defaults');
        fbSet(scopedCol(businessId, 'operational_settings'), 'main', {
          servicePricing: verticalCatalog,
          createdAt: new Date().toISOString(),
        }).catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[settings] auto-seed failed (non-fatal):', e);
        });
        markReady('ops');
        return;
      }
      if (main) {
        const parsed = deserializeOperationalSettings(main);

        // Backfill: merge any newly-shipped default services into the
        // user's existing servicePricing map. Lets new default services
        // appear automatically without a one-off migration. The user's
        // price customizations on existing services are NEVER touched
        // — only missing keys are added.
        const merge = mergeMissingDefaultServices(parsed.servicePricing, verticalCatalog);
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
        const strip = stripRetiredServices(parsed.servicePricing, verticalCatalog);
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

        // Strip stray Brand-owned fields that historically leaked into
        // operational_settings/main via the legacy {...DEFAULT_SETTINGS,
        // ...patch} merge pattern. The canonical home for businessName
        // is settings/main (BrandContext); any value here is stale and
        // would overwrite the correct Brand-context value in the
        // React state. Wheel Rush hit this as a 'My Business' Live
        // Preview in Missed Call Recovery — see
        // src/components/settings/MissedCallRecoverySection.tsx.
        delete (parsed as Record<string, unknown>).businessName;
        setSettingsRaw((p) => ({ ...p, ...parsed }));
      }
      markReady('ops');
    }, handleErr('settings')));

    // Subscription + exemption mirror — reads /businesses/{id}/settings/main
    // (different doc from operational_settings/main above) where
    // BrandContext + stripeSync write the canonical subscription state:
    //   - subscriptionStatus, plan, trialEndsAt, trialStartedAt (Stripe-mirrored)
    //   - billingExempt, subscriptionOverride, exemptionGrantedAt/By/Reason
    //     (lifetime/founder fields, written via Admin SDK only)
    //
    // CRITICAL: targets the SINGLE doc 'main' directly via onSnapshot(doc(...))
    // rather than fbListen() on the whole collection. The collection-list path
    // triggers a `list` rule evaluation which is heavier (and was implicated
    // in 20–40s save lag). Single-doc reads only eval the read rule once and
    // never re-list.
    if (_db) {
      const settingsMainRef = doc(_db, `businesses/${businessId}/settings/main`);
      const unsubSettings = onSnapshot(
        settingsMainRef,
        (snap) => {
          // Mark subscription-loaded on the very first snapshot,
          // regardless of doc existence. A missing doc means the
          // user has no subscription state on file (legitimate
          // empty), which the lockout/grandfather logic handles —
          // we just need to know we've heard back from the listener.
          setSubscriptionLoaded(true);
          if (!snap.exists()) return;
          const main = snap.data() as Record<string, unknown>;
          // Whitelist the subscription/exemption fields. BrandContext
          // handles brand/onboarding fields on the same doc separately.
          const subscriptionFields: Partial<SettingsT> = {};
          const keys: Array<keyof SettingsT> = [
            'subscriptionStatus',
            'plan',
            'stripeSubscriptionId',
            'trialStartedAt',
            'trialEndsAt',
            'billingExempt',
            'subscriptionOverride',
            'exemptionGrantedAt',
            'exemptionGrantedBy',
            'exemptionReason',
            // Used by the existing-customer trial migration (App.tsx)
            // and the shouldLockApp grandfather check (planAccess.ts).
            'onboardingComplete',
            'onboardingCompletedAt',
          ];
          for (const k of keys) {
            const v = main[k as string];
            if (v !== undefined) {
              (subscriptionFields as Record<string, unknown>)[k as string] = v;
            }
          }
          if (Object.keys(subscriptionFields).length > 0) {
            setSettingsRaw((p) => ({ ...p, ...subscriptionFields }));
          }
        },
        (err) => {
          // Quiet — same doc is already being read by BrandContext;
          // any permission error there is the canonical source.
          logFirestoreError('settings/main mirror', err as Error, { businessId });
        },
      );
      unsubs.push(unsubSettings);
    }

    return () => unsubs.forEach((u) => u());
    // verticalCatalog is part of the dep array because the operational_
    // settings backfill/strip pass uses it to decide which services
    // to add/remove. In normal usage the catalog is stable for a given
    // business (set when brand.businessType resolves); on a business
    // switch BrandContext reloads the whole tab via
    // window.location.reload(), so this listener is torn down anyway.
  }, [businessId, verticalCatalog]);

  // ─── Stripe → Firestore subscription mirror ──────────────────
  // Attach a listener that watches the Stripe Extension's subscription
  // docs (written by Stripe webhooks → Cloud Functions → Firestore)
  // and mirrors the canonical subscription state into the business's
  // settings/main doc. WITHOUT this listener wired, no Stripe webhook
  // event ever reaches the app — checkouts succeed in Stripe but the
  // app shows them as still "trialing" or "inactive".
  //
  // Skips entirely for exempt accounts (Wheel Rush founder) — the
  // mirror has a billingExempt check that prevents downgrades, and
  // exempt accounts have no Stripe subscription to mirror anyway.
  useEffect(() => {
    if (!user?.uid || !businessId) return;
    const unsub = attachStripeSync(user.uid, businessId);
    return () => unsub();
  }, [user?.uid, businessId]);

  // ─── Existing-customer trial migration ─────────────────────────
  // For accounts that completed onboarding BEFORE the paywall flip
  // (2026-05-28T00:00:00Z) and don't yet have a subscription, stamp
  // a 14-day trialing status starting on this first post-flip visit.
  // This is the "fairness" path — pre-paywall users had free access
  // during Founder Access and deserve a real trial window (plus the
  // auto-applied founder discount at checkout) before being locked
  // out. shouldLockApp() pre-emptively grandfathers them as unlocked,
  // so they never see a flash of lockout while this write is in
  // flight.
  //
  // Idempotent: once subscriptionStatus is set (to anything), the
  // guard below short-circuits and the migration never runs again.
  useEffect(() => {
    if (!businessId || !_db) return;
    if (!settings.onboardingComplete) return;
    if (settings.subscriptionStatus) return; // already stamped (or paid/canceled)
    if (settings.billingExempt === true) return; // exempt accounts skip
    if (!isExistingCustomer(settings)) return; // post-flip signups go through Onboarding
    const nowMs = Date.now();
    const trialEndsAtIso = new Date(nowMs + 14 * 24 * 60 * 60 * 1000).toISOString();
    const trialStartedAtIso = new Date(nowMs).toISOString();
    // eslint-disable-next-line no-console
    console.info('[trial-migration] stamping 14-day trial for existing customer', {
      businessId,
      onboardingCompletedAt: settings.onboardingCompletedAt,
      trialStartedAt: trialStartedAtIso,
      trialEndsAt: trialEndsAtIso,
    });
    const ref = doc(_db, `businesses/${businessId}/settings/main`);
    setDoc(ref, {
      subscriptionStatus: 'trialing',
      trialStartedAt: trialStartedAtIso,
      trialEndsAt: trialEndsAtIso,
    }, { merge: true }).catch((err: unknown) => {
      // Non-fatal — they stay grandfathered (shouldLockApp returns
      // false for isExistingCustomer) on this load. Next load retries.
      // eslint-disable-next-line no-console
      console.warn('[trial-migration] stamp failed (non-fatal):', err);
    });
  }, [
    businessId,
    settings.onboardingComplete,
    settings.onboardingCompletedAt,
    settings.subscriptionStatus,
    settings.billingExempt,
  ]);

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
        if (Object.keys(rest).length) await fbSetFast(ops, 'main', rest);
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
      // Read prior expenses through settingsRef instead of closing
      // over settings.expenses. Closing over the array put it in the
      // useCallback dep array, which meant EVERY expense edit
      // regenerated persistExpenses → invalidated the tabContent
      // useMemo that imports it → re-rendered the whole tab tree
      // (Dashboard, History, Inventory) mid-save. settingsRef is
      // already used by sister callbacks (persistInventory closes
      // over inventoryRef for the same reason).
      const prev = settingsRef.current.expenses || [];
      const nextIds = new Set(next.map((e) => e.id));
      try {
        // Parallelize: each fbDelete/fbSetFast is a Firestore call
        // (fbSetFast resolves in <2.5s via local-cache write; fbDelete
        // is similar). Sequential awaits would multiply that by the
        // number of expense rows. These ops are independent, so
        // Promise.all is safe.
        const ops: Promise<void>[] = [];
        for (const e of prev) if (!nextIds.has(e.id)) ops.push(fbDelete(expCol, e.id));
        for (const e of next) ops.push(fbSetFast(expCol, e.id, e));
        setSettingsRaw((p) => ({ ...p, expenses: next }));
        await Promise.all(ops);
      } catch (e) {
        setSyncStatus('sync_failed');
        addToast(`Expenses save failed: ${humanizeFirestoreError(e)}`, 'error');
        throw e;
      }
    },
    [businessId]
  );

  const persistInventory = useCallback(
    async (next: InventoryItem[]) => {
      if (!businessId) { addToast('Sign in to save inventory', 'warn'); return; }
      const invCol = scopedCol(businessId, 'inventory');
      const prev = inventoryRef.current || [];
      // Keep items that have a primary descriptor for ANY vertical:
      //   tire     → size (e.g. '225/65R17')
      //   mechanic → partName / partNumber (size is intentionally '')
      //   detailing→ chemicalName (size is intentionally '')
      // Before this guard, the filter required `size` non-empty,
      // which silently DELETED every mechanic and detailing item
      // (they save with size='' by design) on every save. Same
      // silent-data-loss class as the deserializer field drops.
      const validNext = next.filter((i) =>
        (i.size || '').trim() ||
        (i.partName || '').trim() ||
        (i.partNumber || '').trim() ||
        (i.chemicalName || '').trim()
      );
      const nextIds = new Set(validNext.map((i) => i.id));
      try {
        // Parallelize all delete + set ops — same reasoning as
        // persistExpenses. Inventory rows are independent docs.
        const ops: Promise<void>[] = [];
        for (const p of prev) if (!nextIds.has(p.id)) ops.push(fbDelete(invCol, p.id));
        for (const i of validNext) {
          const { _isNew, ...rest } = i;
          ops.push(fbSetFast(invCol, i.id, rest));
        }
        setInventoryRaw(validNext);
        await Promise.all(ops);
      } catch (e) {
        setSyncStatus('sync_failed');
        addToast(`Inventory save failed: ${humanizeFirestoreError(e)}`, 'error');
        throw e;
      }
    },
    [businessId]
  );

  // Single entry point for "start a blank new job". Resets the draft,
  // clears any edit/quote context, and switches to the add tab. Used
  // by the bottom-nav Log button AND the Dashboard "Log New Job"
  // CTAs — previously the Dashboard CTAs called setTab('add')
  // directly, so they skipped the reset and preloaded whatever job
  // was last saved (the non-reset saveJob path leaves the draft
  // populated). That was the "old job preloads on a new entry" bug.
  const startNewJob = useCallback(() => {
    setJobDraft(EMPTY_JOB());
    setEditingJobId(null);
    setPrefilledFromQuote(false);
    setTab('add');
  }, []);

  // One-tap Quote → Job: the Dashboard Quick Quote hands over a partial
  // draft (service / vehicle / miles / qty / surcharges / tire cost /
  // chosen price, plus optional phone + tire size). Merge onto a fresh
  // EMPTY_JOB so unspecified fields keep their defaults, flag the draft as
  // quote-sourced (AddJob shows the "Pre-filled from Quick Quote" banner),
  // and jump to the Add tab. Carrying the phone lets AddJob's
  // CustomerLookupCard auto-recognize a returning customer and backfill
  // name / address — so the operator re-enters nothing it already knows.
  const startJobFromQuote = useCallback((draft: Partial<Job>) => {
    setJobDraft({ ...EMPTY_JOB(), ...draft });
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

    // Perf instrumentation — sliced phases so a slow save is
    // diagnosable from the console alone. Total budget under 3s on a
    // healthy connection; phases that consistently exceed 1s signal a
    // network or listener problem.
    const t0 = performance.now();
    const log = (phase: string) => {
      // eslint-disable-next-line no-console
      console.info(`[saveJob] ${phase} @ ${(performance.now() - t0).toFixed(0)}ms`);
    };

    let workingInv: InventoryItem[] = [...(inventoryRef.current || [])];
    let deductions: { id: string; size: string; qty: number; cost: number }[] | null = null;
    let computedTireCost = Number(j.tireCost || 0);

    // ─── Cancel refund path ───────────────────────────────────────
    // When an edit transitions a Completed/Pending job into
    // Cancelled, refund every prior inventory deduction (both tire
    // and mechanic-parts arrays) and skip the deduction planning
    // branches below. Without this, a $500 cancelled tire repair
    // permanently lost its 4-tire stock — operators had to re-stock
    // by hand. Mirrors the refund pattern in deleteJob().
    const isCanceling = j.status === 'Cancelled';

    try {
      if (isCanceling && isEditing) {
        const prev = jobs.find((x) => x.id === editingJobId);
        // Restore math is pure — see planJobCancelRefund (composes the
        // refund helpers tested in inventoryRefund.test). saveJob keeps
        // only the writes + toast.
        const refundPlan = planJobCancelRefund(prev, workingInv);
        if (refundPlan.touchedIds.length > 0) {
          workingInv = refundPlan.nextInventory;
          const byId = new Map(workingInv.map((i) => [i.id, i]));
          const restoreWrites = refundPlan.touchedIds.map((id) => fbSetFast(invCol, id, byId.get(id)!));
          setInventoryRaw(workingInv);
          log('cancel-restore-issued');
          // Promise.allSettled instead of Promise.all so a single failed
          // inventory write doesn't throw out of the whole save path. If
          // we threw, the job doc would never save with cleared deductions
          // — a retry would then re-restore the items that DID succeed,
          // double-counting. We surface partial failures via the toast and
          // always continue to save the job with deductions=null so the
          // job's accounting is authoritative regardless of which writes
          // the network ate.
          const results = await Promise.allSettled(restoreWrites);
          const failed = results.filter((r) => r.status === 'rejected').length;
          log('cancel-restore-acked');
          if (failed > 0) {
            addToast(
              `Cancelled — ${refundPlan.totalRestored - failed} restored, ${failed} could not save (open inventory to retry)`,
              'warn',
            );
          } else if (refundPlan.totalRestored > 0) {
            addToast(
              `Cancelled — restored ${refundPlan.totalRestored} item${refundPlan.totalRestored !== 1 ? 's' : ''} to inventory`,
              'success',
            );
          }
        }
        // Always clear deduction records on the job — the cancel
        // intent is that this job claims no inventory. Partial
        // restore failures are surfaced via the toast above; an
        // operator can manually adjust those few items. Without
        // this guarantee, a retry would re-attempt to restore the
        // already-restored items.
        deductions = null;
      }

      if (!isCanceling && j.tireSource === 'Inventory' && j.tireSize) {
        // Restore (on edit) + FIFO plan + apply is pure — see
        // planJobInventory (tested in planJobInventory.test). saveJob keeps
        // only the I/O: persist the touched items, mirror to local state,
        // warn on any defensive skip, toast on shortfall.
        const prevDeds = isEditing
          ? (jobs.find((x) => x.id === editingJobId)?.inventoryDeductions ?? null)
          : null;
        const invPlan = planJobInventory({
          tireSize: j.tireSize,
          qty: j.qty,
          inventory: workingInv,
          prevDeductions: Array.isArray(prevDeds) ? prevDeds : null,
          fallbackTireCost: j.tireCost,
        });
        deductions = invPlan.deductions;
        computedTireCost = invPlan.tireCost;
        for (const d of invPlan.skipped) {
          // A deduction's target id was absent from the snapshot (defensive
          // — see planJobInventory). Skip rather than corrupt another item;
          // the unwritten qty surfaces as a stock discrepancy to reconcile.
          // eslint-disable-next-line no-console
          console.warn('[saveJob] inventory item not in working snapshot — skipping deduction', { itemId: d.id, size: d.size, qty: d.qty });
        }
        // Persist each touched item. fbSetFast writes local cache instantly
        // + queues server sync, so multi-deduction saves complete well
        // under a second even on a stalled network.
        const byId = new Map(invPlan.nextInventory.map((i) => [i.id, i]));
        const invWrites = invPlan.touchedIds.map((id) => fbSetFast(invCol, id, byId.get(id)!));
        workingInv = invPlan.nextInventory;
        setInventoryRaw(workingInv);
        log('inv-writes-issued');
        await Promise.all(invWrites);
        log('inv-writes-acked');
        if (invPlan.shortfall > 0) addToast(`Logged with shortfall of ${invPlan.shortfall} tire(s)`, 'warn');
      } else if (j.tireSource === 'Bought for this job') {
        // TOTAL tire cost = PER-UNIT tirePurchasePrice × qty (see
        // computeJobTireCost). Matches the inventory branch + the TOTAL
        // convention in computeFlatPrice / jobCOGS / weekSummary.
        computedTireCost = computeJobTireCost({
          tireSource: 'Bought for this job',
          tirePurchasePrice: j.tirePurchasePrice, qty: j.qty, fallbackTireCost: j.tireCost,
        });
      } else if (j.tireSource === 'Customer supplied') {
        computedTireCost = computeJobTireCost({ tireSource: 'Customer supplied', fallbackTireCost: j.tireCost });
      }

      // ─── Mechanic parts deduction branch (Phase 2.2) ────────────────
      // Atomic with the job write below: every inventory update is
      // issued via fbSetFast prior to the job-write so a stalled save
      // never leaves inventory ahead of the job doc. The deduction
      // diff handles edit semantics (refund + rededuct) and source
      // changes uniformly.

      // Audit P1 (2026-05-31): read businessType through settingsRef
      // instead of the closed-over `settings`. The useCallback dep
      // list excludes `settings` to keep saveJob stable, which means
      // the closure could otherwise dispatch against a stale vertical
      // (e.g. running the mechanic parts-deduction branch on a tire
      // job after the operator switched business type mid-edit).
      // Same pattern persistExpenses uses (see settingsRef block at
      // line 427).
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
        // Phase 2.2 Sub-Project B: technician assignment. Owner /
        // admin can pick via the AddJob AssignmentPicker; everyone
        // else (technicians + legacy auto-save paths) defaults to
        // self so a tech-created job is always visible in their
        // scoped list. The picker's "Unassigned" choice sets
        // assignedToUid = undefined which we preserve here.
        assignedToUid: 'assignedToUid' in j ? j.assignedToUid : currentUid,
      };

      // ─── SP1: Customer + Vehicle auto-upsert ──────────────────────
      // Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
      //       §"saveJob change", §"Concurrency contract — upsertCustomerFromJob"
      //
      // Gate: settings.autoSaveCustomersFromJobs (read-time default true).
      // Failure: best-effort — Job write remains authoritative.
      // CRITICAL: do NOT route the customer write through fbSetFast —
      // upsertCustomerFromJob uses runTransaction internally.
      //
      // LATENCY BUDGET: fbSetFast caps job writes at 2.5s via Promise.race.
      // runTransaction has no built-in timeout and requires connectivity.
      // We mirror that pattern — race the upsert against a 2500ms sentinel
      // so a stalled or offline network never delays saveJob beyond its
      // existing budget. On sentinel-win we proceed without
      // customerId/vehicleId/phoneKey on the job doc; SP3 reconciliation
      // backfills via lookupCustomerByPhone.
      //
      // KNOWN PARTIAL-FAILURE WINDOW: the customer transaction commits
      // BEFORE the job's fbSetFast write. If fbSetFast fails (network blip
      // between the two writes), the customer doc's lastJobId /
      // processedJobIds references a jobId that was never persisted —
      // a "phantom job" reference. The reverse failure (upsert fails, job
      // succeeds) is caught by the try/catch and toasted. SP3's
      // reconciliation pass sweeps phantom-job refs by reconciling
      // customer.processedJobIds against the jobs collection.
      const autoSave = settings.autoSaveCustomersFromJobs ?? true;
      if (autoSave) {
        const upsertStart = performance.now();
        // On an EDIT, hand the customer rollup the revenue change (new −
        // old) so lifetimeRevenue tracks edits. The rollup is absorb-once
        // (keyed by jobId), so without this delta a revenue edit never
        // reached the customer's lifetime total. undefined ⇒ new job ⇒
        // full revenue absorbed as before.
        const upsertOpts = isEditing
          ? { revenueDelta: Number(finalJob.revenue || 0) - Number(jobs.find((x) => x.id === editingJobId)?.revenue || 0) }
          : undefined;
        try {
          const UPSERT_TIMEOUT_MS = 2500;
          const timeoutSentinel: { customerId: string; vehicleId: string; timedOut: true } = {
            customerId: '', vehicleId: '', timedOut: true,
          };
          const raceResult = await Promise.race([
            upsertCustomerFromJob(businessId, finalJob, upsertOpts)
              .then((r) => ({ ...r, timedOut: false as const })),
            new Promise<typeof timeoutSentinel>((resolve) =>
              setTimeout(() => resolve(timeoutSentinel), UPSERT_TIMEOUT_MS),
            ),
          ]);
          const elapsedMs = performance.now() - upsertStart;
          if (elapsedMs > 500) {
            console.warn('[saveJob] upsertCustomerFromJob slow', { elapsedMs, timedOut: raceResult.timedOut });
          }
          if (raceResult.timedOut) {
            addToast('Customer record sync deferred (slow network)', 'warn');
            console.warn('[saveJob] upsertCustomerFromJob timed out @ 2500ms — proceeding without customerId stamp');
          } else {
            const { customerId, vehicleId } = raceResult;
            if (customerId) (finalJob as { customerId?: string }).customerId = customerId;
            if (vehicleId) (finalJob as { vehicleId?: string }).vehicleId = vehicleId;
            const phone = normalizePhone(String(finalJob.customerPhone ?? ''));
            if (phone.valid) (finalJob as { phoneKey?: string }).phoneKey = phone.digits;
            // NEVER write phoneKey when invalid — '' and short codes would
            // pollute the phoneKey index.
          }
        } catch (err) {
          addToast('Customer record not updated (job saved anyway)', 'warn');
          console.warn('[saveJob] upsertCustomerFromJob failed', err);
        }
      } else {
        // Auto-save toggle OFF — operator manages Customer directory
        // manually. One-time-per-session toast so the operator who
        // intentionally disabled it isn't nag-spammed.
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('autoSaveOffToastShown')) {
          addToast('Customer not auto-saved (toggle OFF) — Manage manually from Customers tab', 'info');
          sessionStorage.setItem('autoSaveOffToastShown', '1');
        }
      }

      log('job-write-issued');
      await fbSetFast(jobsCol, finalJob.id, finalJob);
      log('job-write-acked');

      addToast(isEditing ? 'Job updated' : 'Job saved', 'success');
      setSavedJob(finalJob);
      if (resetAfter) {
        setJobDraft(EMPTY_JOB());
        setEditingJobId(null);
        setPrefilledFromQuote(false);
        setTab('add');
      } else {
        // Defensive: assign the finalized id back onto the draft so
        // that if the success-screen transition is delayed and the
        // user manages to tap Save again (despite the busy guard),
        // the second save OVERWRITES the same Firestore doc instead
        // of creating a duplicate. Without this, j.id stays empty
        // and the next save generates a fresh uid() → duplicate.
        setJobDraft({ ...j, id: finalJob.id, createdAt: finalJob.createdAt, createdByUid: finalJob.createdByUid });
        setEditingJobId(finalJob.id);
        setTab('success');
      }
      log('done');
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
      // Restock the deleted job's deductions via the SAME tested plan the
      // cancel branch uses (planJobCancelRefund), instead of duplicating
      // the extract→refund→touched dance. touchedIds is diff-based, so only
      // genuinely-changed items are written.
      const refundPlan = planJobCancelRefund(j, inventoryRef.current || []);
      if (refundPlan.touchedIds.length > 0) {
        const byId = new Map(refundPlan.nextInventory.map((i) => [i.id, i]));
        const restoreWrites = refundPlan.touchedIds.map((rid) => fbSetFast(invCol, rid, byId.get(rid)!));
        setInventoryRaw(refundPlan.nextInventory);
        await Promise.all(restoreWrites);
      }
      await fbDelete(jobsCol, id);
      // Reverse the customer rollup so lifetimeRevenue / jobCount don't keep
      // counting a job that no longer exists. Best-effort + idempotent
      // (no-op if the job was never absorbed); never blocks the delete.
      if (j) {
        try { await reverseCustomerFromJob(businessId, j); }
        catch (re) { console.warn('[deleteJob] customer rollup reversal failed', re); }
      }
      addToast('Job deleted', 'success');
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Delete failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId, jobs]);

  const handleGenerateInvoice = useCallback(async (j: Job) => {
    // Lazy-load the PDF generator. invoice.ts statically imports
    // jspdf (358 KB) + html2canvas (201 KB) — together ~75% of the
    // app's JS payload. Loading them on demand means the
    // initial bundle is ~25 KB smaller per route that doesn't open
    // an invoice. Vite splits this into its own chunk automatically.
    // generateInvoicePDF is async — it pre-loads the brand logo via
    // fetch before rendering; the await covers both that and the
    // dynamic import.
    const { generateInvoicePDF } = await import('@/lib/invoice');
    const result = await generateInvoicePDF(j, settings, brand, {});
    if (!result || !businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    // Write ONLY the fields we're changing. fbSetFast already does
    // merge:true, so a concurrent edit on another device (e.g. notes
    // change) is preserved instead of being clobbered by a stale full-
    // job write.
    const patch = {
      invoiceGenerated: true,
      invoiceGeneratedAt: new Date().toISOString(),
      invoiceNumber: result.invoiceNumber,
    };
    try {
      await fbSetFast(jobsCol, j.id, patch);
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
    // Partial write — see handleGenerateInvoice for rationale.
    const patch = { invoiceSent: true, invoiceSentAt: new Date().toISOString() };
    try {
      await fbSetFast(jobsCol, j.id, patch);
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
    // Use the seeded template picker (jobId as seed) so the same job
    // always renders the same variant — important when the owner
    // previews a message before sending. Also supports the new
    // channel-aware sharing layer.
    openReviewSMSFromJob({
      phone: j.customerPhone || '',
      reviewUrl: brand.reviewUrl,
      customerName: j.customerName || '',
      service: j.service,
      locationLabel: location,
      state: j.state,
      businessName: brand.businessName,
      // Vehicle threading — prefer the mechanic-vertical
      // vehicleMakeModel field (richer) over the tire-vertical
      // vehicleType (often just "Sedan"). Either flows into a
      // "your Toyota Camry" clause in vehicle-aware variants.
      vehicle: j.vehicleMakeModel || j.vehicleType || undefined,
      jobId: j.id,
      // BusinessId enables the smart-rotation tracker (avoids
      // consecutive duplicate variants across sends for this
      // business). Undefined → seed-only picker (same as before).
      businessId: businessId || undefined,
      channel: 'sms',
    });
    if (!businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    // Partial write — see handleGenerateInvoice for rationale.
    const patch = { reviewRequested: true, reviewRequestedAt: new Date().toISOString() };
    try {
      await fbSetFast(jobsCol, j.id, patch);
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Review flag save failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId, brand]);

  const handleMarkPaid = useCallback(async (j: Job, method?: PaymentMethod) => {
    if (!businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    // Stamp paidAt + paymentMethod so JobDetailModal's
    // "Paid via X · {timestamp}" block and invoice.ts's
    // payment-timestamp line both render correctly. paidAt always
    // sticks (preserves backup-import original date). paymentMethod
    // prefers explicit `method` arg — lets the "Change" affordance
    // on an already-paid job overwrite a wrong method. Falls back
    // to whatever's stored, then cash.
    //
    // status → 'Completed' is REQUIRED, not cosmetic: resolvePaymentStatus
    // returns 'Pending Payment' for ANY job whose status === 'Pending',
    // ignoring paymentStatus entirely. Without flipping status here, a
    // Pending job's pill stays "Pending Payment" and the Mark Paid
    // button never disappears — the exact "Mark Paid does nothing"
    // bug. A job that's been paid is, by definition, completed.
    // Partial write — only the four fields a mark-paid touches. Sending
    // the full `{...j, ...changes}` would re-broadcast every other
    // field (notes, customer, etc.) and stomp concurrent edits on
    // those fields from another device.
    const patch = {
      status: 'Completed' as const,
      paymentStatus: 'Paid' as const,
      paidAt: j.paidAt || new Date().toISOString(),
      // Explicit arg wins (the command-center chip / "Change" affordance);
      // else whatever's already on the job; else the operator's last-used
      // method (History's quick Mark Paid passes no arg); else cash.
      paymentMethod: method || j.paymentMethod || getLastPaymentMethod() || 'cash',
      // Record WHO collected — the member tapping Mark Paid. Preserve an
      // existing collector (e.g. a "Change method" re-fire) rather than
      // overwriting it.
      collectedByUid: j.collectedByUid || user.uid,
      collectedByName: j.collectedByName || currentMember?.displayName || user.displayName || user.email || 'Team member',
    };
    // Local view of the post-write job — used for downstream
    // review-prompt logic. The WRITE is `patch` only.
    const updated: Job = { ...j, ...patch };
    try {
      await fbSetFast(jobsCol, j.id, patch);
      // Remember this method so the next Mark Paid defaults to it instead
      // of cash — one fewer chip tap on every job (most shops collect the
      // same way each time).
      setLastPaymentMethod(patch.paymentMethod);
      // Review automation: surface a one-tap "Send review" action
      // toast at the moment payment lands — gated by shouldPromptReview
      // (per-business setting + a configured review URL + not already
      // requested). onTap reuses handleSendReview, which builds the
      // templated SMS and stamps reviewRequested. Passes `updated`
      // (post-payment job state) so the review SMS sees the freshly-
      // stamped paidAt + paymentMethod, not the pre-payment values.
      if (shouldPromptReview(updated, brand)) {
        addActionToast(
          'Marked as paid.',
          { label: 'Send review', onTap: () => { void handleSendReview(updated); } },
          'success',
        );
      } else {
        addToast('Marked as paid', 'success');
      }
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Mark-paid failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId, brand, handleSendReview]);

  // Explicit Complete — sets status → Completed WITHOUT touching payment,
  // so a job can be marked done while payment is still outstanding. This is
  // the counterpart to Mark Paid (which also completes as a convenience);
  // keeping them separate lets "work done, pay later" be a one-tap action.
  const handleCompleteJob = useCallback(async (j: Job) => {
    if (!businessId || j.status === 'Completed') return;
    const jobsCol = scopedCol(businessId, 'jobs');
    try {
      await fbSetFast(jobsCol, j.id, { status: 'Completed' });
      setDetailJob((cur) => (cur && cur.id === j.id ? { ...cur, status: 'Completed' } : cur));
      addToast('Job completed', 'success');
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Complete failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId]);

  // On-demand inventory deduction for the Complete Job Command Center.
  // Inventory-source jobs are normally deducted at save time (saveJob), so
  // this is the explicit fallback for a job that wasn't deducted yet (e.g.
  // a dispatched job whose tire size was filled in the field). Idempotent:
  // refuses if the job already carries deductions. FIFO by cost via the
  // shared planInventoryDeduction, and writes the resulting TOTAL tire cost
  // back so profit reconciles with the breakdown/rollups.
  const handleDeductInventory = useCallback(async (j: Job) => {
    if (!businessId) return;
    if (j.tireSource !== 'Inventory' || !j.tireSize) {
      addToast('No stock to deduct for this job', 'info');
      return;
    }
    if (Array.isArray(j.inventoryDeductions) && j.inventoryDeductions.length > 0) {
      addToast('Inventory already deducted', 'info');
      return;
    }
    const invCol = scopedCol(businessId, 'inventory');
    const jobsCol = scopedCol(businessId, 'jobs');
    const workingInv = inventory.map((i) => ({ ...i }));
    const plan = planInventoryDeduction(j.tireSize, Number(j.qty || 1), workingInv);
    if (plan.deductions.length === 0) {
      addToast(`No "${j.tireSize}" in stock to deduct`, 'warn');
      return;
    }
    const invWrites: Promise<void>[] = [];
    for (const d of plan.deductions) {
      const idx = workingInv.findIndex((i) => i.id === d.id);
      if (idx < 0) continue;
      workingInv[idx] = { ...workingInv[idx], qty: Math.max(0, Number(workingInv[idx].qty || 0) - Number(d.qty || 0)) };
      invWrites.push(fbSetFast(invCol, workingInv[idx].id, workingInv[idx]));
    }
    setInventoryRaw(workingInv);
    const planTotal = plan.deductions.reduce((s, d) => s + d.cost * d.qty, 0);
    const patch: Partial<Job> = {
      inventoryDeductions: plan.deductions,
      inventoryUsed: plan.deductions.map((d) => ({ size: d.size, qty: d.qty })),
    };
    if (planTotal > 0) patch.tireCost = r2(planTotal);
    try {
      await Promise.all(invWrites);
      await fbSetFast(jobsCol, j.id, patch);
      setDetailJob((cur) => (cur && cur.id === j.id ? { ...cur, ...patch } : cur));
      addToast(
        plan.shortfall > 0 ? `Deducted with shortfall of ${plan.shortfall} tire(s)` : 'Inventory deducted',
        plan.shortfall > 0 ? 'warn' : 'success',
      );
    } catch (e) {
      setSyncStatus('sync_failed');
      addToast(`Inventory deduct failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  }, [businessId, inventory]);

  const handleEditJob = useCallback((j: Job) => {
    setJobDraft({ ...j });
    setEditingJobId(j.id);
    setPrefilledFromQuote(false);
    setDetailJob(null);
    setTab('add');
  }, []);

  const handleViewJob = useCallback((j: Job) => setDetailJob(j), []);

  const handleDuplicate = useCallback((j: Job) => {
    // A duplicate is a NEW job: born unpaid, with all of the original's
    // payment/collection state cleared so it can't appear pre-paid.
    setJobDraft({
      ...j, id: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), revenue: '',
      paymentStatus: 'Pending Payment', status: 'Completed',
      payment: '', paymentMethod: undefined, paidAt: undefined,
      invoiceGenerated: false, invoiceSent: false, reviewRequested: false, lastEditedAt: null,
    });
    setEditingJobId(null);
    setPrefilledFromQuote(false);
    setDetailJob(null);
    setTab('add');
  }, []);

  const handleOnboardingComplete = useCallback(async (brandPatch: Partial<Brand>, settingsPatch: Partial<SettingsT>) => {
    try {
      await updateBrand(brandPatch);
      if (Object.keys(settingsPatch).length) await persistSettings(settingsPatch);
      // Only fire the welcome toast on the FINAL save (finish()
      // sets onboardingComplete=true; partial step-by-step saves
      // omit the flag). Previously the toast fired on every Next
      // tap because persistPartial routes through this handler.
      if (brandPatch.onboardingComplete) {
        addToast('Welcome aboard!', 'success');
      }
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
      // Home is the operational Dashboard — optimized for field / roadside
      // speed (today's jobs, scheduled, pending leads, quick quote/add,
      // revenue today, inventory alerts, recent activity, follow-ups).
      return (
        <Dashboard
          jobs={jobs}
          settings={settings}
          inventory={inventory}
          setTab={setTab}
          onNewJob={startNewJob}
          onQuoteToJob={startJobFromQuote}
          onViewJob={handleViewJob}
          onGenerateInvoice={handleGenerateInvoice}
          onSendInvoice={handleSendInvoice}
          onSendReview={handleSendReview}
          onMarkPaid={handleMarkPaid}
          onEditJob={handleEditJob}
          onLogExpense={(e) => persistExpenses([e, ...(settings.expenses || [])])}
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
          jobs={jobs}
          isEditing={Boolean(editingJobId)}
          prefilledFromQuote={prefilledFromQuote}
          onSave={async () => { await saveJob(false); }}
          onSaveAndNew={async () => { await saveJob(true); }}
          onCancel={() => { startNewJob(); setTab('dashboard'); }}
        />
      );
    }
    if (tab === 'history') return (
      <History
        jobs={jobs}
        loading={!jobsReady}
        focusSize={historyFocusSize}
        onFocusConsumed={() => setHistoryFocusSize(null)}
        settings={settings}
        onViewJob={handleViewJob}
        onMarkPaid={handleMarkPaid}
        onComplete={handleCompleteJob}
        onEditJob={handleEditJob}
        onGenerateInvoice={handleGenerateInvoice}
        onSendInvoice={handleSendInvoice}
        onSendReview={handleSendReview}
        onDuplicate={handleDuplicate}
      />
    );
    if (tab === 'customers') return (
      <CustomerHub
        businessId={businessId ?? ''}
        jobs={jobs}
        settings={settings}
        canViewFinancials={canViewFinancials}
        onSelectCustomer={(id) => { setSelectedCustomerId(id); setTab('customerProfile'); }}
        onOpenSearch={() => setSearchOpen(true)}
      />
    );
    if (tab === 'customerProfile' && selectedCustomerId && businessId) return (
      <CustomerProfile
        businessId={businessId}
        customerId={selectedCustomerId}
        currentUserUid={user?.uid ?? ''}
        onBack={() => { setSelectedCustomerId(null); setTab('customers'); }}
        onViewJob={handleViewJob}
        onCreateJob={(draft) => {
          setJobDraft({ ...EMPTY_JOB(), ...draft } as Job);
          setTab('add');
        }}
      />
    );
    if (tab === 'insights') return <InsightsGate jobs={jobs} settings={settings} inventory={inventory} />;
    if (tab === 'payouts') return <PayoutsGate jobs={jobs} settings={settings} />;
    if (tab === 'payments') return <PaymentsGate jobs={jobs} settings={settings} />;
    if (tab === 'expenses') return <ExpensesGate expenses={settings.expenses || []} jobs={jobs} settings={settings} onSave={persistExpenses} />;
    if (tab === 'inventory') return <Inventory inventory={inventory} onSave={persistInventory} settings={settings} jobs={jobs}
      onStartJob={(item) => {
        // Start a job pre-filled from this inventory tire. tireSource is
        // already 'Inventory' on EMPTY_JOB; fill size/brand/model so the
        // operator goes straight from "do I have this size?" to logging.
        setJobDraft({
          ...EMPTY_JOB(),
          tireSize: item.size,
          tireBrand: item.brand ?? '',
          tireModel: item.model ?? '',
        } as Job);
        setEditingJobId(null);
        setPrefilledFromQuote(false);
        setTab('add');
      }}
      focusSize={inventoryFocusSize}
      onFocusConsumed={() => setInventoryFocusSize(null)}
      onViewJobsForSize={openJobsForSize} />;
    if (tab === 'settings') return <Settings settings={settings} onSave={persistSettings} />;
    if (tab === 'help') return <Help onBack={() => setTab('dashboard')} />;
    if (tab === 'success' && savedJob) {
      // Use the LIVE job from the jobs array, not the frozen
      // post-save snapshot — so an action taken on the success
      // panel (Mark Paid, Generate Invoice) reflects immediately.
      const liveSavedJob = jobs.find((j) => j.id === savedJob.id) ?? savedJob;
      return (
        <JobSuccessPanel
          job={liveSavedJob}
          settings={settings}
          brand={brand}
          onGenerateInvoice={() => handleGenerateInvoice(liveSavedJob)}
          onSendReview={() => handleSendReview(liveSavedJob)}
          onEditJob={() => handleEditJob(liveSavedJob)}
          onViewJob={() => handleViewJob(liveSavedJob)}
          onDuplicate={() => handleDuplicate(liveSavedJob)}
          onMarkPaid={(method) => handleMarkPaid(liveSavedJob, method)}
          onClose={() => { setSavedJob(null); setTab('dashboard'); }}
          onNewJob={startNewJob}
        />
      );
    }
    return null;
  }, [tab, jobs, settings, inventory, jobDraft, editingJobId, prefilledFromQuote, savedJob, brand,
      businessId, canViewFinancials, user,
      handleViewJob, handleGenerateInvoice, handleSendReview, handleMarkPaid,
      handleEditJob, handleDuplicate, handleCompleteJob, saveJob, startNewJob, startJobFromQuote, persistExpenses, persistInventory, persistSettings]);

  if (brandLoading) {
    return (
      <div className="splash">
        <img src={APP_LOGO} alt="" className="splash-logo" />
        <div className="splash-name">Loading your business…</div>
      </div>
    );
  }

  // Invite-acceptance recovery. Set by BrandContext when a pending
  // invite for this user's email exists but acceptInvite() failed —
  // typically a transient rules / network issue. We surface a clean
  // recovery screen instead of letting the user fall through to
  // Onboarding (which would create a phantom-owner business they're
  // not supposed to have).
  if (inviteAcceptError) {
    return (
      <>
        <div className="splash" style={{ maxWidth: 420, margin: '0 auto', padding: 24 }}>
          <img src={APP_LOGO} alt="" className="splash-logo" />
          <div style={{
            fontSize: 18, fontWeight: 800, color: 'var(--t1)',
            marginTop: 18, marginBottom: 10, textAlign: 'center',
          }}>
            We hit a snag joining your team
          </div>
          <div className="auth-banner error" style={{
            marginTop: 6, lineHeight: 1.5, textAlign: 'left',
          }}>
            {inviteAcceptError}
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => window.location.reload()}
            style={{ width: '100%', marginTop: 18 }}
          >
            Try again
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              try { await _auth?.signOut(); } catch { /* */ }
              window.location.href = window.location.origin;
            }}
            style={{ width: '100%', marginTop: 8, fontSize: 12 }}
          >
            Sign out and start over
          </button>
        </div>
        <ToastHost />
      </>
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

  // Hard paywall — replace the whole app when the soft trial has
  // expired (or never started) and there's no active subscription.
  // shouldLockApp short-circuits to FALSE for growth mode and exempt
  // accounts, so Wheel Rush + early access users never see this.
  //
  // Wait until the settings/main listener has fired at least once
  // before evaluating — otherwise we'd render the lockout for the
  // ~300ms window between mount and first snapshot, producing a
  // visible flash on cold app open.
  if (subscriptionLoaded && shouldLockApp(settings)) {
    return (
      <>
        <PaywallLockout settings={settings} onSignOut={onSignOut} />
        <ToastHost />
      </>
    );
  }

  return (
    <MembershipProvider settings={settings}>
      <TechnicianLanding tab={tab} setTab={setTab} />
      <BusinessSwitcherProvider user={user} settings={settings}>
        <SizeLinkProvider onOpen={openInventoryForSize}>
        <Header
          syncStatus={syncStatus}
          onSignOut={onSignOut}
        />
        <OfflineBanner syncStatus={syncStatus} />
        <ActiveTimerBar jobs={jobs} onJobTap={(j) => setDetailJob(j)} />
        <EmailVerificationBanner />
      <TrialCountdownBanner
        settings={settings}
        onSubscribe={() => {
          // Route to Settings tab. The SubscriptionAccordion auto-expands
          // when this session flag is set on its mount effect.
          try { sessionStorage.setItem('msos_open_subscription', '1'); } catch { /* */ }
          setTab('settings');
        }}
      />
      <main className="main-content" data-bp={bp}>
        <Suspense fallback={<PageSkeleton />}>
          {tabContent}
        </Suspense>
      </main>
      {/* Audit a11y P1-3 (2026-05-31): bottom-nav buttons. aria-current
          announces the active tab to screen readers; aria-hidden on the
          emoji span stops "house emoji Home" / "single right-pointing
          angle quotation mark" from being read out. The More button
          uses aria-haspopup + aria-expanded so AT users know it opens
          a popup dialog.

          Batch B (2026-06-05): nav hides while tab === 'add' so the
          save-footer no longer fights the bottom-nav for vertical
          space on the Add Job screen. The save-footer's new Cancel
          button is the operator's escape route while the nav is
          hidden — see AddJob.tsx onCancel prop. */}
      {tab !== 'add' && (
        <nav className="bottom-nav" aria-label="Primary">
          {/* Nav order: Home · Jobs · Customers · Inventory · Log(+) · More.
              Inventory is a daily tool; Log is the action button (visually
              distinct). (Leads tab removed.) */}
          <button
            className={'nav-btn' + (tab === 'dashboard' ? ' active' : '')}
            aria-current={tab === 'dashboard' ? 'page' : undefined}
            onClick={() => setTab('dashboard')}
          >
            <span className="nav-ico" aria-hidden="true"><NavHome /></span><span>Home</span>
          </button>
          <button
            className={'nav-btn' + (tab === 'history' ? ' active' : '')}
            aria-current={tab === 'history' ? 'page' : undefined}
            onClick={() => setTab('history')}
          >
            <span className="nav-ico" aria-hidden="true"><NavJobs /></span><span>Jobs</span>
          </button>
          <button
            className={'nav-btn' + (tab === 'customers' ? ' active' : '')}
            aria-current={tab === 'customers' ? 'page' : undefined}
            onClick={() => setTab('customers')}
          >
            <span className="nav-ico" aria-hidden="true"><NavCustomers /></span><span>Customers</span>
          </button>
          <button
            className={'nav-btn' + (tab === 'inventory' ? ' active' : '')}
            aria-current={tab === 'inventory' ? 'page' : undefined}
            onClick={() => setTab('inventory')}
          >
            <span className="nav-ico" aria-hidden="true"><NavInventory /></span><span>Inv</span>
          </button>
          {/* Log — the primary action button. Visually distinct (raised
              accent) via .nav-btn.primary.nav-log in the global stylesheet. */}
          <button
            className="nav-btn primary nav-log"
            aria-label="Log a job"
            onClick={startNewJob}
          >
            <span className="nav-ico" aria-hidden="true"><NavLog /></span><span>Log</span>
          </button>
          <button
            className={'nav-btn' + ((tab === 'settings' || tab === 'payouts' || tab === 'payments' || tab === 'expenses' || tab === 'insights' || tab === 'help') ? ' active' : '')}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <span className="nav-ico" aria-hidden="true"><NavMore /></span><span>More</span>
          </button>
        </nav>
      )}
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
          onMarkPaid={(method) => handleMarkPaid(detailJob, method)}
          onDeductInventory={() => { void handleDeductInventory(detailJob); }}
          onUpdateJob={async (patch) => {
            if (!businessId) return;
            // Send ONLY the patch — fbSetFast merges into Firestore, so
            // a concurrent edit on another device for fields not in the
            // patch is preserved. The local detailJob state still
            // spreads for UI immediacy; the WRITE is the patch only.
            await fbSetFast(scopedCol(businessId, 'jobs'), detailJob.id, patch);
            setDetailJob({ ...detailJob, ...patch });
          }}
        />
      )}
      <InstallBanner />
      <UpdateBanner />
      <ToastHost />
      {businessId && settings.incomingCallLookupEnabled !== false && (
        <IncomingCallNotification
          // CustomerProfile is a single-page view — View History opens the
          // customer profile (history is a section there).
          onOpenCustomerHistory={(cid) => { setSelectedCustomerId(cid); setTab('customerProfile'); }}
          onCreateNewJob={(phoneE164) => {
            // Pre-fill the AddJob phone field. CustomerLookupCard
            // detects the populated phone on mount and auto-resolves
            // the customer if one exists.
            setJobDraft({ ...EMPTY_JOB(), customerPhone: phoneE164 } as Job);
            setTab('add');
          }}
        />
      )}
      {businessId && (
        <GlobalSearchSheet
          businessId={businessId}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelectCustomer={(id) => {
            setSelectedCustomerId(id);
            setTab('customerProfile');
            setSearchOpen(false);
          }}
        />
      )}
        </SizeLinkProvider>
      </BusinessSwitcherProvider>
    </MembershipProvider>
  );
}

export default App;
