// src/pages/Bandilero.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — command-center intelligence tab (Phase 1).
//
//  Reads Firestore as the single source of truth: jobs/settings/
//  inventory arrive as props (already-loaded app state); leads +
//  reviewRequests are subscribed here in real time. Builds the daily
//  briefing from the deterministic services and renders REAL values
//  only — every metric carries a confidence state, NOT_CONNECTED is
//  shown explicitly, financials are redacted (not faked) for techs,
//  and the LLM narrative is optional (NOT_CONNECTED when AI is off).
//
//  Pro-only: a non-Pro tenant sees an upgrade panel, never fake data.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import '@/styles/bandilero.css';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import { isAIConfigured } from '@/lib/aiClient';
import type { Brand, CommunicationEvent, InventoryItem, Job, Lead, ReviewRequest, Settings } from '@/types';
import { detectConnectivity } from '@/lib/bandilero/connectivity';
import { buildDailyBriefing } from '@/lib/bandilero/briefing';
import { buildRecommendations } from '@/lib/bandilero/recommendations';
import { draftBriefingNarrative, draftGrowthSynthesis } from '@/lib/bandilero/reasoning';
import { type Metric, notConnected, hasValue } from '@/lib/bandilero/confidence';
import { type BandileroConfig, resolveConfig } from '@/lib/bandilero/config';
import { dispatchMetrics } from '@/lib/bandilero/services/dispatch';
import { callIntelDeep } from '@/lib/bandilero/services/callIntelDeep';
import { customerSegments } from '@/lib/bandilero/services/customerSegments';
import { customerIntelligence } from '@/lib/bandilero/services/customerIntel';
import { financeIntel } from '@/lib/bandilero/services/financeIntel';
import { inventoryIntel } from '@/lib/bandilero/services/inventoryIntel';
import { reputationStatus } from '@/lib/bandilero/services/reputation';
import { MetricCard } from '@/components/bandilero/MetricCard';
import { ActionCard } from '@/components/bandilero/ActionCard';
import { BriefingHeader } from '@/components/bandilero/BriefingHeader';
import { DispatchPanel } from '@/components/bandilero/DispatchPanel';
import { CallIntelPanel } from '@/components/bandilero/CallIntelPanel';
import { CustomerSegmentsPanel } from '@/components/bandilero/CustomerSegmentsPanel';
import { CustomerIntelPanel } from '@/components/bandilero/CustomerIntelPanel';
import { FinanceIntelPanel } from '@/components/bandilero/FinanceIntelPanel';
import { InventoryIntelPanel } from '@/components/bandilero/InventoryIntelPanel';
import { GrowthPanel } from '@/components/bandilero/GrowthPanel';
import { ReputationPanel } from '@/components/bandilero/ReputationPanel';
import { PricingIntelPanel } from '@/components/bandilero/PricingIntelPanel';

interface Props {
  businessId: string;
  jobs: Job[];
  settings: Settings;
  inventory: InventoryItem[];
  brand: Brand;
  operatorName: string | null;
  canViewFinancials: boolean;
  /** Pro-tier entitlement (canAccessFeature(settings,'bandilero')). */
  proEnabled: boolean;
}

