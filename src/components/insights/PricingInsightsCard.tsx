// src/components/insights/PricingInsightsCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Smart Pricing — on-demand AI observations comparing 90-day actual
//  sale prices to configured service basePrice. Owner/admin only,
//  tire vertical only, hidden when there's insufficient data.
//
//  States: idle | loading | ready | error
//  Cache:  sessionStorage 'msos:pricing-insights:<bid>' (30 min)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { TODAY } from '@/lib/defaults';
import { callAI, isAIConfigured } from '@/lib/aiClient';
import {
  buildPricingDigest,
  parsePricingInsightsResponse,
  countCompletedJobsInWindow,
} from '@/lib/pricingInsights';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useMembership } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';

interface Props {
  jobs: Job[];
  settings: Settings;
  businessId: string;
}

interface CachedPayload {
  bullets: string[];
  generatedAt: number;       // epoch ms
}

const CACHE_TTL_MS = 30 * 60 * 1000;  // 30 min
const MIN_COMPLETED_JOBS = 10;
const cacheKey = (bid: string) => `msos:pricing-insights:${bid}`;

function readCache(bid: string): CachedPayload | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(bid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed || typeof parsed.generatedAt !== 'number') return null;
    if (Date.now() - parsed.generatedAt > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.bullets)) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(bid: string, bullets: string[]): void {
  try {
    const payload: CachedPayload = { bullets, generatedAt: Date.now() };
    sessionStorage.setItem(cacheKey(bid), JSON.stringify(payload));
  } catch { /* sessionStorage quota or disabled — ignore */ }
}

function formatRelative(epochMs: number): string {
  const ageMin = Math.floor((Date.now() - epochMs) / 60_000);
  if (ageMin < 1) return 'just now';
  if (ageMin === 1) return '1 min ago';
  return `${ageMin} min ago`;
}

export function PricingInsightsCard({ jobs, settings, businessId }: Props) {
  const vertical = useActiveVertical();
  const { role } = useMembership();
  const today = TODAY();
  const completedInWindow = useMemo(
    () => countCompletedJobsInWindow(jobs, today),
    [jobs, today],
  );

  const visible =
    isAIConfigured() &&
    vertical.features.inventoryDeduction &&        // tire only
    (role === 'owner' || role === 'admin') &&
    completedInWindow >= MIN_COMPLETED_JOBS;

  // Hydrate state from cache on mount so a tab-switch doesn't lose
  // the user's freshly-generated bullets.
  const cached = visible ? readCache(businessId) : null;
  const [bullets, setBullets] = useState<string[]>(cached?.bullets || []);
  const [generatedAt, setGeneratedAt] = useState<number | null>(cached?.generatedAt || null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    cached && cached.bullets.length ? 'ready' : 'idle',
  );

  // If the businessId changes (rare — switcher), reset to whatever
  // the new business's cache says.
  useEffect(() => {
    if (!visible) return;
    const fresh = readCache(businessId);
    setBullets(fresh?.bullets || []);
    setGeneratedAt(fresh?.generatedAt || null);
    setStatus(fresh && fresh.bullets.length ? 'ready' : 'idle');
  }, [businessId, visible]);

  if (!visible) return null;

  const handleGenerate = async (): Promise<void> => {
    setStatus('loading');
    const digest = buildPricingDigest(jobs, settings, today);
    if (digest.groups.length === 0) {
      // Insufficient grouped data even though completedInWindow >= 10
      // (e.g. every group has <3 sales). Fail soft to idle with a hint.
      addToast('Not enough repeat sales per size yet — try later', 'info');
      setStatus('idle');
      return;
    }
    const res = await callAI('pricing_insights', digest);
    if (!res.ok || !res.text) {
      const msg = res.error === 'rate_limited'
        ? 'AI rate limit reached — try again later'
        : 'Couldn\'t generate pricing insight — try again';
      addToast(msg, 'warn');
      setStatus('idle');
      return;
    }
    const parsed = parsePricingInsightsResponse(res.text, digest);
    if (!parsed.ok) {
      addToast('Pricing insight unavailable — try again', 'warn');
      setStatus('idle');
      return;
    }
    setBullets(parsed.bullets);
    const now = Date.now();
    setGeneratedAt(now);
    writeCache(businessId, parsed.bullets);
    setStatus('ready');
  };

  return (
    <div className="ai-summary card-anim" style={{ marginTop: 12 }}>
      <button
        className="ai-summary-btn press-scale"
        onClick={handleGenerate}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Analyzing 90 days of sales…' : '💰 Smart Pricing'}
      </button>
      {status === 'ready' && bullets.length > 0 && (
        <div className="ai-summary-card card-anim">
          <div className="ai-summary-label">
            Pricing observations
            {generatedAt && (
              <span style={{ color: 'var(--t3)', fontWeight: 400, marginLeft: 8 }}>
                · {formatRelative(generatedAt)}
              </span>
            )}
          </div>
          <ul className="ai-summary-list">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <button
            type="button"
            onClick={handleGenerate}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--brand-primary)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', padding: 0, marginTop: 6,
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