/** Today in the app's operating timezone (matches utils date helpers). */
function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default function Bandilero({
  businessId, jobs, settings, inventory, brand, operatorName, canViewFinancials, proEnabled,
}: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [reviewRequests, setReviewRequests] = useState<ReviewRequest[]>([]);
  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  const [configDoc, setConfigDoc] = useState<Partial<BandileroConfig> | null>(null);
  const [narrative, setNarrative] = useState<Metric<string> | null>(null);
  const [growthNarrative, setGrowthNarrative] = useState<Metric<string> | null>(null);

  const today = todayISO();
  const config = useMemo(() => resolveConfig(configDoc), [configDoc]);

  // Real-time leads (missed-call source) + review requests + comm events.
  useEffect(() => {
    if (!businessId || !proEnabled) return;
    const db = requireDb();
    const unsubLeads = onSnapshot(
      query(collection(db, 'businesses', businessId, 'leads'), orderBy('receivedAt', 'desc')),
      (snap) => setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as Lead)),
      () => setLeads([]),
    );
    const unsubReviews = onSnapshot(
      collection(db, 'businesses', businessId, 'reviewRequests'),
      (snap) => setReviewRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ReviewRequest)),
      () => setReviewRequests([]),
    );
    const unsubEvents = onSnapshot(
      collection(db, 'businesses', businessId, 'communicationEvents'),
      (snap) => setCommEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CommunicationEvent)),
      () => setCommEvents([]),
    );
    // Tenant-tunable thresholds (optional doc; defaults when absent).
    const unsubConfig = onSnapshot(
      doc(db, 'businesses', businessId, 'bandilero', 'config'),
      (snap) => setConfigDoc(snap.exists() ? (snap.data() as Partial<BandileroConfig>) : null),
      () => setConfigDoc(null),
    );
    return () => { unsubLeads(); unsubReviews(); unsubEvents(); unsubConfig(); };
  }, [businessId, proEnabled]);

  const connectivity = useMemo(
    () => detectConnectivity({ settings, brandReviewUrl: brand?.reviewUrl, aiConfigured: isAIConfigured() }),
    [settings, brand?.reviewUrl],
  );

  const briefing = useMemo(
    () => buildDailyBriefing({
      today, settings, jobs, leads, reviewRequests, inventory, connectivity,
      operatorName, businessName: brand?.businessName ?? settings.businessName ?? null,
      canViewFinancials,
    }),
    [today, settings, jobs, leads, reviewRequests, inventory, connectivity, operatorName, brand?.businessName, canViewFinancials],
  );

  // Phase 2 modules — deterministic, computed from the same real data.
  const dispatch = useMemo(() => dispatchMetrics(jobs, today), [jobs, today]);
  const callDeep = useMemo(
    () => callIntelDeep(leads, commEvents, connectivity, today, config.windowDays),
    [leads, commEvents, connectivity, today, config.windowDays],
  );
  const segments = useMemo(() => customerSegments(jobs, settings, today), [jobs, settings, today]);
  const custIntel = useMemo(() => customerIntelligence(jobs, settings, today), [jobs, settings, today]);
  const finance = useMemo(() => financeIntel(jobs, settings, today), [jobs, settings, today]);

  // Phase 3 modules.
  const invIntel = useMemo(() => inventoryIntel(inventory, jobs, today), [inventory, jobs, today]);
  const reputation = useMemo(() => reputationStatus(connectivity), [connectivity]);
  const recommendations = useMemo(
    () => buildRecommendations({ jobs, leads, inventory, settings, connectivity, today, windowDays: config.windowDays }),
    [jobs, leads, inventory, settings, connectivity, today, config.windowDays],
  );

  // AI narrative (optional). Only fires when the proxy is configured;
  // otherwise stays NOT_CONNECTED. Never blocks the deterministic UI.
  useEffect(() => {
    let alive = true;
    if (!isAIConfigured()) { setNarrative(notConnected<string>('AI not connected', 'ai')); return; }
    draftBriefingNarrative(briefing).then((m) => { if (alive) setNarrative(m); });
    return () => { alive = false; };
  }, [briefing]);

  // AI growth synthesis (optional) over the ranked recommendations.
  useEffect(() => {
    let alive = true;
    if (!isAIConfigured() || !canViewFinancials) { setGrowthNarrative(notConnected<string>('AI not connected', 'ai')); return; }
    const digest = recommendations
      .filter((r) => hasValue(r.impact) && (r.impact.state === 'LIVE' || r.impact.state === 'ESTIMATED'))
      .map((r) => ({ title: r.title, impact: r.impact.value as number, state: r.impact.state as 'LIVE' | 'ESTIMATED', assumption: r.impact.assumption }));
    draftGrowthSynthesis(digest).then((m) => { if (alive) setGrowthNarrative(m); });
    return () => { alive = false; };
  }, [recommendations, canViewFinancials]);

  if (!proEnabled) {
    return (
      <div className="page page-enter" style={{ color: '#f3f5f9' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Bandilero</div>
        <div style={{
          padding: 16, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--border)',
          fontSize: 13, color: 'var(--t3)', lineHeight: 1.5,
        }}>
          Bandilero — the command-center intelligence module — is a Pro feature.
          Upgrade to Pro to unlock the daily briefing, live metrics, and top actions
          computed from your real job, customer, and inventory data.
        </div>
      </div>
    );
  }

  const narr = narrative ?? briefing.narrative;

  return (
    <div className="bandilero-root page-enter">
      <BriefingHeader greeting={briefing.greeting} />

      {/* AI narrative — optional, honest when off. Glass hero (capped blur). */}
      <div className={'bnd-card ' + (narr.state === 'NOT_CONNECTED' ? 'bnd-nc' : 'bnd-glass bnd-live')} style={{
        padding: '12px 14px', marginBottom: 4,
        fontSize: 12.5, lineHeight: 1.5, color: narr.state === 'NOT_CONNECTED' ? 'var(--bnd-t3)' : '#d6f6fb',
      }}>
        {narr.state === 'NOT_CONNECTED'
          ? 'AI briefing narrative is not connected — metrics below are computed deterministically from your data.'
          : narr.value}
      </div>

      {/* Metric sections — spec order: Revenue → Jobs → Missed calls →
          Review alerts → Inventory alerts */}
      {briefing.sections.map((s) => (
        <div className="bandilero-section" key={s.key}>
          <div className="bandilero-section-title">{s.title}</div>
          {s.restricted ? (
            <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              🔒 Financial metrics are available to owners and admins.
            </div>
          ) : (
            <div className="bandilero-grid">
              {s.metrics.map((m) => <MetricCard key={`${s.key}-${m.label}`} metric={m} />)}
            </div>
          )}
        </div>
      ))}

      {/* Top 3 Actions — closes the command briefing (spec order) */}
      <div className="bandilero-section">
        <div className="bandilero-section-title">Top 3 Actions</div>
        {briefing.actionsRestricted ? (
          <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            🔒 Dollar-impact actions are available to owners and admins.
          </div>
        ) : briefing.topActions.length === 0 ? (
          <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            No action items right now — nothing above threshold.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {briefing.topActions.map((a, i) => <ActionCard key={a.id} action={a} rank={i + 1} />)}
          </div>
        )}
      </div>

      {/* ── Revenue & Finance (owner/admin only) ── */}
      <div className="bandilero-section">
        <div className="bandilero-section-title">Revenue &amp; Finance</div>
        <FinanceIntelPanel intel={finance} canViewFinancials={canViewFinancials} />
      </div>

      {/* ── Customer Intelligence (real Firestore data; no Twilio) ── */}
      <div className="bandilero-section">
        <div className="bandilero-section-title">Customer Intelligence</div>
        <CustomerIntelPanel intel={custIntel} canViewFinancials={canViewFinancials} />
      </div>

      {/* ── Phase 2 modules (operational; all roles) ── */}
      <div className="bandilero-section">
        <div className="bandilero-section-title">Call Intelligence</div>
        <CallIntelPanel data={callDeep} />
      </div>

      <div className="bandilero-section">
        <div className="bandilero-section-title">Customer Segments</div>
        <CustomerSegmentsPanel segments={segments} canViewFinancials={canViewFinancials} />
      </div>

      <div className="bandilero-section">
        <div className="bandilero-section-title">Dispatch &amp; Routing</div>
        <DispatchPanel metrics={dispatch} />
      </div>

      {/* ── Phase 3 modules ── */}
      <div className="bandilero-section">
        <div className="bandilero-section-title">Growth &amp; Recommendations</div>
        <GrowthPanel
          recommendations={recommendations}
          narrative={growthNarrative ?? notConnected<string>('AI not connected', 'ai')}
          canViewFinancials={canViewFinancials}
        />
      </div>

      <div className="bandilero-section">
        <div className="bandilero-section-title">Pricing Intelligence</div>
        <PricingIntelPanel
          jobs={jobs}
          leads={leads}
          inventory={inventory}
          settings={settings}
          today={today}
          canViewFinancials={canViewFinancials}
        />
      </div>

      <div className="bandilero-section">
        <div className="bandilero-section-title">Inventory Intelligence</div>
        <InventoryIntelPanel intel={invIntel} />
      </div>

      <div className="bandilero-section">
        <div className="bandilero-section-title">Reputation &amp; Visibility</div>
        <ReputationPanel status={reputation} />
      </div>
    </div>
  );
}
